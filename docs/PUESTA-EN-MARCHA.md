# Puesta en marcha con Docker

**Cómo levantar la plataforma en local y qué comprobar.**

> **Actualizado en la sesión 5.** La primera ejecución real ya ocurrió: las
> migraciones se aplican, los cinco servicios arrancan, `pnpm smoke` pasa 51
> comprobaciones y `pnpm concurrency` pasa 14. Los nueve fallos que aparecieron
> en esa primera ejecución están corregidos y explicados en
> [BITACORA.md](BITACORA.md). Lo que sigue es el procedimiento, no una
> expedición.

---

## 0. Antes de nada

Lee, en este orden:

1. [CLAUDE.md](../CLAUDE.md) — convenciones e invariantes del proyecto.
2. [BITACORA.md](BITACORA.md) — qué se hizo en cada sesión y por qué.
3. Este documento.

**Regla que no se negocia:** los commits **nunca** llevan `Co-Authored-By` ni
atribución a Claude. Es instrucción explícita del cliente.

**Requisitos:** Node ≥ 22, pnpm 11 (`npm i -g pnpm` — corepack falla por permisos
en Windows), Docker Desktop en marcha.

---

## 1. Arranque

```bash
git clone https://github.com/GLEXROBOTICS-DEV/glexco-backend-edu-platform
cd glexco-backend-edu-platform

pnpm install
pnpm setup          # genera .env con secretos criptográficos reales
pnpm build          # deben compilar 9 paquetes y servicios
pnpm test           # deben pasar 155 pruebas
```

Si `pnpm install` avisa de `Ignored build scripts`, ejecuta `pnpm rebuild esbuild`.

```bash
pnpm infra:up       # Postgres, Redis, NATS, MinIO, Mailpit, Jaeger
docker compose -f infra/docker/docker-compose.yml ps   # los 6 en healthy
```

`postgres` tarda unos segundos en pasar a `healthy`; espera a que lo esté antes
de migrar. La primera vez ejecuta `infra/docker/postgres/init/*.sql`, que crea un
schema y un rol por servicio más las tablas `outbox` y `processed_events`.

```bash
pnpm --filter @glexco/identity     db:migrate
pnpm --filter @glexco/institutions db:migrate
pnpm --filter @glexco/catalog      db:migrate
pnpm --filter @glexco/media        db:migrate
pnpm --filter @glexco/assessment   db:migrate
pnpm --filter @glexco/analytics    db:migrate
```

Si el puerto 5432 ya lo ocupa otro proyecto, ajusta `GLEXCO_POSTGRES_PORT` en
`infra/docker/.env` y las `DATABASE_URL_*` de tu `.env`. En la máquina actual
está en **5433** por esa razón.

Cada servicio en su terminal:

```bash
pnpm --filter @glexco/identity     dev   # 3101
pnpm --filter @glexco/institutions dev   # 3102
pnpm --filter @glexco/catalog      dev   # 3103
pnpm --filter @glexco/media        dev   # 3108
pnpm --filter @glexco/assessment   dev   # 3105
pnpm --filter @glexco/analytics    dev   # 3107
pnpm --filter @glexco/api-gateway  dev   # 3000
pnpm --filter @glexco/web          dev   # 3010 (portal)
```

Y la verificación:

```bash
pnpm seed           # kit, lote de codigos, institucion y salon
pnpm smoke          # 95 comprobaciones de punta a punta
pnpm smoke:direct   # las mismas contra identity, saltándose el gateway
pnpm concurrency    # las cuatro comprobaciones de la seccion 3
pnpm smoke:web      # 70 comprobaciones del portal (necesita el portal en marcha)
```

`pnpm seed` hace falta porque identidad habla con el catálogo **real**: un código
que no existe en la base se rechaza, que es exactamente lo que debe pasar. Los
antiguos literales `GLX-TEST...` solo los aceptaba el doble en memoria.

Si `pnpm smoke` empieza a devolver `TOO_MANY_ACTIVATION_ATTEMPTS`, no hay ningún
fallo: son los límites de fuerza bruta haciendo su trabajo (cinco códigos por IP
y hora). Para limpiar los contadores en local:

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL"
```

---

## 2. Lo que falló la primera vez (ya corregido)

Se deja anotado porque explica por qué varias cosas están como están. El detalle
completo, en la entrada de la sesión 5 de [BITACORA.md](BITACORA.md).

- **`tsx` rompía la inyección de dependencias en silencio** (esbuild no implementa
  `emitDecoratorMetadata`). El script `dev` compila con `tsc`. No lo cambies.
- **Las sondas de salud estaban en `/v1/health/live` y pedían token.** Ahora son
  `VERSION_NEUTRAL` y `@Public()`.
- **La API interna tenía la versión duplicada** (`/api/v1/internal/v1/...`) y las
  llamadas entre servicios daban 404.
- **El gateway reenviaba `content-length` y `content-encoding` obsoletos**, lo
  que rompía `POST /auth/refresh` y las respuestas grandes.
- **La versión optimista no avanzaba al iniciar sesión**, porque solo lo hacía al
  emitir un evento de dominio. Ahora existe `AggregateRoot.touch()`.
- **`citext`, `btree_gist` y `public.immutable_unaccent`** los crea el init del
  contenedor con el superusuario.

Puntos que siguen siendo frágiles y conviene vigilar:

**Las migraciones.** El SQL está escrito a mano y usa `citext`, `pg_trgm`,
`unaccent`, `btree_gist` y `EXCLUDE USING gist`. Si alguna extensión no está en
la imagen `postgres:16-alpine`, el `CREATE EXTENSION` fallará. La solución es
añadirla a `infra/docker/postgres/init/01-schemas.sql`, no quitar el índice.

**Permisos de rol.** Cada servicio se conecta con su propio rol
(`glexco_identity`, `glexco_catalog`…) que solo tiene permiso sobre su schema. Si
ves `permission denied for schema`, revisa el bucle de `01-schemas.sql` — es
deliberado que no puedan cruzar schemas.

**El stream de NATS.** `ensureStream` lo crea al arrancar. Si dos servicios lo
crean a la vez con configuraciones distintas, el segundo falla. Se ve en
http://localhost:8222.

**El consumidor de eventos.** `EventConsumer` usa `filter_subjects` (plural), que
requiere NATS ≥ 2.10. El compose fija esa versión, pero conviene confirmarlo.

**Argon2.** `@node-rs/argon2` trae binarios precompilados. Si en esta máquina
no hay para su arquitectura, el arranque de identity falla al cargar el módulo.

---

## 3. Lo que hay que verificar de verdad

La prueba de humo cubre el camino feliz. Estas cuatro cosas son las que
justifican la arquitectura, y **están verificadas con concurrencia real desde la
sesión 5**: `pnpm concurrency` las ejecuta las cuatro y pasa 14 comprobaciones.

Lo que sigue explica qué mide cada una y por qué. Si tocas el canje, el tope de
plazas, la outbox o el consumidor, vuelve a ejecutarlo.

### 3.1 El código de activación es de un solo uso

Es la regla que sostiene el modelo de negocio: un libro, un acceso. Se apoya en
tres piezas —una transacción, `SELECT … FOR UPDATE` sobre la fila del código, y
el rechazo del agregado— y **funciona en desarrollo aunque falte el bloqueo**,
porque nunca hay dos peticiones a la vez. Falla el primer día de clase, cuando
treinta alumnos activan en el mismo minuto.

Cómo probarlo: inserta un código, y lánzale **20 canjes simultáneos** con 20
alumnos distintos (`Promise.all`, no en serie — en serie no prueba nada).

Debe resultar: **exactamente 1 canje con éxito**, 19 con `409 ACTIVATION_CODE_ALREADY_USED`,
y **exactamente 1 fila** en `catalog.entitlements` para ese código.

Si salen dos accesos, el bloqueo no está actuando: mira
`PgActivationCodeRepository.findByHashForUpdate` y comprueba que usa el cliente
de la transacción y no el pool.

### 3.2 El tope de plazas del salón

Mismo razonamiento. Crea un salón con `capacity: 5` y lanza **20 matrículas
simultáneas**. Deben entrar 5 y rechazarse 15 con `CLASSROOM_FULL`, y
`enrollments` debe tener 5 filas activas. Ni 6.

### 3.3 La outbox no pierde eventos

Con los servicios arriba, **para NATS** (`docker compose stop nats`), registra un
alumno, y comprueba que la fila está en `identity.outbox` sin publicar. Vuelve a
levantar NATS y verifica que el relay la publica y que institutions matricula al
alumno. El alumno no debe quedarse sin matrícula: solo tardar más.

### 3.4 La deduplicación de eventos

Publica el mismo evento dos veces a mano en el stream. El consumidor debe
aplicarlo una sola vez: una fila en `institutions.processed_events` y una sola
matrícula.

---

## 4. Lo que falta por construir

Ver [ROADMAP.md](ROADMAP.md) para el detalle. Resumen del estado:

| Fase | Estado |
|---|---|
| 0 · Cimientos | ✅ |
| 1 · Identidad y acceso | ✅ (falta ejecutarlo) |
| 2 · Instituciones y salones | ✅ (falta ejecutarlo) |
| 3 · Catálogo, kits, códigos y medios | ✅ |
| 5 · Evaluación | 🔄 servicio funcionando, falta el portal docente |
| 7 · Analítica | 🔄 los cinco dashboards; tres con pantalla |
| 4 · Portales de alumno | 🔄 ingreso, portadas y progreso funcionando |
| 5–8 | ⬜ |

**La Fase 3 está cerrada.** El siguiente paso es la **Fase 4**: los portales de
alumno. La dirección visual ya está aprobada en `design/canvas/`, así que no hay
que decidir nada de diseño antes de empezar a codificar.

Queda suelto, sin bloquear nada: programar la limpieza de subidas abandonadas
(`listAbandoned` ya existe), contratar y configurar el proveedor de video real
(`VIDEO_PROVIDER_URL`), y los endpoints de alta y edición de contenido —hoy el
contenido se siembra por SQL y solo el cambio de estado de publicación tiene
API—.

**La Fase 4 (frontend) tiene su dirección visual ya aprobada** — el canvas está
en `design/canvas/` y publicado como artifact. La paleta sale del logo real:
`#2C53A0` y `#86C9BD`. Tipografía Outfit + IBM Plex Sans. Los `.dc.html` son la
referencia visual; no son código de producción.

---

## 5. Trampas de este repositorio

Cosas que ya costaron tiempo una vez.

**No inyectes el logger de pino donde se espera `LoggerPort`.** Las firmas están
invertidas: pino recibe `(contexto, mensaje)` y el puerto `(mensaje, contexto)`.
Hay dos tokens distintos, `LOGGER` y `LOGGER_PORT`, precisamente para que no se
puedan confundir. Un casteo compila y luego pierde el contexto de **todas** las
líneas de log.

**Los repositorios de escritura solo reciben el pool de LECTURA.** No es un
descuido: toda escritura pasa por el cliente de la transacción. Una consulta
lanzada al pool tomaría otra conexión, quedaría fuera de la transacción y no
vería el bloqueo de fila del que dependen 3.1 y 3.2.

**Un caso de uso invocado desde un evento usa `JoiningUnitOfWork`**, no
`PgUnitOfWork`. Con la normal abriría una segunda transacción y competiría por
los mismos bloqueos que la del consumidor.

**`ACTIVATION_CODE_PEPPER` no tiene valor por defecto**, y cambiarla **invalida
todos los códigos ya emitidos**. Se fija una vez y no se rota.

**Los adaptadores en memoria de catalog e institutions** (`InMemoryActivationCodeGateway`
y compañía) aceptan cualquier código que empiece por `GLX-TEST`. Solo se activan
si falta la URL del servicio real, y `loadIdentityConfig` aborta el arranque en
producción si eso pasa. No relajes esa comprobación.

**El tipo de un archivo se decide por sus BYTES, nunca por su extension ni por
el `Content-Type`.** Las dos ultimas las escribe el cliente. `MagicBytesSniffer`
tiene la lista cerrada de firmas admitidas; ampliarla es anadir una firma, no
relajar la comprobacion.

**La URL de subida se firma como POST con política, no como PUT.** Un PUT
prefirmado no puede limitar el tamaño: quien tenga la URL sube lo que quiera.

**El evento de registro lleva el `activationCodeId`, nunca el código.** Es lo que
permite a catálogo canjear al consumir el alta sin que un secreto con valor
económico viva días en la outbox y en el stream. Si algún día hace falta más
información en ese evento, la regla no cambia: el código no viaja.

**No existe endpoint para volver a descargar el CSV de un lote,** y no es un
olvido: en la base solo queda el hash de cada código. Si alguien lo pide, la
respuesta es repetir la tirada, no relajar el hasheo.

**Escribir archivos:** los heredocs de Bash con TypeScript grande se corrompen en
Windows. Usa la herramienta de escritura o Python con
`io.open(..., newline='\n')`. Y nunca escribas caracteres de control literales en
una expresión regular.

---

## 6. Cuando llegue el despliegue en Railway

Es un **monorepo**: un repositorio, N servicios. A cada uno se le configura:

- **Root Directory** — `services/identity`, `services/api-gateway`, etc.
- **Watch Paths** — su carpeta más `packages/**`, para que tocar el frontend no
  redespliegue los ocho servicios.
- **Build** `pnpm install --frozen-lockfile && pnpm build` · **Start** `pnpm start`.

Servicios gestionados: PostgreSQL y Redis. NATS y MinIO no los ofrece Railway
como plugin; NATS puede desplegarse como contenedor y el almacenamiento de
objetos conviene llevarlo directo a S3 o a Huawei OBS.

Solo **api-gateway** lleva dominio público. El resto se hablan por la red privada.

Variables por servicio, no globales: cada uno recibe **solo** su `DATABASE_URL`.
`identity` es el único que conoce `JWT_REFRESH_SECRET`; los demás solo el de
acceso, porque verifican tokens pero no los emiten.

En producción el arranque aborta si los secretos siguen siendo los de ejemplo, si
`COOKIE_SECURE` es `false`, o si el access y el refresh comparten secreto. Es
deliberado: una réplica mal configurada que arrancase igual pasaría el health
check y empezaría a emitir tokens inválidos.
