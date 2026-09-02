# Bitácora de trabajo

Registro por sesión: **qué se hizo**, **por qué**, **qué falta**. Es el documento
que debe leer primero cualquier instancia de Claude que retome el proyecto.

Entradas en orden cronológico inverso (lo más reciente arriba).

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
- Repositorio Git **aún no inicializado**: el cliente enviará el enlace correcto.
  Recordatorio: **los commits nunca llevan `Co-Authored-By`**.

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
