# Arquitectura

Decisiones estructurales y **por qué** se tomaron. Cuando una decisión se
revierta, hay que anotar aquí el motivo: un registro de decisiones sin las
alternativas descartadas no sirve de nada.

---

## 1. Microservicios con arquitectura hexagonal

### Los servicios

| Servicio | Puerto | Responsabilidad |
|---|---|---|
| `api-gateway` | 3000 | Único punto expuesto. Enruta, propaga correlación, aplica límites y CORS. |
| `identity` | 3101 | Usuarios, credenciales, sesiones, roles, auditoría de acceso. |
| `institutions` | 3102 | Instituciones, licencias, salones, matrículas, docentes. |
| `catalog` | 3103 | Kits, libros, códigos de activación, cursos, lecciones, derechos de acceso. |
| `learning` | 3104 | Progreso, retos, portafolio, gamificación. |
| `assessment` | 3105 | Evaluaciones, rúbricas, entregas, calificaciones, certificados. |
| `engagement` | 3106 | Anuncios, notificaciones, correo, mesa de ayuda. |
| `analytics` | 3107 | Dashboards, reportes, exportación. |
| `media` | 3108 | Subidas, URLs prefirmadas, miniaturas, proveedor de video. |

**Por qué microservicios y no un monolito modular.** Un monolito habría sido más
simple de arrancar, y es la elección correcta en muchos proyectos. Aquí pesan
tres cosas concretas:

1. **Los perfiles de carga son radicalmente distintos.** El catálogo recibe
   lecturas masivas y cacheables; la analítica ejecuta consultas pesadas y lentas;
   identidad hace trabajo intensivo en CPU (Argon2 consume memoria y tiempo a
   propósito). En un monolito habría que escalar todo junto al ritmo del
   componente más exigente, que es exactamente el gasto que hay que evitar a
   escala.
2. **El aislamiento de fallos importa.** Un reporte pesado no debe poder impedir
   que un alumno abra su lección.
3. **El cliente pidió explícitamente microservicios.**

**El riesgo asumido:** la complejidad operativa sube mucho. Se mitiga con
`@glexco/nest-platform`, que concentra todo lo que debe ser idéntico en los ocho
servicios (arranque, salud, errores, caché, bus, apagado), de modo que un
servicio nuevo son pocas decenas de líneas de infraestructura.

### Hexagonal (puertos y adaptadores)

```
src/
├── domain/          Agregados, objetos de valor, eventos.  ← CERO dependencias externas
├── application/     Casos de uso. Dependen de PUERTOS (interfaces).
├── infrastructure/  Adaptadores: Postgres, Redis, NATS, S3, SMTP.
└── interface/       Controladores HTTP y consumidores de eventos.
```

**La regla:** las dependencias apuntan hacia dentro. `domain` no importa nada de
`infrastructure`. Si hace falta romperla, es que falta un puerto.

**Lo que compra en la práctica:**

- Los tests de casos de uso corren **en memoria, sin Docker, en milisegundos**.
  Con la infraestructura acoplada, cada test necesitaría Postgres y Redis y la
  suite tardaría minutos, con el resultado predecible de que nadie la ejecuta.
- Cambiar de proveedor (MinIO → S3 → Huawei OBS; NATS → Kafka) es escribir un
  adaptador nuevo, no reescribir la lógica.
- Las reglas de negocio se leen sin ruido técnico alrededor.

---

## 2. Persistencia: un PostgreSQL, un schema por servicio

Cada servicio tiene su **schema** y su **rol** de base de datos. El rol solo tiene
permiso sobre su schema, así que un servicio **no puede** hacer `JOIN` contra las
tablas de otro aunque alguien lo intente por descuido.

**Por qué no una base por servicio desde el principio:** en Railway serían 5-6
instancias de Postgres pagadas y una fricción notable en desarrollo local, a
cambio de un aislamiento que a este tamaño todavía no se necesita.

**Por qué el schema y no tablas con prefijo:** el prefijo es una convención que
nadie hace cumplir. El schema con rol propio lo hace cumplir el motor.

**Cómo se migra después:** cambiar la `DATABASE_URL` del servicio. Nada más,
porque nunca hubo claves foráneas cruzadas entre schemas. Esa restricción es
incómoda al principio (hay que resolver referencias por evento o por consulta) y
es precisamente lo que hace posible la migración sin reescribir.

### Separación lectura / escritura

`DB_WRITE_POOL` y `DB_READ_POOL` existen desde el primer día, aunque en local
apunten al mismo Postgres. Así el código que se escribe hoy ya es el correcto
cuando en producción existan tres réplicas: no hay una migración posterior "para
escalar".

⚠️ **Cuidado con el retardo de replicación.** Cualquier lectura que deba ver un
cambio recién hecho (leer tu perfil tras editarlo, comprobar el cupo del salón
justo antes de matricular) va al pool de **escritura**. Es el error clásico al
introducir réplicas.

---

## 3. Mensajería: NATS JetStream + outbox transaccional

### Por qué NATS y no Kafka

Para eventos de dominio (no telemetría masiva), JetStream da persistencia,
reintentos y entrega at-least-once con una fracción del coste operativo de Kafka.
Kafka exige KRaft, particiones y ajuste fino: a este tamaño sería pagar
complejidad sin recibir nada. Si algún día la analítica necesita reprocesar meses
de eventos, la migración es sustituir el adaptador, porque los casos de uso solo
conocen el puerto `EventPublisher`.

### Por qué outbox y no publicar directamente

Publicar después de guardar parece equivalente y no lo es:

```
   ✗ INGENUO                              ✓ OUTBOX
   ─────────────────                      ─────────────────
   INSERT usuario          ──┐            BEGIN
   -- el proceso muere aquí  │              INSERT usuario
   publish(evento)         ──┘              INSERT outbox(evento)
                                          COMMIT
   Resultado: el usuario existe                    │
   pero nadie se enteró. El fallo                  ▼
   es silencioso y aparece semanas       Relay → NATS (con reintentos)
   después como "datos inconsistentes".
```

Con outbox, el cambio de estado y el evento se guardan **en la misma
transacción**: es imposible que uno exista sin el otro.

El relay publica **antes** de marcar como publicado. El orden inverso perdería
eventos; este, en el peor caso, los entrega dos veces, y los consumidores
deduplican por `event_id` en `processed_events`. **Entre perder y duplicar,
siempre duplicar.**

Detalles que importan: `SELECT ... FOR UPDATE SKIP LOCKED` permite que varias
réplicas drenen la misma outbox en paralelo sin pisarse; `Nats-Msg-Id` deja que
JetStream deduplique los reintentos de red.

### Nombres de evento versionados

`identity.user.registered.v1`. La versión va en el **asunto**, no en el cuerpo,
porque los consumidores se suscriben por patrón de asunto. Un cambio incompatible
publica `.v2` en paralelo y retira `.v1` cuando nadie lo consuma: sin despliegue
coordinado de los ocho servicios.

Un evento describe un **hecho de negocio**, nunca un cambio de fila. No existe
`user.updated`; existen `user.email_verified`, `user.deactivated`. Así el
consumidor sabe reaccionar sin comparar estados.

---

## 4. Autenticación

```
   Access token                        Refresh token
   ───────────────                     ───────────────
   15 minutos                          30 días, rotativo
   En memoria del cliente              Cookie httpOnly + Secure + SameSite
   Lleva roles y permisos resueltos    Solo sub, sid y familia
   Verificado localmente (HMAC)        Verificado contra Redis
```

**Por qué los permisos van dentro del token:** si cada servicio tuviera que
preguntar a identidad en cada petición, identidad sería un punto único de fallo y
cada llamada añadiría un salto de red. A decenas de miles de peticiones por
segundo eso es insostenible. Verificar una firma HMAC cuesta microsegundos.

**El precio:** revocar un permiso tarda, como máximo, lo que le quede de vida al
token. Por eso el access dura 15 minutos, y las revocaciones que deben ser
inmediatas (expulsar una sesión, desactivar una cuenta) usan la lista en Redis
que se consulta **solo** cuando el token trae la marca `crit` — sesiones de
administradores y personal GLEXCO. Los millones de alumnos no pagan ese viaje.

**Rotación de refresh con detección de reutilización:** cada refresco emite un
token nuevo e invalida el anterior. Si aparece un token ya usado de la misma
familia, significa que alguien lo copió: se revoca **la familia entera** y se
fuerza reautenticación.

**Verificación en cada servicio, no solo en el gateway.** Defensa en profundidad:
si alguien alcanza la red interna, no basta con esquivar el gateway para operar
como administrador.

**Argon2id, no bcrypt.** El cliente mencionó bcrypt como ejemplo de "hacerlo
bien"; Argon2id es la recomendación actual de OWASP porque resiste el ataque con
GPU al ser duro en memoria, no solo en CPU. El puerto `PasswordHasher` es
intercambiable y `needsRehash` permite migrar de algoritmo sin pedir a nadie que
cambie su contraseña, así que la decisión es reversible.

---

## 5. Caché

Patrón cache-aside con **invalidación por etiquetas**. Cuando un administrador
edita un video del curso "uKit AI – Zoológico Fantástico" hay que tirar todas las
entradas derivadas (ficha del curso, listado del kit, árbol de lecciones, en dos
idiomas). Recorrer claves con `SCAN` en producción es caro; una etiqueta
`course:<id>` lo resuelve en dos comandos.

**Protección contra estampida:** cuando caduca la entrada de un curso popular a
las 08:00, sin protección las 300 peticiones simultáneas van todas a Postgres a
calcular lo mismo. Con el cerrojo, una recalcula y las demás esperan y leen.

**Degradación:** un fallo de lectura o escritura en caché se registra y se ignora
(se va a la base). Un fallo de **invalidación** sí se propaga: seguir mostrando
contenido retirado a propósito es peor que un error.

---

## 6. Estado fuera del proceso

Sesiones, cachés, contadores de límite y cerrojos viven en Redis. Con N réplicas
detrás de un balanceador, el estado local es incorrecto por definición: un
contador en memoria permitiría N veces el límite real y se perdería en cada
despliegue.

Esto es lo que hace que las réplicas sean **intercambiables** y, por tanto, que
el autoescalado y el despliegue sin caída funcionen.

---

## 7. Despliegue sin caída

Al recibir `SIGTERM`:

1. La sonda de readiness empieza a fallar → el balanceador **deja de enviar**
   peticiones nuevas a esta réplica.
2. Se espera 5 segundos, porque los balanceadores tardan en darse cuenta. Cerrar
   de inmediato produce los **502 clásicos de cada despliegue**.
3. Se cierra el servidor HTTP, terminando las peticiones en vuelo.
4. Limpieza del servicio: último drenaje de la outbox, cierre de pools.
5. Si algo se atasca, un temporizador fuerza la salida.

Las tres sondas son distintas a propósito: `live` **nunca** toca dependencias
—si lo hiciera, una caída de Redis provocaría reinicios en bucle de todas las
réplicas, que es lo contrario de lo que se quiere—; `ready` sí las comprueba,
porque su fallo solo retira la réplica del balanceador sin matarla.

---

## 8. Frontend (planificado)

- **Next.js 15 con App Router y React Server Components.** El contenido educativo
  es mayoritariamente estático por usuario: renderizarlo en el servidor y enviar
  HTML reduce el JavaScript en dispositivos escolares, que suelen ser modestos.
- **next-intl** para es/en, con español por defecto.
- **Skeletons** vía Suspense: placeholders con la forma del contenido real
  mientras carga, no un spinner genérico.
- **Tailwind CSS v4** con tokens de diseño por portal: Discover y Academy
  comparten sistema pero no paleta ni densidad.
- **Iconografía propia** (`@glexco/icons`) para robots, insignias y niveles;
  Lucide para el cromo de interfaz.
- **Accesibilidad WCAG 2.1 AA.** No es un extra: es una plataforma escolar y
  habrá alumnos con discapacidad visual o motora usándola.

---

## 9. El canje del código: dos entradas, un solo camino

El código de activación es lo único de la plataforma que vale dinero por sí
mismo, y su canje se puede pedir de dos formas:

- **Por HTTP**, cuando un alumno ya registrado activa un segundo libro. Llega el
  código; se busca por su hash.
- **Al consumir `identity.user.registered.v1`**, que es lo que cierra el flujo
  del registro. Llega el **id de la fila**, no el código.

Las dos terminan en el mismo caso de uso a propósito. La garantía de un solo uso
es la invariante más delicada del sistema y se apoya en tres piezas —una
transacción, `SELECT … FOR UPDATE` sobre la fila y el rechazo del agregado—;
tenerla escrita dos veces es la forma segura de que una de las dos copias se
quede atrás en el próximo cambio.

### Por qué el evento no lleva el código

Identidad **no puede** canjear durante el registro: exigiría una transacción
distribuida con catálogo que no existe. Lo que hace es una comprobación previa de
lectura, para que un código mal tecleado falle de inmediato en el formulario.

Para que catálogo pueda completar el canje después necesita saber qué fila tocar.
La opción evidente —meter el código en el evento— es la mala: los eventos viven
días en la outbox y en el stream de JetStream, y ahí un secreto con valor
económico multiplica su superficie de exposición sin que ningún consumidor lo
necesite. El evento lleva el `activationCodeId`: un UUID de fila no permite
deducir el código, y el endpoint público solo acepta el código, así que conocerlo
tampoco sirve para canjear nada.

### Qué pasa si alguien gana la carrera

Entre la comprobación del formulario y el consumo del evento, otro alumno puede
canjear ese mismo código. El consumidor lo detecta, lo registra y **da el evento
por procesado**: reintentar no puede arreglarlo, y hacerlo en bucle solo llenaría
el log y acabaría en la cola de mensajes muertos. El alumno queda registrado sin
acceso al kit, que es un estado que soporte puede resolver; el camino contrario
—reventar y reprocesar el alta— no le devolvería el código.

---

## 10. La versión optimista no es el contador de eventos

`AggregateRoot` tiene dos operaciones que avanzan la versión, y la distinción
importa:

- `record(...)` — registra un hecho que otros servicios deben conocer **y**
  avanza la versión.
- `touch()` — solo avanza la versión.

Existen las dos porque hay cambios de estado que deliberadamente no son un hecho
publicable. Un inicio de sesión correcto es el ejemplo: si emitiera evento, un
ataque de fuerza bruta generaría millones de eventos inundando la outbox y el
bus. Pero **sí modifica la fila** (`last_login_at`, contador de intentos), y
todos los UPDATE llevan `WHERE version < :nueva`.

Con solo `record`, la consecuencia era que iniciar sesión fallaba con un
conflicto de concurrencia inventado: la versión no avanzaba, el UPDATE no
encontraba ninguna fila y el repositorio lo interpretaba como escritura
concurrente. Ninguna prueba en memoria lo veía, porque el doble del repositorio
no comprueba versiones.

---

## 11. La analítica es una proyección, no una consulta

`analytics-service` **no es fuente de verdad de nada**. Todo lo que guarda se
puede reconstruir reproduciendo el stream de eventos, y esa propiedad es lo que
lo hace seguro de tocar: un error de cálculo aquí es un reproceso, no una pérdida
de datos.

### Por qué no consulta en vivo los otros schemas

La alternativa evidente sería que cada dashboard consultara evaluación, catálogo
e instituciones al abrirse. Se descartó por tres razones, en orden de gravedad:

1. **Rompería el aislamiento entre bounded contexts.** Un `JOIN` que cruza tres
   schemas ata los tres servicios: ninguno podría cambiar su esquema sin romper
   los informes, y el aislamiento por rol de base de datos —un rol por servicio,
   sin permiso sobre los demás— hace que ese `JOIN` ni siquiera sea posible sin
   debilitarlo.

2. **No aguanta la escala objetivo.** Con ~8M de registrados, una agregación en
   vivo sobre millones de entregas no responde en el tiempo de una petición web.
   El panel del director tiene que abrir en menos de un segundo o no se usa, y un
   panel que no se usa no renueva ningún contrato.

3. **Los números pueden ir por detrás sin consecuencia.** Ninguna decisión de
   negocio los consulta: se **miran**. Eso es exactamente lo que autoriza una
   proyección asíncrona, y lo que no autorizaría cachear un derecho de acceso.

### Qué se precalcula y qué no

- **Se precalcula** todo lo que agrega más de un salón: los resúmenes por salón e
  institución se recalculan al llegar cada entrega corregida. El panel del
  director agrega todos sus salones; sin materializar, abrirlo dispararía una
  agregación sobre las entregas del colegio entero.
- **Se calcula al vuelo** el dashboard del alumno y las preguntas más falladas de
  un salón: son decenas de filas por una clave indexada.
- **Se recalcula entero, nunca por incrementos.** Un contador incremental se
  desvía con el primer evento perdido o repetido, y nadie lo nota hasta que
  alguien cuestiona una cifra. Recalcular desde los hechos garantiza que el
  resumen sea siempre coherente con ellos.

### El evento lleva lo que el consumidor necesita

`assessment.submission.graded.v1` viaja con más de lo necesario para identificar
la entrega: lleva `kitId`, `origin`, `institutionId` y los fallos por pregunta.

Es deliberado. Si no los llevara, la analítica tendría que llamar de vuelta al
servicio de evaluación por cada entrega, y eso convierte una proyección
asíncrona en una **dependencia sincrónica** entre servicios: justo lo que el bus
existe para evitar.

`origin` merece mención propia: es el campo que decide si un dato es **comparable
entre colegios**. Solo lo son las evaluaciones de GLEXCO. Sin ese campo, los
dashboards mezclarían el banco común con lo que escribe cada docente, y una
institución podría subir su media poniendo exámenes fáciles.

### La institución es la del ALUMNO, no la de la evaluación

Una evaluación de GLEXCO no pertenece a ninguna institución —es común a todas—,
pero la entrega de un alumno del San Juan sí es del San Juan, y es ahí donde tiene
que contar.

Tomarla de la evaluación dejaba sin institución todos los resultados del banco
común, que son precisamente los únicos comparables: el panel del director salía
con cero alumnos medidos aunque su clase entera hubiera respondido. La institución
se fija al abrir el intento, desde el token del alumno.

### El ámbito se comprueba dos veces

El guard de permisos sabe si alguien puede "leer analítica de salón". Solo el
controlador, con el salón concreto delante, sabe si **ese** salón es suyo. Las
dos comprobaciones hacen falta y ninguna sustituye a la otra: aquí hay datos de
menores, y un permiso sin comprobación de recurso significa que conocer un
identificador basta para ver el progreso de otro colegio.
