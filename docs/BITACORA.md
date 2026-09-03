# Bitácora de trabajo

Registro por sesión: **qué se hizo**, **por qué**, **qué falta**. Es el documento
que debe leer primero cualquier instancia de Claude que retome el proyecto.

Entradas en orden cronológico inverso (lo más reciente arriba).

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
