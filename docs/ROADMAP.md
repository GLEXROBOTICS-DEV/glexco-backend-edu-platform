# Roadmap por fases

Estado de cada fase. La bitácora de lo realmente ejecutado está en
[BITACORA.md](BITACORA.md).

Leyenda: ✅ completada · 🔄 en curso · ⬜ pendiente

---

## ✅ Fase 0 — Cimientos

Todo lo que el resto del proyecto da por hecho.

- [x] Monorepo pnpm + Turborepo, TypeScript estricto.
- [x] `@glexco/kernel` — bloques DDD: `AggregateRoot`, `ValueObject`,
      `DomainEvent`, `Identifier` tipado, jerarquía de errores, puertos
      hexagonales (`CacheStore`, `UnitOfWork`, `PasswordHasher`, `ObjectStorage`,
      `EventPublisher`, `DistributedLock`, `Mailer`, `Clock`).
- [x] `@glexco/contracts` — roles y permisos con ámbito, matriz de creación de
      roles, vocabulario de dominio, catálogo de eventos, esquemas Zod.
- [x] `@glexco/config` — validación de entorno que aborta el arranque si falta
      una variable, con comprobaciones extra de seguridad en producción.
- [x] `@glexco/observability` — logs JSON con correlación y redacción de campos
      sensibles; trazas OpenTelemetry.
- [x] `@glexco/nest-platform` — filtro de errores de dominio, middleware de
      correlación, pipe de validación Zod, guards de JWT y permisos, caché Redis
      con etiquetas y anti-estampida, cerrojo distribuido, rate limiter en Lua,
      pools de escritura/lectura, unidad de trabajo con outbox, cliente NATS
      JetStream, relay de outbox, circuit breaker, health checks, bootstrap con
      apagado ordenado.
- [x] Infraestructura local: Postgres 16, Redis 7, NATS JetStream, MinIO,
      Mailpit, Jaeger. Schemas y roles por servicio, tablas `outbox` y
      `processed_events`.
- [x] Documentación base.

---

## ✅ Fase 1 — Identidad y acceso

El servicio del que dependen todos los demás.

**Hecho:**

- [x] `identity-service`: agregado `User` con todas sus invariantes, objetos de
      valor (`Email`, `PersonName`, `BirthDate`, `PasswordHash`, `LocalePreference`)
      y catálogo de eventos de dominio.
- [x] Registro de alumno (institucional e independiente) con código de libro,
      con el orden de validaciones pensado para no gastar CPU en peticiones basura.
- [x] Argon2id con `PasswordHasher` intercambiable, soporte bcrypt para migración
      y rehash transparente al iniciar sesión.
- [x] JWT: access corto con permisos resueltos + refresh rotativo en cookie
      httpOnly, con detección de reutilización de familia de tokens y ventana de
      gracia para la carrera entre pestañas.
- [x] Verificación de correo y recuperación de contraseña (solicitud y confirmación).
- [x] Consentimiento de apoderado para menores de 14, exigido en el dominio **y**
      con restricción `CHECK` en la base.
- [x] Bloqueo progresivo de cuenta + rate limiting por IP y por cuenta.
- [x] Resistencia a enumeración de usuarios: mensaje único y hash señuelo.
- [x] Registro de auditoría con escritura en lote diferida.
- [x] Esquema SQL con índices parciales, `citext` y concurrencia optimista.
- [x] Ejecutor de migraciones con cerrojo de aviso (seguro con autoescalado).
- [x] 44 pruebas en memoria (dominio + casos de uso), sin Docker, en ~30 ms.

- [x] Cambio de contraseña autenticado, exigiendo la contraseña actual.
- [x] Alta de personal por HTTP con triple control: permiso, matriz de roles y
      **ámbito de institución** (un admin del colegio A no puede crear docentes
      en el colegio B).
- [x] Gestión de sesiones activas ("cerrar sesión en otros dispositivos").
- [x] `api-gateway`: tabla de enrutado explícita, correlación, rate limiting en
      el borde, circuit breaker por servicio y apagado ordenado.
- [x] `pnpm setup` genera `.env` con secretos criptográficos reales.
- [x] `pnpm smoke` verifica 22 comprobaciones de punta a punta contra los
      servicios en ejecución.
- [x] **65 pruebas** en memoria, sin Docker, en ~60 ms.

**Lo que quedaba pendiente, y ya está:**

- [x] Prueba de humo con la infraestructura levantada. El bloqueo de Docker se
      resolvió al mover el proyecto de máquina; hoy `pnpm smoke` pasa **96**
      comprobaciones de punta a punta.
- [x] Pruebas de integración con Postgres y Redis reales. Son `pnpm smoke` y
      `pnpm concurrency` (**18**): no hay una suite aparte porque duplicaría lo
      mismo con dobles peores.
- [x] Envío real de correos. `engagement` consume los eventos y manda
      verificación y recuperación. **En local salen a Mailpit, que acepta todo y
      no entrega nada**: falta un SMTP de verdad, que es asunto de negocio y no
      de código.

## ✅ Fase 2 — Instituciones, salones y licencias

**Hecho:**

- [x] Dominio completo: `Institution` (con licencias como entidad interna),
      `Classroom` (con matrículas como entidad interna), y los objetos de valor
      `InstitutionCode`, `InstitutionName`, `EducationLevels`, `ContactInfo`,
      `Capacity`, `ClassroomName`.
- [x] **Tope de plazas** con doble protección: el agregado rechaza matricular en
      un salón lleno, y el repositorio carga la fila con `SELECT … FOR UPDATE`
      para que dos matrículas simultáneas se serialicen.
- [x] Matrícula **idempotente** (el evento de registro puede llegar dos veces) y
      que **conserva el historial** al retirar a un alumno.
- [x] Aislamiento entre instituciones comprobado sobre el recurso concreto:
      docente solo sus salones, admin todo su colegio, GLEXCO todo.
- [x] Casos de uso: crear institución, conceder licencia, buscar institución por
      código (público), crear/editar/listar salones, listar salones elegibles
      para el registro (público), matricular alumno y comprobación previa de
      salón que consulta identidad.
- [x] Esquema SQL con restricción de exclusión para licencias solapadas, índices
      parciales y clave compuesta de matrícula.
- [x] 25 pruebas del dominio.

- [x] Repositorios PostgreSQL, con `findByIdForUpdate` que toma el bloqueo de
      fila dentro de la transacción. El repositorio de salones **solo recibe el
      pool de lectura**: toda escritura pasa por el cliente de la transacción, de
      modo que saltarse el bloqueo por descuido es imposible.
- [x] Proyección `teacher_directory`, alimentada por eventos, para no hacer N
      llamadas a identidad al pintar un listado de salones.
- [x] Controladores HTTP: instituciones, licencias, salones, matrículas, búsqueda
      pública por código y salones elegibles para el registro.
- [x] `InternalOnlyGuard` en `@glexco/nest-platform`: protege la API interna entre
      microservicios con comparación en tiempo constante, y **deniega todo si
      falta el token**, para que un despiste de despliegue no abra una puerta.
- [x] Módulo y arranque con outbox, salud y apagado ordenado.

- [x] `EventConsumer` en `@glexco/nest-platform`: deduplicación en la **misma
      transacción** que el efecto, backoff creciente y aparte de mensajes veneno
      tras agotar reintentos.
- [x] `JoiningUnitOfWork`: permite que el mismo caso de uso sirva desde HTTP y
      desde un evento. Sin ella, el caso de uso abriría una segunda transacción y
      competiría por los mismos bloqueos que la del consumidor.
- [x] Consumidor de identidad: matrícula automática al registrarse, y
      mantenimiento del directorio de docentes.
- [x] Tarea periódica de vencimiento de licencias, bajo cerrojo distribuido para
      que N réplicas no emitan N avisos por licencia.
- [x] `toLoggerPort`: adaptador real de pino al puerto de logging. Corrige un
      fallo silencioso — las firmas están invertidas y el casteo hacía perder el
      contexto de todas las líneas de log.

- [x] Alta de administrador de institución enlazada con identidad: `identity`
      consulta el endpoint interno de `institutions` antes de crear la cuenta.
      Sin eso, un identificador mal tecleado creaba un administrador con permisos
      sobre una institución inexistente, y el fallo aparecía después de forma
      confusa. Una institución suspendida se rechaza para altas nuevas, pero sus
      usuarios actuales conservan el acceso.

## ✅ Fase 3 — Catálogo, kits y códigos de activación

**Hecho:**

- [x] `ActivationCode` con el código guardado **hasheado**, nunca en claro, y una
      pimienta que vive en configuración: robar la base no basta para
      reconstruir hashes.
- [x] Alfabeto sin `0/O/1/I/L` (un niño copiando de papel no debe perder su
      acceso por un carácter ambiguo) y espacio de 31¹² ≈ 7,9·10¹⁷.
- [x] Generación con `randomInt` de `node:crypto`, no `Math.random`: este último
      es predecible desde la semilla del proceso.
- [x] Canje de un solo uso con `SELECT … FOR UPDATE`, idempotente para el mismo
      alumno y conflicto para otro distinto.
- [x] `Entitlement`: el alumno ve únicamente el contenido de su kit. Se crea en
      la **misma transacción** que el canje.
- [x] Esquema SQL con índices parciales y restricciones que impiden estados
      imposibles (un código canjeado sin alumno, por ejemplo).
- [x] Repositorios PostgreSQL, API HTTP y endpoint interno de comprobación
      previa que consulta identidad.
- [x] 25 pruebas del dominio.

- [x] **Generación de lotes y exportación para imprenta.** `POST /catalog/batches`
      con `format=csv`. Los códigos en claro se devuelven **una sola vez**: en la
      base solo queda su hash, así que no existe -ni puede existir- un endpoint
      para volver a descargar el fichero.
- [x] **Consumidor de `identity.user.registered.v1` que canjea de forma
      asíncrona.** Cierra el flujo del registro sin transacción distribuida. El
      evento lleva el **id de la fila** del código, nunca el código.
- [x] Verificado contra infraestructura real: canje de un solo uso con 20
      peticiones simultáneas, tope de plazas, durabilidad de la outbox y
      deduplicación de eventos (`pnpm concurrency`).

- [x] **Caché de catálogo con invalidación por etiqueta.** `CachedContentRepository`
      decora el repositorio y agrupa por `kit:<id>`; publicar invalida el kit
      entero. No se cachea nada que decida un permiso.
- [x] **Publicación de contenido** con tabla explícita de transiciones: de
      borrador a publicado hay que pasar por revisión.
- [x] **Revocación de códigos y derechos.** Anular un código retira, en la misma
      transacción, el acceso que concedió.
- [x] **`media-service`**: subida con URL prefirmada (POST con política, que sí
      puede limitar el tamaño), validación del tipo **real** por firma binaria,
      miniaturas con sharp y proveedor de video externo tras un puerto.

**Pendiente:** nada bloqueante. Lo que queda son mejoras que dependen de tener
frontend o clientes reales:

- [x] **Tarea periódica de limpieza de subidas abandonadas.** `listAbandoned`
      llevaba fases escrito sin que lo llamara nadie, así que las filas en
      `pending` se acumulaban para siempre. Lo que costaba dinero no era la fila
      sino el OBJETO: una URL prefirmada se puede usar sin que nadie confirme
      después, así que el archivo llega al bucket y se paga indefinidamente sin
      aparecer en ninguna pantalla.

      Borra **primero el objeto y después la fila**: al revés, un fallo del
      almacén dejaría el archivo sin nada que lo nombre. Espera 24 horas antes
      de dar una subida por muerta —el aula que empieza el viernes y termina el
      lunes existe— y solo la ejecuta una réplica, con cerrojo distribuido.
- [ ] Contratar el proveedor de video real y configurarlo (`VIDEO_PROVIDER_URL`).
      **Bloqueo de negocio, no de código.** Al 15 de septiembre de 2026 no hay
      ningún vídeo subido, así que no frena nada: la decisión del cliente es que
      **el vídeo va por enlace** y la foto se sube reducida en el equipo del
      alumno.
- [ ] Endpoints de alta y edición de contenido (hoy se siembra por SQL; el
      cambio de estado de publicación sí está).
- [x] `GET /catalog/kits`: índice de kits publicados, para elegir uno al crear
      una evaluación.

## ✅ Fase 4 — Portales de alumno (Discover y Academy)

> Cerrada. Queda deuda de traducción acotada y medida —157 textos, que
> `pnpm i18n:check` cuenta y no deja crecer— y la parte manual de
> accesibilidad, que un guion no puede cubrir.

**Hecho:**

- [x] **Canvas de Claude Design aprobado** antes de codificar.
- [x] `@glexco/icons`: iconografía SVG propia (robot, kit, insignia, nivel, reto,
      código, salón, certificado, biblioteca). Solo iconos **del dominio**; el
      cromo de interfaz sigue viniendo de Lucide.
- [x] `apps/web` en Next.js 15 con App Router y React Server Components.
- [x] Sistema de diseño con los tokens del canvas. Discover y Academy comparten
      componentes y **difieren en densidad**, declarada una sola vez con
      `data-portal`.
- [x] Sesión en cookie `httpOnly`: el token nunca llega a JavaScript. Las
      llamadas autenticadas se hacen desde el servidor.
- [x] Ingreso, cierre de sesión y enrutado al portal por edad y rol.
- [x] Portadas de Discover y Academy leyendo el **kit real** del catálogo.
- [x] Estados vacíos con la acción siguiente, esqueletos con la forma del
      contenido, foco visible y salto al contenido.
- [x] `pnpm smoke:web`: 17 comprobaciones del portal contra el backend real.

**Pendiente:**

- [x] **Mi progreso** en los dos portales: medias separadas de GLEXCO y del
      docente, cuánto ha mejorado, y la evolución en el tiempo.
- [x] Discover: **laboratorio de robots**, **mis kits**, **mis logros** y **mi
      cuenta**. Falta la zona de retos, que depende de los retos de la Fase 6.
- [x] Academy: **laboratorio de robots**, **cursos**, **ruta tecnológica** y **mi
      cuenta**. Faltan proyectos y desafíos (Fase 6), certificaciones (Fase 6) y
      el portafolio.
- [x] **Mi cuenta** en los cuatro portales: cambio de contraseña exigiendo la
      actual, y sesiones abiertas con cierre remoto.
- [x] **Modo oscuro** con la paleta del canvas, en tres estados (claro, oscuro y
      «como el sistema»), sin destello al cargar.
- [x] **Visita guiada** que no arranca sola: se abre desde la barra lateral y se
      puede reabrir siempre.
- [x] Biblioteca multimedia con reproductor y descargas por URL prefirmada.
- [x] Registro de alumno y activación de código desde el portal.
- [x] El alumno responde los cuestionarios desde el portal, sin JavaScript si
      hace falta, y ve su nota al instante.
- [x] **i18n es/en montado**, sin enrutado por idioma: el idioma sale del perfil
      del usuario —que es donde ya vivía y lo que usan los correos— y de una
      cookie en las pantallas públicas. Traducidos el acceso, el cromo de la
      aplicación y la navegación.
- [x] **i18n: el cuerpo de las pantallas del alumno, traducido.** Portadas de
      los dos portales, biblioteca, laboratorio, evaluaciones, resultado, muro,
      anuncios, logros, progreso, contenido y la visita guiada entera. **345
      claves en paridad es/en.**

      Tres decisiones que conviene no deshacer: los **nombres de nivel** se
      traducen en el portal por número de nivel y no en el servicio —el dominio
      no tiene idioma de usuario—; el **vocabulario** (grados, tipos de
      contenido, estados de nota) vive en `messages/*.json` con la clave que
      guarda el backend, y no en mapas en español dentro de `lib/`; y las
      **fechas** reciben el formateador en vez de fijar `es-PE`, que dejaba media
      frase traducida y la fecha en español.

      Al cliente solo se le mandan los espacios que usa un componente de cliente
      (`CLIENT_NAMESPACES` en `app/layout.tsx`, más los que declara cada sección
      con `SectionMessages`): el catálogo entero se serializa en el HTML de cada
      página y crece sin techo según avanza la traducción.
- [x] **i18n: el portal del docente y el de Admin.** Los cinco formularios del
      Admin, el alta de salón, el anuncio, el editor de preguntas, la rúbrica,
      el alta de evaluaciones con su bloque de trabajo en grupo, la verificación
      pública de certificados y el resto de pantallas del Teacher Center.
      **1.107 claves en paridad es/en.**

      Con ellas, los **80 mensajes de error de los Server Actions**, que son los
      textos que alguien lee justo cuando algo le sale mal. Van al espacio
      `errores`, que **no se declara en ningún `SectionMessages`** y por tanto no
      viaja en el catálogo serializado: dos de esos mensajes llevan la palabra
      «correcta» y no podrían estar en un espacio de cliente.

      Tres tablas de etiquetas que estaban escritas en el código pasan al
      catálogo con la MISMA clave que guarda el backend: los trece grados, los
      cinco niveles educativos y las acciones de publicación. La del alta de
      salón era la peor: un grado nuevo en el contrato no aparecía en el
      desplegable y el colegio no podía abrir el salón aunque el backend lo
      aceptara.
- [x] **`pnpm i18n:check`: la traducción, medida.** Nace de haber dado la i18n
      por terminada con más de doscientos textos a la vista todavía en español:
      nadie lo estaba contando. Comprueba paridad es/en, claves muertas —encontró
      28 y se borraron— y el texto sin traducir **contra un techo que solo puede
      bajar**. No falla por la deuda que ya hay; falla si entra texto nuevo en
      español.
- [x] **Auditoría WCAG 2.1 AA automatizada** (`pnpm a11y`): audita el HTML que
      sirve el servidor, no el código, que es donde de verdad aparecen los
      fallos. 13 pantallas sin hallazgos. Queda por revisar **a mano** el
      contraste real, el orden de tabulación y si los textos alternativos dicen
      algo útil — el guion lo dice en voz alta para que «0 hallazgos» no se lea
      como «es accesible».

## 🔄 Fase 5 — Teacher Center y evaluación

**Hecho:**

- [x] `assessment-service` con `Assessment`, `Question` y `Submission`.
- [x] **Doble origen**: el banco de GLEXCO viene con el kit y es el mismo para
      todos los colegios; el docente crea las suyas para su salón. Un docente
      **no puede editar** las de GLEXCO, pero sí **duplicarlas** para adaptarlas.
- [x] Cuestionarios de marcar corregidos **automáticamente al entregar**
      (el formato tipo Coursera), y corrección manual para lo abierto y las
      entregas.
- [x] **La clave de corrección nunca sale hacia el alumno.** `forStudent()` es el
      único camino y no la incluye.
- [x] Tope de intentos con bloqueo de fila, límite de tiempo contado por el
      reloj del servidor, y preguntas congeladas en cuanto hay entregas.
- [x] Evidencias del alumno: foto, PDF y vídeo por subida, **o enlace externo**
      al OneDrive / Drive / Stream del centro.

**Pendiente:**

- [x] **Rúbricas de corrección.** El docente reparte los puntos de la pregunta
      entre criterios —montaje, cableado, explicación— con tres niveles fijos por
      criterio: *logrado*, *parcial* (la mitad, redondeando hacia abajo) y *no
      logrado*. Al corregir elige un nivel por criterio en vez de escribir un
      número.

      **El máximo de la rúbrica tiene que coincidir con los puntos de la
      pregunta**, y lo exige el dominio: si diera menos, la pregunta sería
      imposible de sacar entera y nadie sabría por qué; si diera más, el docente
      puntuaría todo y luego no podría cerrar la nota.

      **Y los puntos los calcula el dominio, no la pantalla.** El formulario
      manda qué nivel se eligió, y de ahí sale la nota: un total manipulado no
      otorga nada aunque quepa en el máximo de la pregunta. La rúbrica **sí**
      viaja al alumno —no es la clave, es el enunciado de cómo se le va a
      evaluar—, y su resultado trae el desglose por criterio, que es lo único que
      convierte «12 de 20» en algo que se puede arreglar.
- [x] Panel del docente en el portal, con el dashboard de su salón.
- [x] **Bandeja de corrección** por salón, con el nombre real del alumno y la
      pantalla de puntuación. Ordenada por lo que hay que hacer: lo abierto
      primero, lo que corrigió la máquina plegado como referencia.
- [x] **El docente crea, amplía, publica y duplica sus evaluaciones** desde el
      portal. El banco se presenta en dos bloques —las del kit y las suyas—
      porque se operan distinto.
- [x] **Crear salones desde el portal** (docente y dirección), con selector de
      docente para la dirección. La pantalla no existía y el enlace daba 404.
- [x] **Lista de alumnos del salón** con quién activó su kit y quién se
      descolgó, y **ficha individual de cada alumno** con sus notas y su
      evolución. La dirección ve las de todo su colegio.
- [x] **Actividades en grupo.** El docente marca la actividad como grupal y fija
      un rango de integrantes; el alumno elige a sus compañeros al empezar, con
      un desplegable de casillas que funciona sin JavaScript.

      **Quien ya empezó con un grupo desaparece de la lista de los demás, y eso
      no lo garantiza la lista.** Entre que se pinta y que el alumno pulsa, otro
      grupo puede ficharle, y dos que pulsan a la vez ven los dos la misma lista
      libre. Lo garantiza un índice único sobre (actividad, alumno, intento) en
      `submission_members`: la misma pieza que hace que un código de libro se
      canjee una sola vez, y por la misma razón. Comprobar antes de insertar es
      la condición de carrera clásica, y en un aula treinta alumnos empiezan la
      misma actividad en el mismo minuto.

      **La nota llega a cada integrante, con un evento por cabeza**, porque la
      analítica y el progreso archivan por (alumno, evaluación): con un solo
      evento, los compañeros de quien pulsó entregar se quedarían sin nota en su
      portal y sin contar en la media de su salón. Pero los **fallos por
      pregunta** van solo en el evento de quien entregó: el grupo respondió una
      vez, y repetirlos inflaría el dato con el que el docente decide qué
      repasar.

      Un rango y no un número fijo porque una clase rara vez se divide exacta:
      con 23 alumnos y grupos de 4, tres se quedarían sin poder entregar.
- [x] **Retirar una evaluación del banco** (`POST /assessments/:id/archive`).
      `Assessment.archive()` existía desde el primer día **sin ningún camino que
      lo llamara**: se podía publicar y no retirar, así que una evaluación
      publicada por error la seguían viendo los alumnos y la única salida era
      tocar la base a mano. No borra, archiva: hay entregas colgando y notas ya
      puestas, y borrarla dejaría a esos alumnos con un resultado que apunta a
      algo que no existe.
- [ ] Portal docente, lo que falta: recursos pedagógicos y capacitación docente.
- [x] **Tipo de pregunta `ordering`**, con corrección automática y puntuación
      **parcial**: cuenta cuántas piezas quedaron en su sitio. En una pregunta de
      marcar, media respuesta no es media idea; en una de ordenar de ocho pasos,
      todo o nada convierte un intercambio de dos piezas en un cero y la pregunta
      deja de medir nada. Encaja sin cambiar el modelo: `correctOptionIds` ya era
      un array **ordenado**, así que la secuencia correcta es su propio orden.

      El alumno responde con un desplegable de posición por paso, **no
      arrastrando**: arrastrar exige JavaScript —y este formulario tiene que
      poder entregarse sin él—, es casi imposible con un lector de pantalla, y
      falla con el dedo de un niño en una tableta de laboratorio.
- [x] **Tipo de pregunta `matching`**, con corrección automática y puntuación
      **parcial**: cuenta cuántas parejas se acertaron, por el mismo motivo que
      en `ordering`. Contando por elemento de la izquierda, además, mandar el
      mismo acierto seis veces no lo cobra seis veces.

      Lo que le faltaba era el **modelo**, no el algoritmo: emparejar son PARES y
      `correctOptionIds` es una lista plana. Se resolvió con dos campos propios
      —`matches` para la columna derecha y `pairs` para la clave— en vez de
      codificar `izq:der` dentro de un identificador, que sería una estructura
      escondida en un `string`.

      **La columna derecha sale al alumno ordenada por identificador, y eso es
      desordenarla:** son UUID v4, así que su orden no guarda ninguna relación
      con el de captura y el docente que escribe las parejas en fila no regala la
      clave. Se hace así y no con azar para que el dominio siga siendo
      determinista: una pregunta que sale distinta en cada carga no se puede
      probar, y al recargar el alumno vería la derecha bailar y perdería lo que
      llevaba emparejado.

      Se responde con un desplegable por fila, **no arrastrando**, por las tres
      razones de siempre: sin JavaScript, con lector de pantalla y con el dedo de
      un niño en una tableta.

## 🔄 Fase 6 — Progreso, gamificación y certificados

> **Certificados terminados y en producción.** Lo que queda de la fase son los
> retos y el portafolio, que dependen de datos que todavía no existen.

- [x] `learning-service`: progreso por lección y curso, con la señal de **quién
      se descolgó** antes del primer examen, que es lo que la evaluación sola no
      puede dar.
- [x] XP, niveles del Explorador e insignias. **No hay ranking, y es una
      decisión:** el progreso solo se compara con uno mismo. La propuesta ya lo
      pide para el ranking —*celebra logros, no señala rezagos*— y entre menores
      vale igual.
- [x] **Retos de construcción y portafolio.** «Zona de retos» en Discover y
      «Proyectos y desafíos» en Academy, más «Mi portafolio» en los dos, con su
      sitio en la barra y sus iconos propios.

      **No hay dominio nuevo, y esa es la decisión.** Un reto de construcción ES
      una evaluación de tipo `practical`; un proyecto final, una de tipo
      `project`. Ya se publican, ya tienen plazo, ya llegan a la bandeja del
      docente y ya cuentan en los dashboards. Crear un agregado `Challenge`
      aparte habría duplicado publicación, intentos, corrección y analítica, y el
      día que las dos copias se despegaran nadie sabría cuál es la buena.

      Lo que faltaba era la **pantalla que los separa de los cuestionarios**:
      mezclados en «Mis actividades», un examen de marcar y un montaje que ocupa
      una tarde se leían igual, y son dos cosas que el alumno planifica distinto.

      El portafolio se arma con las entregas corregidas de esos retos, con la
      evidencia y el comentario del docente. Tampoco tiene tabla propia: una
      pieza de portafolio es una entrega, no una copia de una entrega.
- [x] **Evidencia de los retos**: el alumno sube una foto o comparte el enlace a
      su vídeo, y el docente la **abre** en su pantalla de corrección —antes
      decía «entregó un archivo» y no lo enseñaba—.

      Como trabajan de verdad, y lo precisó el cliente: la evidencia es
      **opcional** porque lo normal es que el docente revise el montaje en clase
      y solo registre la nota; y el **vídeo no se sube**, se publica en YouTube o
      Drive y se envía el enlace. Cerrado en el dominio (`SCOPE_TYPES` de medios)
      y no solo en la pantalla.
- [x] **Misiones semanales**, en el dashboard del alumno y en su zona de retos.

      **Sin tabla de progreso, y eso es la decisión.** El avance se calcula de
      `lesson_progress` y de `xp_awards`, que son los hechos; una tabla
      `mission_progress` sería una segunda copia que habría que mantener al día
      con cada lección completada, y el día que se despegara del original nadie
      sabría cuál dice la verdad. Lo único que se guarda es la consecuencia: el
      XP, en `xp_awards` con `reason = 'mission_completed'`, que ya es idempotente
      por (alumno, motivo, referencia) — así que abrir la pantalla cien veces
      paga una.

      **Una misión vencida no reprograma nada**, por decisión del cliente: queda
      pendiente y se puede completar tarde. Desplazar el calendario habría hecho
      que «a tiempo» dejara de significar nada, y con ello el docente pierde la
      señal de quién se descolgó, que es la razón de ser de este servicio. En
      pantalla la vencida va **delante** de la bloqueada: convierte un «llegas
      tarde» en un «todavía puedes».

      La ventana de cada semana se cuenta desde la **primera actividad del alumno
      en el kit**, no desde una fecha absoluta: quien compra el libro en mayo no
      puede abrir la plataforma con treinta misiones vencidas.

      Las escribe GLEXCO y vienen con el kit. El campo `origin` existe desde el
      primer día porque el cliente ya dijo que institución y docentes podrán
      ajustarlas más adelante.

      **Y ya se pueden publicar desde el portal**: `/admin/misiones`, sobre
      `POST /learning/missions`. El modelo estaba entero y
      `assertMissionIsUsable` validaba sin que nadie la llamara, así que las
      misiones solo entraban por el sembrador escribiendo directo en la base —y
      en un entorno donde PostgreSQL no está expuesto, que es como debe estar, no
      había forma de publicar ninguna—. El origen se deduce de quien llama y
      nunca del cuerpo, igual que en las evaluaciones.

      La pantalla trae una lectura que no existía: `GET
      /learning/missions/kit/:kitId`, un listado de **autoría** distinto del que
      abre el alumno —aquel evalúa objetivos y paga XP—. Ordena por semana y
      marca las que ya tienen misión, que es lo único que evita publicar una
      segunda sin querer: es el error que dejó tres retos duplicados en
      producción.
- [x] **Certificados con firma Ed25519, QR y verificación pública** sin iniciar
      sesión. La firma es asimétrica y no un HMAC a propósito: cualquiera puede
      comprobar un certificado con la clave pública, sin pedirnos permiso y sin
      que podamos negar después haberlo emitido. Para un título que el alumno
      enseña fuera, esa diferencia es el producto.
- [x] **Emisión individual y masiva por salón**, idempotente y comprobando que
      el curso esté completo: un certificado emitido a quien no terminó no es un
      favor, es un documento falso con nuestra firma.

## 🔄 Fase 7 — Comunicación, soporte, analítica y admin

**Hecho:**

- [x] `analytics-service` como **proyección de lectura** alimentada por eventos.
      No consulta los otros schemas: ver la sección 11 de
      [ARQUITECTURA.md](ARQUITECTURA.md).
- [x] Los **cinco dashboards** con su ámbito comprobado dos veces —permiso y
      recurso—: alumno, salón, alumno visto por su docente, institución y una
      vista por institución para GLEXCO.
- [x] **Eficacia docente** medida por PROGRESO y no por nota, con el tamaño de la
      muestra en cada fila y el aviso viajando junto a los datos. Las razones
      están en la sección 6.bis de [DOMINIO.md](DOMINIO.md).
- [x] Preguntas más falladas por salón: el dato más accionable para un docente.
- [x] Kits con peor resultado en todos los colegios: si un kit va mal en todas
      partes, el problema es del contenido.
- [x] Activación de códigos por institución, que es la métrica comercial.

**Pendiente:**

- [x] **Pantallas de los dashboards**: progreso del alumno en los dos portales,
      panel del docente con su salón, y panel de institución con la eficacia
      docente. Gráficos en SVG propio, sin librería: +2 kB sobre la carga base.
- [x] Panel de GLEXCO en el portal, con el directorio de instituciones que lo
      hace legible: antes listaba la cartera de clientes por UUID.
- [x] `engagement-service`: **correo real** (verificación y recuperación) y
      anuncios de salón. El token del enlace NO viaja en el evento: se pide a
      identidad en el momento de enviar, para que no quede escrito en la outbox
      ni en el stream.
- [ ] `engagement-service`, lo que falta: notificaciones, mesa de ayuda y base
      de conocimiento.
- [x] **El muro del salón.** El cliente aclaró que no quería mensajes privados
      sino un tablón donde el alumno también pregunta y lo ven todos. Además de
      ser mejor pedagógicamente, es la opción más segura: **no existe ningún
      canal privado entre un adulto y un menor**, y todo queda a la vista del
      docente. Alumnos y docentes publican y responden; una pregunta no se puede
      fijar.
- [x] **Portal Admin: instituciones, personal, códigos y contenidos.** Cuatro
      capacidades que llevaban fases construidas en el backend —con sus permisos,
      sus validaciones y sus eventos— y **ninguna tenía pantalla**: dar de alta un
      colegio, concederle su licencia, crear una cuenta de personal y generar un
      lote de códigos solo se podían hacer con `curl`.

      Los enlaces se añaden **por permiso y uno a uno**: el equipo de contenidos
      publica kits y no da de alta colegios, el comercial genera códigos y no
      publica contenido. Y los roles del alta de personal salen de
      `ROLE_CREATION_MATRIX`, la misma tabla que el backend usa para rechazar —se
      importa, no se copia—.

      Queda de este apartado: **certificaciones a nivel de plataforma** (hoy se
      emiten por salón, desde el Teacher Center) y **configuración**, que no
      tiene nada detrás todavía.
- [x] **Exportación a CSV y a PDF de los dashboards**, desde el propio gráfico.

      **CSV con BOM y separador `;`, y PDF por la hoja de impresión del
      navegador.** Es una decisión: un `.xlsx` de verdad exige una librería de un
      megabyte en el servidor para producir algo que el usuario abre igual, y un
      PDF generado exigiría un motor headless de decenas de megabytes en la
      imagen para producir una versión **más pobre** de lo que ya se ve —los
      gráficos son SVG y se imprimen a la resolución de la impresora—.

      Se arma en el navegador con lo que ya está en la página: sin petición, sin
      endpoint nuevo y sin una segunda ocasión de que esos datos salgan del
      servidor, que en un dashboard de salón son notas de menores.
- [x] Progreso por consumo de contenido (`learning-service`, Fase 6).

## ⬜ Fase 8 — Endurecimiento y despliegue

- [ ] Pruebas de carga con k6 (escenarios de inicio de clase y jornada).
- [ ] Revisión de seguridad y prueba de penetración interna.
- [ ] CI/CD con despliegue sin caída y reversión automática.
- [ ] Railway: servicios, variables, dominios, copias de seguridad.
- [ ] Manifiestos para AWS / Huawei Cloud.
- [ ] Runbooks operativos y alertas.
