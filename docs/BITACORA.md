# Bitácora de trabajo

Registro por sesión: **qué se hizo**, **por qué**, **qué falta**. Es el documento
que debe leer primero cualquier instancia de Claude que retome el proyecto.

Entradas en orden cronológico inverso (lo más reciente arriba).

---

## Sesión 7 — 2026-09-02 — Arranque de la Fase 4 y aclaración sobre el video

### Aclaración del cliente que cambió una decisión

El cliente aclaró que **no hay videollamadas ni subidas de video por parte de los
colegios**: los tutoriales los produce GLEXCO y son los mismos para todos.

Eso convierte el catálogo de video en algo **fijo y pequeño**, que abarata mucho
la factura del proveedor externo, pero no elimina la necesidad de tenerlo: un
tutorial de 10 min en 720p pesa ~150 MB y visto por 100.000 alumnos son 15 TB de
salida, que a precio de almacenamiento de objetos son cuatro cifras por un solo
video. Además, un MP4 servido tal cual no se adapta a la conexión, y en un
colegio con mala línea el alumno mira la rueda girando en vez de la clase.

**Cambio aplicado:** `media-service` ya no acepta video en cualquier ámbito. La
tabla `SCOPE_TYPES` restringe `video/mp4` al ámbito `content` —material de
GLEXCO—; las evidencias quedan en foto y PDF, y los avatares solo en imagen.

**Contradicción abierta:** el roadmap de la Fase 5 dice *"Evidencias (foto/video)
del alumno"*. Con la aclaración de esta sesión, las evidencias son solo foto. Si
en algún momento un alumno debe grabar su robot funcionando, hay que revisarlo.

### Qué se construyó de la Fase 4

**`@glexco/icons`** con nueve iconos del dominio (robot, kit, insignia, nivel,
reto, código, salón, certificado, biblioteca). Solo iconos de dominio: redibujar
una lupa no aporta nada y resta consistencia, así que el cromo de interfaz sigue
viniendo de Lucide. Todos en `currentColor` y `aria-hidden` por defecto.

**`apps/web`** en Next.js 15 con App Router y React Server Components:

- Sistema de diseño con los tokens del canvas aprobado.
- Ingreso, cierre de sesión y enrutado al portal según edad y rol.
- Portadas de Discover y Academy leyendo el kit real del catálogo.
- Estados vacíos que dicen qué hacer, esqueletos con la forma del contenido,
  foco visible y salto al contenido.

**`pnpm smoke:web`**: 17 comprobaciones del portal contra el backend real.

### Decisiones no obvias

- **El token vive en una cookie `httpOnly` y las llamadas autenticadas se hacen
  desde el servidor.** Meterlo en `localStorage` —que es lo habitual en
  tutoriales de Next— lo deja al alcance de cualquier script inyectado: un solo
  XSS en cualquier dependencia del frontend se convierte en el robo de la sesión
  de todos los alumnos.

- **Discover y Academy comparten componentes y difieren en densidad**, declarada
  una sola vez en el layout con `data-portal`. Si cada componente llevara su
  propia variante, la coherencia dependería de que nadie se olvidara de pasarla.
  No es decoración: un niño de seis años necesita objetivos grandes y aire, y un
  estudiante de instituto necesita ver más por pantalla sin que le hablen como a
  un niño.

- **La navegación difiere de verdad, no solo en etiquetas.** Un niño de primaria
  no tiene certificaciones ni portafolio. Compartir la barra y renombrar sería
  mentir sobre lo que hay detrás.

- **El formulario de ingreso funciona sin JavaScript.** `useActionState` sobre un
  `<form action>` degrada a un envío normal del navegador: en un laboratorio con
  equipos viejos o una conexión que corta el bundle a mitad, el alumno sigue
  pudiendo entrar.

- **Esqueletos con la forma del contenido, no spinners.** Un spinner no dice nada
  y hace que la página salte cuando llega el contenido; un esqueleto reserva el
  hueco y evita el desplazamiento de maquetación.

### Errores encontrados y corregidos

- **`/auth/me` no servía para nada.** Devolvía los claims del token, que quien
  llama ya tiene. El nombre, el correo y el avatar no viajan en el token a
  propósito —son millones de tokens en cada petición—, así que el portal no podía
  ni saludar al alumno por su nombre. Ahora lee de la base y devuelve además el
  **portal**, que depende de la edad y de los roles: sacarlo del token dejaría a
  un docente recién nombrado viendo el portal de alumno hasta que su token
  caducara. Los permisos se recalculan desde los roles, no se copian del token,
  porque un rol retirado dejaría el menú mostrando opciones que el backend ya
  rechaza.

- **Un módulo con `'use server'` solo puede exportar funciones asíncronas.**
  `portalPath` era un ayudante síncrono en `auth.actions.ts` y rompía la
  compilación. Movido a `lib/portal.ts`.

- **El nombre de la variable del gateway no coincidía** (`NEXT_PUBLIC_GATEWAY_URL`
  frente al `NEXT_PUBLIC_API_URL` que ya existía en `.env`).

### Un hallazgo que conviene conocer

En `next dev`, **el access token aparece en el HTML**: React 19 serializa en el
payload de depuración los valores que atraviesan sus funciones instrumentadas, y
ahí cae la cookie entera. Se comprobó contra el build de producción y **allí no
aparece**, así que no es una vulnerabilidad desplegada. Aun así conviene no
compartir pantalla ni el `view-source` de un servidor de desarrollo con la sesión
iniciada. `web-check.mjs` distingue los dos casos en vez de dar por bueno
cualquiera de ellos.

### Estado al cerrar

- `pnpm build`: **11/11** (10 del backend más el portal). `pnpm test`: **118**.
- `pnpm smoke`: **51/51**. `pnpm concurrency`: **14/14**. `pnpm smoke:web`: **17/17**.
- Siete procesos en marcha: identity, institutions, catalog, media, gateway, el
  portal y la infraestructura.
- **Sin push todavía**, por decisión del cliente.

### Qué falta de la Fase 4

Las pantallas interiores de los dos portales (laboratorio, cursos, retos,
biblioteca con reproductor, logros, certificaciones, portafolio, perfil), el
registro y la activación de código desde el portal, la internacionalización con
next-intl —hoy los textos están en español en el código— y la auditoría de
accesibilidad pantalla a pantalla.

---

## Sesión 6 — 2026-09-02 — Cierre de la Fase 3

Continuación directa de la sesión 5, en la misma máquina y con la
infraestructura ya en marcha. Se cerraron los cuatro pendientes que quedaban de
la Fase 3.

### Qué se construyó

**Lotes de códigos para imprenta.** `POST /catalog/batches` genera la tirada y
devuelve los códigos **en claro una sola vez**; con `format=csv` la respuesta es
directamente el fichero que va a la imprenta. `GET /catalog/batches/:id` responde
la pregunta comercial de verdad: de los mil libros del colegio, cuántos niños
entraron.

**Canje asíncrono.** Catálogo consume `identity.user.registered.v1` y completa el
canje. Es lo que cierra el flujo del registro sin transacción distribuida:
identidad solo puede *comprobar* el código.

**Anulación de códigos y derechos.** Anular un código retira, en la misma
transacción, el acceso que concedió. `GET /catalog/batches/:id/codes` lista los
códigos por sufijo para que soporte localice la fila.

**Caché de catálogo con invalidación por etiqueta.** `CachedContentRepository`
decora el repositorio y agrupa las entradas por `kit:<id>`. `POST
/catalog/content/:id/status` publica, revisa, devuelve a borrador o archiva, e
invalida el kit entero.

**`media-service` completo.** Subidas con URL prefirmada, validación del tipo
real por firma binaria, miniaturas con sharp y proveedor de video tras un puerto.

### Decisiones no obvias

- **El evento de registro lleva el `activationCodeId`, no el código.** El canje
  asíncrono necesita saber qué fila tocar, pero el código es un secreto con valor
  económico y el evento vive días en la outbox y en el stream. Un UUID de fila no
  permite deducirlo, y el endpoint público solo acepta el código.

- **Las dos vías de canje comparten el mismo caso de uso.** Una busca por hash y
  la otra por id, pero desde el bloqueo de fila en adelante el camino es
  idéntico. La garantía de un solo uso escrita dos veces es la forma segura de
  que una de las copias se quede atrás.

- **No hay endpoint para volver a descargar el CSV de un lote.** En la base solo
  queda el hash, así que reconstruirlo es imposible por diseño. Si alguien lo
  pide, la respuesta es repetir la tirada, no relajar el hasheo.

- **La URL de subida se firma como POST con política, no como PUT.** Es la
  diferencia entre poder limitar el tamaño y no poder: un PUT prefirmado
  autoriza a escribir en esa clave y punto, así que cualquiera con la URL sube un
  fichero de cien gigabytes. La política del POST lleva `content-length-range` y
  es el propio almacén quien rechaza, sin que nosotros veamos un byte.

- **El tipo de un archivo se decide por sus bytes.** La extensión y el
  `Content-Type` los escribe el cliente. `MagicBytesSniffer` tiene una lista
  cerrada de firmas y se escribió a mano en vez de traer una librería de
  detección: una librería genérica reconoce cientos de formatos, y lo que
  interesa aquí es rechazar todo lo que no esté en la lista. La comprobación que
  decide si un fichero entra al bucket no debería depender de código que nadie
  del equipo ha leído.

- **Se leen solo los primeros bytes, con `Range`.** Para decidir si un fichero es
  lo que dice bastan doce. Bajarse dos gigabytes de vídeo por cada subida sería
  absurdo, y con un aula entera entregando evidencias a la vez, ruinoso.

- **El límite de píxeles de sharp no es opcional.** Una imagen de 40000×40000
  comprime a pocos kilobytes y pasa cualquier límite de tamaño, pero obliga a
  reservar gigabytes al descomprimirla. Con subidas abiertas a miles de alumnos
  no es un escenario teórico.

- **La caché no cubre nada que decida un permiso.** Los derechos de acceso se
  consultan siempre contra la base: cachearlos convertiría un acceso retirado en
  un acceso que sigue funcionando hasta que expire.

- **Si la invalidación de caché falla, la operación falla.** Al revés que la
  lectura, que se degrada en silencio. Si alguien archiva un contenido y la caché
  sigue sirviéndolo, quien lo retiró cree que ya no se ve.

- **Publicar exige pasar por revisión.** La tabla de transiciones prohíbe el
  salto de borrador a publicado: este contenido lo ven niños de seis años y la
  revisión es el único punto donde alguien distinto del autor lo mira.

### Errores encontrados y corregidos

- **`redeemed_fields_consistent` impedía anular un código canjeado.** La
  restricción exigía que cualquier estado distinto de `redeemed` tuviera
  `redeemed_by` a NULL. Estaba pensada para los estados que *preceden* al canje y
  atrapaba también a `revoked`, así que la única forma de anular habría sido
  borrar quién lo usó. De los tres motivos de anulación —error de imprenta,
  devolución, fraude— en el tercero ese dato es el principal de la investigación.
  Corregido en la migración `0002`.

- **Anular dos veces daba un conflicto de concurrencia inventado.** Misma clase
  de error que el del inicio de sesión en la sesión 5: el agregado sale sin
  cambiar nada, la versión no avanza y el `UPDATE ... WHERE version < :nueva` no
  encuentra fila. Aquí lo correcto es no escribir, así que se sale antes de
  guardar.

- **Una variable vacía en `.env` no es lo mismo que ausente.**
  `VIDEO_PROVIDER_URL=` llegaba como cadena vacía y `z.string().url().optional()`
  la trataba como valor presente e inválido: el servicio se negaba a arrancar por
  una variable que se dejó en blanco a propósito. Se añadió `optionalEnv` a
  `@glexco/config`.

- **La identidad de git en esta máquina era un marcador de posición**
  (`OTRO_USUARIO <otro_correo@ejemplo.com>`). Los dos commits de la sesión 5
  llevaban ese autor. Como no se habían subido, se reescribieron a
  `SvaleraG <svalera.glexco@gmail.com>`, que es el resto del historial.

### Estado al cerrar

- `pnpm build`: **10/10**. `pnpm test`: **118 en verde**.
- `pnpm smoke`: **51/51**, con secciones nuevas de catálogo, contenido y medios.
- `pnpm concurrency`: **14/14**.
- Cinco servicios en marcha: identity, institutions, catalog, media y el gateway.
- **Sin push todavía**, por decisión del cliente: se subirá cuando haga falta
  probar el backend desplegado.

### Qué falta

**La Fase 3 está cerrada.** El siguiente paso es la **Fase 4**, los portales de
alumno, con la dirección visual ya aprobada en `design/canvas/`.

Sueltos, sin bloquear nada: programar la limpieza de subidas abandonadas
(`listAbandoned` ya existe), contratar el proveedor de video real, y los
endpoints de alta y edición de contenido —hoy se siembra por SQL y solo el cambio
de estado de publicación tiene API—.

---

## Sesión 5 — 2026-09-02 — Primera ejecución real, y cierre del canje asíncrono

Primera sesión en una máquina con Docker. Todo el backend estaba escrito,
compilado y probado en memoria, pero **nunca se había ejecutado**. Al hacerlo
aparecieron nueve fallos que ninguna prueba unitaria podía ver, y las cuatro
comprobaciones de concurrencia de [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md)
pasaron a estar verificadas de verdad.

### Qué se hizo

**La infraestructura arrancó y las migraciones se aplicaron.** Los seis
contenedores en `healthy` y los tres schemas creados (`identity` 7 tablas,
`institutions` 8, `catalog` 11).

**`pnpm smoke` en verde: 32 comprobaciones**, ocho de ellas nuevas.
**`pnpm concurrency` en verde: 14 comprobaciones** que solo tienen sentido
contra infraestructura real.

**Fase 3, dos puntos cerrados:**

- **Generación de lotes y exportación para imprenta.** `POST /catalog/batches`,
  con `format=csv` para el fichero que va a la imprenta, más el resumen del lote
  (`GET /catalog/batches/:id`) que responde a la pregunta comercial de verdad:
  de los mil libros del colegio, cuántos niños entraron.
- **Consumidor en catálogo de `identity.user.registered.v1`.** El canje deja de
  ocurrir solo por HTTP: ahora se completa al consumir el alta, que es lo que
  cierra el flujo del registro sin transacción distribuida.

### Los nueve fallos que solo aparecen al ejecutar

Ordenados por lo que costaba encontrarlos, no por gravedad.

1. **`tsx` rompía la inyección de dependencias en silencio.** El script `dev`
   usaba tsx, que compila con esbuild, y esbuild **no implementa
   `emitDecoratorMetadata`**. Sin esa metadata NestJS no conoce el tipo de los
   parámetros del constructor y le inyecta `undefined` a todos. El servicio
   arrancaba, mapeaba sus rutas, pasaba el health check y reventaba en la
   **primera petición** con `Cannot read properties of undefined`. Es el peor
   modo de fallo posible: silencioso al arrancar y distinto entre desarrollo y
   producción, que sí compila con `tsc`.
   **Solución:** `infra/scripts/dev-service.mjs` compila con `tsc` y vigila, el
   mismo compilador en los dos entornos.

2. **Con la metadata correcta, Nest falló al arrancar** — que es lo que debía
   pasar desde el principio. Tres controladores recibían interfaces
   (`CookieOptions`) o puertos del dominio (`EntitlementRepository`,
   `InstitutionRepositoryPort`), que no existen en tiempo de ejecución. Ahora
   llevan `@Inject(TOKEN)` explícito, y los tokens salieron de los módulos a un
   `tokens.ts` propio para que los controladores puedan importarlos sin ciclo.

3. **Las sondas de salud eran inalcanzables.** El `exclude` del prefijo global
   quitaba el `/api` pero no el segmento de versión, así que `/health/live`
   estaba realmente en `/v1/health/live`; y con los guards globales respondía
   **401**. Un orquestador no lleva token: habría leído cada sonda como réplica
   muerta y habría reiniciado los servicios en bucle. Ahora son
   `VERSION_NEUTRAL` y `@Public()`.

4. **La API interna tenía la versión duplicada.** `internal/v1/...` más el
   versionado por URI daba `/api/v1/internal/v1/...`. Identidad llamaba a la ruta
   sin ese segundo `/v1`, recibía 404 y —porque un 404 significa "ese código no
   existe"— lo traducía a *código de libro inválido*. Un fallo de enrutado
   disfrazado de error de negocio.

5. **El gateway rompía las respuestas grandes.** Copiaba el `content-encoding`
   del servicio de destino hacia el cliente, pero `fetch` ya había descomprimido
   el cuerpo. Solo se notaba por encima del umbral de compresión: el login, por
   el tamaño de la lista de permisos.

6. **El gateway rompía las peticiones sin cuerpo.** Reenviaba el
   `content-length` del cliente y a la vez reserializaba el cuerpo: anunciaba
   cero bytes y enviaba `{}`. El destino cerraba el socket sin responder. En
   login y registro coincidían por casualidad; en `POST /auth/refresh`, no.

7. **Iniciar sesión fallaba con un conflicto de concurrencia inventado.** La
   versión optimista solo avanzaba al emitir un evento de dominio, y un inicio de
   sesión correcto no emite ninguno a propósito (en un ataque serían millones de
   eventos inundando la outbox). Pero sí cambia la fila, así que el
   `UPDATE ... WHERE version < :nueva` no encontraba nada. Se añadió
   `AggregateRoot.touch()`: **emitir un evento y avanzar la versión son dos cosas
   distintas**, y confundirlas rompe justo las operaciones más frecuentes.

8. **El canje siempre daba error 500.** El id del `Entitlement` se construía con
   `hex(16).slice(0,32)`: 32 caracteres sin guiones, que no son un UUID. Se
   añadió `uuid()` al puerto `SecureRandom` para que el error no se repita.

9. **Las migraciones no podían ejecutarse.** Tres cosas: `citext` y `btree_gist`
   las tiene que crear el superusuario del contenedor (el rol de cada servicio no
   tiene `CREATE` sobre la base, y no debe tenerlo); `unaccent()` es `STABLE` y
   PostgreSQL lo rechaza dentro de la expresión de un índice, así que ahora hay
   un `public.immutable_unaccent` que fija el diccionario; y
   `CREATE SCHEMA IF NOT EXISTS` falla igualmente porque el motor comprueba el
   permiso sobre la base **antes** que la existencia del schema.

### Decisiones no obvias de esta sesión

- **El evento de registro lleva el `activationCodeId`, no el código.** El canje
  asíncrono necesita saber qué fila canjear, pero el código es un secreto con
  valor económico y el evento vive días en la outbox y en el stream. El id de una
  fila no permite deducir el código ni sirve para canjear por HTTP, donde el
  endpoint solo acepta el código.

- **Las dos vías de canje comparten el mismo caso de uso.** El canje por HTTP
  busca por hash y el que viene del evento busca por id, pero desde el bloqueo de
  fila en adelante el camino es idéntico. La garantía de un solo uso es la
  invariante más delicada de la plataforma: tenerla escrita dos veces es la forma
  segura de que una de las dos copias se quede atrás.

- **Un código ya canjeado por otro alumno no se reintenta.** Si entre la
  comprobación del formulario y el consumo del evento alguien gana la carrera,
  reintentar no puede arreglarlo: se registra y se da el evento por procesado. El
  alumno queda registrado sin acceso al kit, que es recuperable por soporte;
  reventar y reprocesar el alta no le devolvería el código.

- **No hay endpoint para volver a descargar el CSV de un lote,** y es
  deliberado. En la base solo queda el hash de cada código, así que reconstruir
  el fichero es imposible por diseño: un volcado de la tabla no debe convertirse
  en miles de accesos vendibles. La respuesta de generación lo advierte de forma
  explícita.

- **Los códigos se generan FUERA de la transacción.** Cien mil códigos son
  varios segundos de CPU; tener una transacción abierta mientras tanto retendría
  una conexión y bloquearía el vacuum sin necesidad.

- **`pnpm smoke` prueba la ventana de gracia por sus dos lados.** La prueba
  anterior reutilizaba el refresh token antiguo cincuenta milisegundos después y
  esperaba que se detectara como robo. Era la prueba la que estaba mal: esa
  ventana de diez segundos existe justamente para que dos pestañas del mismo
  navegador no se cierren la sesión entre ellas. Ahora se comprueba que dentro de
  la ventana se acepta y fuera se revoca.

- **Postgres se publica en el puerto 5433 en esta máquina.** El 5432 lo ocupa
  otro proyecto del cliente; se parametrizó el puerto en el compose
  (`GLEXCO_POSTGRES_PORT`, en `infra/docker/.env`) en vez de parar un contenedor
  ajeno.

### Herramientas nuevas

| Comando | Qué hace |
|---|---|
| `pnpm seed` | Kit, lote de códigos, institución y salón. Necesario desde que identidad habla con el catálogo real en vez de con el doble en memoria. |
| `pnpm concurrency` | Las cuatro comprobaciones de la sección 3 de PUESTA-EN-MARCHA, con `Promise.all`. |
| `pnpm smoke` | Ahora 32 comprobaciones, con una sección de catálogo. |

### Estado al cerrar

- `pnpm build`: **9/9**. `pnpm test`: **118 en verde**.
- `pnpm smoke`: **32/32** a través del gateway.
- `pnpm concurrency`: **14/14** contra Postgres, Redis y NATS reales.
- Un canje de veinte simultáneos, cinco plazas de veinte solicitudes, la outbox
  reteniendo el evento con NATS parado y publicándolo al volver, y el mismo
  evento entregado dos veces aplicándose una.

### Qué falta

**Fase 3:** `media-service` (subida con URL prefirmada, validación de tipo real,
proveedor de video), caché de catálogo con invalidación por etiqueta al
publicar, y revocación de códigos y derechos —el permiso
`ACTIVATION_CODE_REVOKE` existe pero todavía no hay caso de uso que lo ejerza.

**Aviso para la próxima sesión:** `ACTIVATION_REDEEM_BY_IP` son cinco intentos
por IP y hora, y `REGISTRATION_BY_IP` diez. Son los valores correctos y no hay
que relajarlos, pero agotan el presupuesto en dos o tres ejecuciones seguidas de
`pnpm smoke` desde la misma máquina. Para limpiarlos:

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL"
```

---

## Sesión 4 — 2026-09-02 — Fases 2 y 3, y dirección visual

### Qué se construyó

**Fase 2 cerrada** — servicio `institutions`: instituciones, licencias, salones
con tope de plazas, matrículas, consumidor de eventos de identidad y tarea de
vencimiento de licencias. Detalle en la entrada de la sesión anterior y en el
roadmap.

**Fase 3 avanzada** — servicio `catalog`: el núcleo del modelo de negocio.
`ActivationCode`, `Entitlement`, kits y contenido académico, con repositorios
PostgreSQL, API HTTP y el endpoint interno que consulta identidad durante el
registro.

**Dirección visual aprobada** — canvas de 10 artboards en `design/canvas/`,
publicado como artifact: ingreso, los cuatro portales, fundamentos, iconografía
propia, dos vistas móviles y modo oscuro.

### Decisiones no obvias

- **El código de activación se guarda hasheado**, con una pimienta que vive en
  configuración y no en la base. Un volcado de la tabla no debe convertirse en
  miles de accesos vendibles. Se usa SHA-256 y no Argon2 porque el código tiene
  ~60 bits de entropía genuina: no hay diccionario que atacar, y un hash lento
  solo añadiría latencia al registro.

- **`ACTIVATION_CODE_PEPPER` no tiene valor por defecto.** Si lo tuviera, un
  despliegue descuidado usaría el de ejemplo y los hashes serían reproducibles
  por cualquiera que lea el repositorio. Cambiarla invalida todos los códigos
  emitidos: se fija una vez y no se rota.

- **Generación con `randomInt` de `node:crypto`, no `Math.random`.** El segundo
  es predecible desde la semilla del proceso: quien observara unos códigos de un
  lote podría predecir el resto. `randomInt` evita además el sesgo módulo que
  introduciría `bytes % alfabeto`.

- **El `Entitlement` se crea en la misma transacción que el canje.** Hacerlo
  después dejaría al alumno con el código quemado y sin acceso si algo fallara
  entre medias, y ese código ya no volvería a servir.

- **Los eventos no llevan el código.** Viven días en la outbox y en el stream, y
  ningún consumidor lo necesita.

- **`listLibrary` exige `kitId` obligatorio** y no existe un listado global de
  contenido en la interfaz del repositorio: sería el atajo por el que se
  filtraría material de kits no comprados.

- **La paleta salió del logo real**, no de una suposición. Descargué el SVG de
  glexrobotics.com: `#2C53A0` y `#86C9BD` son las dos paradas de su degradado.
  Antes había construido la paleta deduciéndola de las maquetas, y estaba mal.

### Errores corregidos

- **El logger estaba roto en silencio.** Las firmas de pino y de `LoggerPort`
  están invertidas, y el casteo que había hacía que pino interpretara el mensaje
  como contexto: las líneas de log salían sin los campos por los que hay que
  filtrar en producción. Se añadió `toLoggerPort` y dos tokens de inyección
  distintos para que el error no se pueda repetir.

- **`upsert` para renombrar borraba datos.** Reflejar un cambio de nombre en el
  directorio de docentes con un upsert borraba la institución y el correo, que
  ese evento no trae. Se añadió `rename`.

- **Mi reemplazo automático del logo rompió la pantalla de ingreso**: dejó un
  `</div>` de más que cerraba el panel de marca antes de tiempo. Lo detectó el
  cliente en una captura. Ahora hay una comprobación de balance de etiquetas.

- **Fundamentos declaraba 1180px con 1660px de contenido** y recortaba una
  sección entera; el gris de las etiquetas pequeñas daba 3,05:1 sobre blanco; y
  había tres contradicciones de contenido entre portales sobre el kit y el grado
  del mismo alumno.

### Estado al cerrar

- **9 paquetes y servicios compilan. 118 pruebas en verde**, en memoria y sin
  Docker.
- **Nada se ha ejecutado nunca contra infraestructura real.** Docker no llegó a
  arrancar en esta máquina: corrupción del almacén de componentes de Windows
  (`0x80188306`, doble titularidad de dos ensamblados de `Microsoft.GroupPolicy`)
  que resistió a `StartComponentCleanup`, `ResetBase`, `RestoreHealth` y `sfc`.
  Lo que queda es una reparación en el sitio del sistema operativo.

### Siguiente paso

Levantarlo en una máquina con Docker y verificar las cuatro cosas que justifican
la arquitectura y que **la concurrencia real puede desmentir**: el canje de un
solo uso, el tope de plazas, que la outbox no pierde eventos y la deduplicación.
Todo el procedimiento está en [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md).

---

## Sesión 3 — 2026-09-02 — Cierre de la Fase 1 y gateway

### Qué se construyó

**Casos de uso que faltaban en identidad:**
- `ChangePasswordUseCase` — cambio de contraseña autenticado.
- `CreateStaffUserUseCase` — alta de docentes, administradores de institución y
  personal GLEXCO, con contraseña temporal de un solo uso.
- `ListSessionsUseCase` / `RevokeSessionUseCase` — gestión de sesiones activas.
- `AccountController` y `UsersController` para exponerlos.

**Servicio `api-gateway`**, el único expuesto a internet:
- Tabla de enrutado **explícita** (prefijo público → servicio interno).
- Propagación y saneado del `x-correlation-id`.
- Rate limiting en el borde, más estricto en las rutas de autenticación.
- Un circuit breaker **por servicio**.
- Sondas `live`/`ready` y apagado ordenado con drenaje.

**Herramientas de desarrollo:**
- `pnpm setup` (`infra/scripts/setup-env.mjs`) genera `.env` con secretos
  criptográficos reales y nunca sobrescribe uno existente.
- `pnpm smoke` (`infra/scripts/smoke-test.mjs`) ejecuta 22 comprobaciones de
  punta a punta contra los servicios en ejecución.
- Los scripts `dev` y `start` usan `node --env-file-if-exists`, que carga el
  `.env` en local y no falla en Railway, donde las variables las inyecta la
  plataforma y el archivo no existe.

**21 pruebas nuevas** (total: **65**), centradas en lo que puede causar daño real:
aislamiento entre instituciones, escalada de privilegios, y que nadie pueda
cerrar la sesión de otro usuario.

### Decisiones no obvias de esta sesión

- **El cambio de contraseña exige la contraseña actual** aunque la sesión ya esté
  autenticada. En un laboratorio escolar las sesiones se quedan abiertas
  constantemente; sin esta comprobación, sentarse ante un equipo ajeno bastaría
  para apropiarse de la cuenta. Con ella, el descuido es temporal en vez de
  definitivo.

- **`CreateStaffUserUseCase` IGNORA el `institutionId` del cuerpo** cuando el
  actor tiene ámbito de institución, y usa el del token. Aceptarlo permitiría a
  un administrador crear docentes en otro colegio cambiando un solo campo. Hay
  tres controles y ninguno sustituye a los otros: permiso (guard), matriz de
  roles (agregado) y ámbito (caso de uso). El tercero **solo** puede vivir en el
  caso de uso, porque el guard no ve el cuerpo y el agregado no sabe a qué
  institución pertenece quien envía la petición.

- **Revocar una sesión comprueba que sea propia.** Sin esa comprobación, conocer
  un id de sesión bastaría para expulsar a cualquiera de la plataforma. Además,
  "no existe" y "es de otro" devuelven el mismo error, para no permitir sondear
  qué ids son reales.

- **El gateway usa `fetch` nativo en lugar de `http-proxy-middleware`.** No es
  minimalismo: hacen falta tres cosas que esa librería resuelve de forma opaca —
  qué cabeceras se propagan en cada sentido (para que un cliente no inyecte
  cabeceras de confianza ni se filtren las internas), el timeout por petición, y
  el circuit breaker por servicio.

- **`x-forwarded-for` entrante se descarta.** El gateway la fija desde la
  conexión real. Aceptar la del cliente permitiría falsificar la IP de origen y
  esquivar toda la limitación por IP.

- **La tabla de enrutado es explícita, no por convención.** Con enrutado por
  convención, añadir un servicio interno nuevo lo expondría a internet sin que
  nadie tomara la decisión.

### Verificaciones ejecutadas

Sin Docker todavía, pero sí contra los artefactos reales compilados:

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 7/7 paquetes y servicios compilan |
| `pnpm test` | **65 pruebas en verde** (~60 ms) |
| Carga de configuración con `.env` real | Válida; secretos de access y refresh distintos |
| Argon2id nativo (`@node-rs/argon2`) | Hash 13 ms, verificación correcta, `needsRehash` detecta parámetros débiles |
| Interoperabilidad con bcrypt | Argon2 verifica un hash bcrypt heredado y lo marca para rehash |
| Emisión de JWT | Access 379 bytes, 15 min; refresh 12 h sin "recordarme" y 30 días con él |
| Defensa: access como refresh | Rechazado (secretos distintos) |
| Defensa: `alg: none` | Rechazado |
| Defensa: audiencia incorrecta | Rechazada |
| Marca `crit` | Ausente en alumnos (ahorra bytes), presente en administradores |

### Estado del entorno

- **Docker Desktop instalado, pero no arranca.** Diagnóstico ejecutado:
  la virtualización **sí funciona** (`systeminfo` reporta "Seguridad basada en
  virtualización: En ejecución" y "Se detectó un hipervisor"; el
  `VirtualizationFirmwareEnabled: False` de `Win32_Processor` es un espejismo,
  porque con un hipervisor activo Windows no ve los flags crudos de la CPU).
  Lo que falta es **WSL**: `wsl --status` responde "El Subsistema de Windows para
  Linux no está instalado".
  **Solución:** `wsl --install` en PowerShell **como administrador** y reiniciar.
- Aviso: el equipo tiene **App Control for Business en modo "Forzado"**. Si es un
  portátil gestionado por TI, esa política puede bloquear la instalación de WSL.

### Siguiente paso

1. Con Docker en marcha: `pnpm infra:up`, `db:migrate`, arrancar identidad y
   gateway, y ejecutar `pnpm smoke`.
2. Fase 2 — instituciones, salones y licencias. O bien el canvas de Claude Design
   antes, para validar la dirección visual y la iconografía.

---

## Sesión 2 — 2026-09-02 — Fase 1: servicio de identidad

### Qué se construyó

El **microservicio `identity`** completo en su parte de autenticación, con
arquitectura hexagonal estricta.

**Dominio** (`src/domain/`, cero dependencias de framework):
- Agregado `User` con todas sus invariantes: alta de alumno, alta de personal,
  verificación de correo, cambio de contraseña, concesión y retirada de roles,
  desactivación y reactivación, bloqueo progresivo por intentos fallidos.
- Objetos de valor `Email`, `PersonName`, `BirthDate`, `PasswordHash`,
  `LocalePreference`, `UserId`.
- Ocho eventos de dominio versionados.
- `Session` y `SessionStore` como puerto (vive en Redis, no en PostgreSQL).

**Aplicación** (`src/application/`):
- `RegisterStudentUseCase`, `LoginUseCase`, `RefreshSessionUseCase`,
  `LogoutUseCase`, `VerifyEmailUseCase`, `RequestPasswordResetUseCase`,
  `ConfirmPasswordResetUseCase`.
- Puertos propios: `TokenIssuer`, `OneTimeTokenStore`, `ActivationCodeGateway`,
  `ClassroomGateway`, `PasswordPolicy`, `AuditLog`.
- `resolvePortal`: decide Discover / Academy / Teacher / Institution / Admin.

**Infraestructura** (`src/infrastructure/`):
- `Argon2PasswordHasher` (Argon2id, con bcrypt para migración y rehash automático).
- `JwtTokenIssuer` (secretos separados, algoritmo fijado).
- `PgUserRepository` con reparto entre pool de escritura y de lectura.
- `RedisSessionStore` con rotación atómica en Lua.
- `PgOneTimeTokenStore` (guarda el hash, nunca el token).
- `PgAuditLog` con escritura en lote diferida.
- `DefaultPasswordPolicy` (NIST SP 800-63B).
- Gateways HTTP con circuit breaker + dobles en memoria para desarrollo.

**Interfaz**: `AuthController` con registro, login, refresh, logout,
verificación de correo, recuperación de contraseña y `/me`.

**Persistencia**: migración `0001_identity_schema.sql` con `citext` para el
correo, índices parciales, restricciones `CHECK` que replican reglas del dominio
y concurrencia optimista. Ejecutor de migraciones (`infra/scripts/migrate.mjs`)
con cerrojo de aviso de PostgreSQL.

**Pruebas**: 44 pruebas en memoria (26 de dominio, 18 de casos de uso) que corren
en ~30 ms **sin Docker**, usando dobles escritos a mano de todos los puertos.

### Decisiones no obvias de esta sesión

- **El hash de la contraseña se calcula EL ÚLTIMO en el registro.** Argon2 cuesta
  ~80 ms y 19 MiB por operación. Si se hiciera antes de validar el correo
  duplicado y el código de activación, un atacante conseguiría que el servidor
  gastara ese coste en cada petición basura. Colocarlo detrás de todas las
  validaciones baratas es una defensa concreta contra el agotamiento de CPU.

- **Hash señuelo cuando el usuario no existe.** Sin él, "no existe" responde en
  microsegundos y "contraseña incorrecta" en decenas de milisegundos, y esa
  diferencia permite enumerar qué correos están registrados. El señuelo se
  calcula una sola vez por proceso: generarlo en cada intento convertiría la
  enumeración en un ataque de agotamiento de CPU.

- **Ventana de gracia de 10 s en la rotación del refresh token.** Dos pestañas
  del mismo navegador refrescan a la vez con frecuencia. Sin la gracia, la
  segunda parecería una reutilización y al usuario se le cerraría la sesión sin
  que nadie le haya robado nada. Un token robado nunca llega dentro de esa
  ventana.

- **El registro NO canjea el código de activación de forma síncrona.** Eso
  exigiría una transacción distribuida con catálogo, que no existe. Se hace una
  comprobación previa de lectura (para que un código inválido falle de inmediato
  en el formulario) y el canje real ocurre cuando catálogo consume
  `identity.user.registered.v1`, de forma idempotente y compensable.

- **El bloqueo de cuenta es temporal y creciente, nunca permanente.** Un bloqueo
  permanente convierte el ataque en una denegación de servicio contra el usuario
  legítimo: cualquiera que sepa un correo podría dejar fuera a esa persona.

- **`findByEmailForAuth` va contra el pool de ESCRITURA.** Es una lectura, pero
  alguien que acaba de registrarse e inicia sesión de inmediato no puede toparse
  con que la réplica todavía no lo tiene.

- **Los adaptadores en memoria de catálogo e instituciones no pueden llegar a
  producción.** `loadIdentityConfig` aborta el arranque si faltan `CATALOG_URL`
  o `INSTITUTIONS_URL` en producción. Sin esa comprobación, un despliegue
  descuidado aceptaría cualquier código que empezara por `GLX-TEST` y regalaría
  acceso al contenido de pago.

- **La fecha de nacimiento se calcula por componentes, no dividiendo
  milisegundos.** La división acumula error con los años bisiestos y puede dar 13
  a alguien que ya cumplió 14: exactamente donde se decide si se exige el correo
  del apoderado.

### Errores corregidos durante la sesión

- `declare private` en `Identifier` → TS4094 al devolverlo desde `defineId`.
  Pasó a `declare readonly`.
- `TransactionContext` con marca de símbolo obligatoria hacía imposible construir
  la transacción sin un `as unknown`. Pasó a marca opcional.
- Una prueba fallaba porque el fixture creaba un alumno de 10 años sin correo de
  apoderado. **El dominio tenía razón**: se corrigió la prueba, no la regla.

### Estado al cerrar

- Los 5 paquetes compartidos y el servicio `identity` **compilan sin errores**.
- **44 pruebas en verde.**
- Sigue abierto el bloqueo de **Docker Desktop no instalado**: sin él no se puede
  ejecutar el servicio ni hacer pruebas de integración. Todo lo entregado se ha
  verificado por compilación y pruebas unitarias.
- Repositorio publicado en
  <https://github.com/GLEXROBOTICS-DEV/glexco-backend-edu-platform>, rama `main`,
  106 archivos. Recordatorio permanente: **los commits nunca llevan
  `Co-Authored-By`**.
- **Decisión: monorepo único** (backend + frontend en el mismo repositorio).
  El motivo es `@glexco/contracts`: en monorepo, renombrar un permiso rompe la
  compilación del frontend al instante; en repos separados habría que publicar
  el paquete a GitHub Packages, versionarlo y bumpearlo en cada cambio de
  contrato, que es justo lo que más va a cambiar los próximos meses.
  En Railway se despliega como N servicios sobre el mismo repositorio, cada uno
  con su *Root Directory* y sus *Watch Paths* para que tocar el frontend no
  redespliegue los ocho servicios del backend.
- El repositorio está **público** por ahora; el cliente lo pasará a privado.

### Siguiente paso

Cerrar los pendientes de la Fase 1 listados en [ROADMAP.md](ROADMAP.md)
(cambio de contraseña, alta de personal por HTTP, gestión de sesiones,
`api-gateway`) y arrancar la Fase 2 (instituciones y salones).

---

## Sesión 1 — 2026-09-02 — Fase 0: cimientos

### Contexto de partida

El proyecto empezó desde cero con la propuesta comercial (PDF de 15 páginas y 5
maquetas HTML rústicas) en `~/Downloads/PROPUESTA DE CONTENIDO PLATAFORMA ONLINE
- REVISAR/`. El directorio de trabajo estaba vacío.

Se extrajo el PDF con `pypdf` y se analizaron las maquetas. El contenido
funcional está destilado en [DOMINIO.md](DOMINIO.md); **el PDF ya no hace falta**.

### Decisiones consultadas con el cliente

Se preguntaron cuatro cosas que cambiaban la arquitectura de raíz:

| Pregunta | Respuesta |
|---|---|
| ¿Dónde viven los videos y materiales pesados? | **Híbrido**: video largo en proveedor externo privado, documentos en almacenamiento propio con URL prefirmada. |
| ¿Qué nivel necesita la mensajería profesor↔alumno? | **Anuncios asíncronos**, sin WebSockets. |
| ¿Cómo repartimos la persistencia? | **Un PostgreSQL, un schema y un rol por servicio.** |
| ¿Qué alcance en la primera entrega? | **Toda la propuesta**, por fases y sesiones, documentando en `.md`. |

Después el cliente añadió el requisito de escala (~8M registrados, ~400k
concurrentes en punta), que se analizó en [ESCALABILIDAD.md](ESCALABILIDAD.md), y
pidió que la iconografía no use sets por defecto.

### Qué se construyó

**Monorepo** con pnpm 11 + Turborepo, TypeScript en modo estricto
(`noUncheckedIndexedAccess` incluido).

**`@glexco/kernel`** — bloques de construcción del dominio, sin una sola
dependencia de framework:
- `Identifier` tipado por agregado, para que el compilador impida pasar un
  `StudentId` donde se espera un `ClassroomId`.
- `AggregateRoot` con versión optimista y acumulación de eventos de dominio.
- `ValueObject`, `Guard` (invariantes en el constructor, no en el controlador).
- Jerarquía `DomainError` con categoría semántica, no códigos HTTP.
- Puertos hexagonales: `CacheStore`, `UnitOfWork`, `PasswordHasher`,
  `ObjectStorage`, `EventPublisher`, `DistributedLock`, `Mailer`, `Clock`,
  `SecureRandom`, `LoggerPort`.
- Paginación **por cursor**, no por `OFFSET`.

**`@glexco/contracts`** — el vocabulario que comparten backend y frontend:
- 8 roles con ámbito (`platform` / `institution` / `classroom` / `self`), ~70
  permisos y la matriz rol→permisos.
- `ROLE_CREATION_MATRIX`: qué rol puede crear qué rol. Cierra la escalada de
  privilegios de forma explícita.
- Vocabulario de dominio: programas, niveles, grados peruanos, plataformas
  robóticas UBTECH, tipos de contenido, estados de publicación, progreso,
  evaluación, gamificación, licencias, códigos de activación.
- Catálogo de eventos de integración versionados.
- Esquemas Zod compartidos, incluido el de registro de alumno con unión
  discriminada institucional/independiente.

**`@glexco/config`** — validación de entorno que **aborta el arranque** si falta
o está mal una variable, con comprobaciones extra en producción (secretos que
siguen siendo los de ejemplo, `COOKIE_SECURE=false`, access y refresh con el
mismo secreto).

**`@glexco/observability`** — logs JSON con contexto de correlación inyectado
por `AsyncLocalStorage`, redacción automática de campos sensibles
(`password`, `token`, `activationCode`…) y trazas OpenTelemetry.

**`@glexco/nest-platform`** — todo lo que debe ser idéntico en los ocho
servicios:
- `DomainExceptionFilter`, `CorrelationMiddleware`, `ZodValidationPipe`.
- `JwtAuthGuard` (verificación local, algoritmo fijado) y `PermissionsGuard`.
- `RedisCacheStore` con etiquetas y protección anti-estampida.
- `RedisDistributedLock` con token de propiedad y liberación atómica en Lua.
- `RateLimiter` de ventana deslizante en Lua, con políticas por operación.
- Pools separados de escritura y lectura, con `statement_timeout`.
- `PgUnitOfWork` con outbox transaccional y reintentos ante deadlock.
- Cliente NATS JetStream y `OutboxRelay` con `SKIP LOCKED` y backoff.
- `CircuitBreaker` cerrado/abierto/semiabierto.
- `HealthController` con las tres sondas diferenciadas.
- `bootstrapService()` con apagado ordenado y drenaje.

**Infraestructura local** (`infra/docker/`): Postgres 16, Redis 7 con AOF, NATS
JetStream, MinIO con cuatro buckets privados, Mailpit, Jaeger. Scripts de
inicialización que crean schema y rol por servicio, más las tablas `outbox` y
`processed_events` con índices parciales.

**Documentación**: `CLAUDE.md`, `ARQUITECTURA.md`, `ESCALABILIDAD.md`,
`DOMINIO.md`, `ROADMAP.md` y esta bitácora.

### Por qué se decidió así (lo no obvio)

- **Argon2id en lugar de bcrypt**, pese a que el cliente mencionó bcrypt. Es la
  recomendación actual de OWASP: resiste el ataque con GPU al ser duro en
  memoria. La decisión es reversible: el puerto `PasswordHasher` acepta ambos y
  `needsRehash` permite migrar sin que nadie cambie su contraseña.

- **Política de contraseñas sin reglas de composición.** Longitud mínima de 8 y
  rechazo de contraseñas filtradas, siguiendo NIST SP 800-63B. Exigir mayúsculas
  y símbolos empuja a patrones predecibles, y aquí hay niños de 6 años.

- **Alfabeto del código de activación sin `0/O/1/I/L`.** Un niño copiando de un
  libro de papel no debe perder su acceso por un carácter ambiguo. Quedan 31
  símbolos; con 12 posiciones el espacio sigue siendo 7,9·10¹⁷.

- **Rate limiter fail-open.** Si Redis cae y bloqueamos todo, convertimos una
  degradación de caché en una caída total. Los límites duros de verdad (WAF,
  balanceador) van delante.

- **Separación de pools de lectura/escritura desde el día uno**, aunque en local
  apunten al mismo Postgres. Evita una migración dolorosa después.

- **`live` no toca dependencias.** Si la sonda de liveness comprobara Redis, una
  caída de Redis reiniciaría en bucle todas las réplicas.

### Problemas del entorno resueltos (no repetir)

1. `corepack enable pnpm` falla con `EPERM` (escribe en `C:\Program Files\nodejs`).
   Solución: `npm i -g pnpm`.
2. pnpm 11 **ignora** el campo `pnpm` de `package.json`; `onlyBuiltDependencies`
   va en `pnpm-workspace.yaml`. Tras cambiarlo hace falta un `pnpm rebuild`.
3. Los **heredocs de Bash con TypeScript grande se corrompen** en este entorno.
   Escribir archivos con la herramienta de escritura o con Python
   (`io.open(..., newline='\n')`).
4. **Caracteres de control literales en expresiones regulares** se corrompen al
   pasar por el shell. Se reemplazó por `hasForbiddenControlChars`, que recorre
   puntos de código.
5. `@opentelemetry/resources` 1.30 no exporta `resourceFromAttributes` (es de la
   2.x). Se usa `new Resource({...})` con claves de atributo literales.
6. `declare private` en una clase devuelta desde una función da **TS4094**. La
   marca de tipo de `Identifier` es `declare readonly`, sin `private`.

### Estado al cerrar

- Los **5 paquetes compartidos compilan** sin errores (`tsc` limpio).
- `services/*` y `apps/web` son carpetas vacías.
- **Bloqueo abierto: Docker Desktop no está instalado.** Sin él no hay Postgres,
  Redis, NATS ni MinIO locales, así que ningún servicio puede ejecutarse todavía.
  WSL2 sí está disponible, que es el backend que Docker Desktop necesita.
- Repositorio Git **no inicializado todavía**: el cliente enviará el enlace
  correcto de GitHub. Regla fijada: **los commits nunca llevan `Co-Authored-By`**.

### Siguiente paso

**Fase 1 — identidad y acceso** (en curso): `identity-service` completo y
`api-gateway`. Ver [ROADMAP.md](ROADMAP.md).
