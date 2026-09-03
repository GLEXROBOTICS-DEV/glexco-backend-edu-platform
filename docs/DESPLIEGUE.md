# Despliegue en Railway

Guía para poner GLEXCO en producción. **Railway primero; AWS o Huawei Cloud
después**, y por eso todo lo de aquí se apoya en Docker: una imagen se despliega
igual en los tres, mientras que el constructor automático de Railway solo existe
en Railway.

---

## 1. Cuántos servicios, y por qué

Un **proyecto** de Railway contiene **servicios**. Cada servicio es una unidad
desplegable con su propia construcción, sus variables y, si quieres, su dominio.

La respuesta corta: **catorce servicios en un proyecto, todos los de aplicación
apuntando al mismo repositorio.**

### Infraestructura (4)

| Servicio | Qué es | Cómo |
|---|---|---|
| `postgres` | Base de datos | Plugin de Railway |
| `redis` | Sesiones, límites, cerrojos, caché | Plugin de Railway |
| `nats` | Bus de eventos con JetStream | Imagen `nats:2.10-alpine` + volumen |
| Almacén de objetos | Material del kit, evidencias | **Cloudflare R2** (fuera de Railway) |

**El almacén de objetos no va en Railway, y es deliberado.** Railway no tiene
plugin de S3, así que la alternativa sería MinIO sobre un volumen: un único punto
de fallo sin réplica, con el material de todos los kits dentro. R2 es compatible
con S3 —el mismo adaptador vale sin tocar una línea— y no cobra el tráfico de
salida, que en esta plataforma es justo el que se dispara: un aula entera
abriendo el mismo PDF a la vez.

### Aplicación (10)

Los diez apuntan **al mismo repositorio y al mismo `Dockerfile`**. Lo único que
cambia es la variable `SERVICE`.

| Servicio | Puerto | Dominio público |
|---|---|---|
| `api-gateway` | 3000 | **Sí** — `api.glexco.pe` |
| `web` | 3010 | **Sí** — `app.glexco.pe` |
| `identity` | 3101 | No |
| `institutions` | 3102 | No |
| `catalog` | 3103 | No |
| `learning` | 3104 | No |
| `assessment` | 3105 | No |
| `engagement` | 3106 | No |
| `analytics` | 3107 | No |
| `media` | 3108 | No |

**Solo dos tienen dominio público.** Los otros ocho viven en la red privada de
Railway y se alcanzan como `identity.railway.internal:3101`. No es una
preferencia: la tabla de rutas del gateway es el único sitio donde se decide qué
está expuesto a internet, y dar dominio a un microservicio la deja sin sentido.

### ¿Por qué no menos servicios?

Se podría meter todo en un proceso. No se hace por dos razones concretas:

- **El aislamiento de la base se apoya en que cada servicio tenga su rol.** Un
  solo proceso usaría una sola conexión, y `catalog` podría leer el schema de
  `identity`. Es la invariante 1 del proyecto y aquí hay datos de menores.
- **No escalan igual.** En el arranque de una clase, `assessment` y `catalog`
  reciben treinta veces más carga que `institutions`. Con un solo proceso se
  replica todo para absorber el pico de uno.

**Lo que sí cuesta:** cada servicio de Node arranca sobre unos 120-150 MB de RAM
en reposo, así que los diez son del orden de 1,3 GB de base. Railway factura por
consumo de RAM y CPU, no por número de servicios, de modo que la cifra a mirar es
esa y no el catorce. Si al principio hace falta apretar, los candidatos a
fusionar son `analytics` y `learning` —los dos son proyecciones de lectura— pero
**no lo recomiendo antes de tener tráfico real**: se pierde el aislamiento de rol
y volver atrás cuesta más que haberlo mantenido.

---

## 2. Tres cosas que hay que resolver ANTES

### 2.1 La base de datos no se prepara sola

En local, `infra/docker/postgres/init/*.sql` los ejecuta el contenedor de
Postgres al inicializarse. **En Railway ese directorio no existe y esos scripts
no corren nunca.** Sin ellos no hay schemas, ni roles por servicio, ni tabla
`outbox`, y la primera migración falla con `permission denied for database`.

Para eso está `infra/scripts/bootstrap-db.mjs`. Se ejecuta **una vez**, desde tu
máquina, contra la base recién creada:

```bash
railway link                      # elige el proyecto
railway variables -s postgres     # copia DATABASE_URL (la del usuario admin)

ADMIN_DATABASE_URL='postgresql://postgres:...@...railway.app:5432/railway' \
GLEXCO_DB_PASSWORD='<una contraseña larga que guardes>' \
node infra/scripts/bootstrap-db.mjs
```

Imprime las ocho `DATABASE_URL_*`. **Cada servicio recibe solo la suya**: darle
la de otro rompe exactamente el aislamiento que estos roles existen para
garantizar.

### 2.2 El proveedor de vídeo es obligatorio en producción

`media` y `catalog` **abortan el arranque** si `VIDEO_PROVIDER_URL` está vacía
fuera de desarrollo. No es un descuido: sin proveedor, los tutoriales del kit se
servirían desde nuestro propio bucket, y un vídeo de clase son cientos de megas
que abre un aula entera a la vez. El primer aviso de que se olvidó configurarlo
sería la factura de salida.

**Es un bloqueo real: hay que contratar el proveedor antes del primer despliegue
a producción.** Si quieres levantar un entorno de pruebas ya, ponlo con
`NODE_ENV=staging` en vez de `production` y el corte no se aplica.

### 2.3 Los secretos se fijan una vez

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Dónde | Aviso |
|---|---|---|
| `ACTIVATION_CODE_PEPPER` | Solo `catalog` | **Cambiarla invalida TODOS los códigos ya impresos.** Se fija una vez y no se rota nunca. |
| `JWT_ACCESS_SECRET` | Los diez | Compartida: cada servicio verifica las firmas de los demás. |
| `JWT_REFRESH_SECRET` | Solo `identity` | |
| `SIGNING_SECRET` | Los diez | |
| `INTERNAL_SERVICE_TOKEN` | Los diez | Autoriza la API interna, incluida la que acuña enlaces de recuperación. |
| `GLEXCO_DB_PASSWORD` | Ninguno directamente | Va dentro de cada `DATABASE_URL_*`. |

---

## 3. Paso a paso

### 3.1 Proyecto e infraestructura

```bash
railway login
railway init --name glexco-produccion
```

En el panel: **New → Database → PostgreSQL**, y lo mismo con **Redis**.

Para NATS, **New → Empty Service**, imagen `nats:2.10-alpine`, y:

- Comando de arranque: `--jetstream --store_dir /data`
- Un **volumen** montado en `/data` — JetStream guarda ahí los mensajes no
  confirmados. Sin volumen, un reinicio pierde los eventos que aún no consumió
  ningún servicio, y con ellos las proyecciones de analítica y los correos que
  estuvieran en cola.

Y prepara la base con el script de 2.1.

### 3.2 Cada servicio de aplicación

Se repite diez veces, cambiando solo dos cosas. Con el CLI:

```bash
railway add --service identity
railway link --service identity
railway variables --set "SERVICE=identity" --set "PORT=3101"
```

O en el panel, **New → GitHub Repo → glexco-backend-edu-platform**, y luego:

| Ajuste | Valor |
|---|---|
| **Root Directory** | `/` (la raíz — el espacio de trabajo de pnpm necesita el lockfile) |
| **Builder** | Dockerfile |
| **Dockerfile Path** | `Dockerfile` |
| **Watch Paths** | `services/identity/**`, `packages/**`, `pnpm-lock.yaml`, `Dockerfile` |
| **Pre-Deploy Command** | `node infra/scripts/migrate.mjs identity` |

**`SERVICE` es una variable del servicio**, y Railway pasa las variables como
argumentos de construcción al Dockerfile. Si no llegara, la construcción falla de
inmediato con «Falta --build-arg SERVICE=`<nombre>`»: está puesto a propósito para
que el fallo sea legible en vez de un error de Turbo sobre un filtro vacío.

**Las Watch Paths importan más de lo que parece.** Sin ellas, cambiar una línea
del portal redespliega los diez servicios. Con ellas, `packages/**` sí redespliega
todo —y debe hacerlo: `@glexco/contracts` es lo que los mantiene sincronizados—
pero un cambio en `services/catalog` solo toca catálogo.

**El Pre-Deploy Command aplica las migraciones antes de arrancar la versión
nueva.** `migrate.mjs` toma un cerrojo de aviso de PostgreSQL, así que dos
réplicas desplegándose a la vez no se pisan: la segunda espera y ve que no hay
nada pendiente.

### 3.3 Variables comunes a los diez

```
NODE_ENV=production
LOG_LEVEL=info
REDIS_URL=${{Redis.REDIS_URL}}
NATS_URL=nats://nats.railway.internal:4222
JWT_ACCESS_SECRET=<...>
JWT_ISSUER=glexco
JWT_AUDIENCE=glexco-api
SIGNING_SECRET=<...>
INTERNAL_SERVICE_TOKEN=<...>
CORS_ORIGINS=https://app.glexco.pe
COOKIE_SECURE=true
COOKIE_DOMAIN=glexco.pe

IDENTITY_URL=http://identity.railway.internal:3101
INSTITUTIONS_URL=http://institutions.railway.internal:3102
CATALOG_URL=http://catalog.railway.internal:3103
LEARNING_URL=http://learning.railway.internal:3104
ASSESSMENT_URL=http://assessment.railway.internal:3105
ENGAGEMENT_URL=http://engagement.railway.internal:3106
ANALYTICS_URL=http://analytics.railway.internal:3107
MEDIA_URL=http://media.railway.internal:3108
```

`${{Redis.REDIS_URL}}` es una referencia de Railway: coge el valor del otro
servicio. Úsala siempre que puedas en vez de copiar el literal, porque si Railway
rota la credencial la referencia se actualiza sola.

**Y la suya propia:** cada uno recibe su `DATABASE_URL` (la que imprimió el
script de 2.1, renombrada a `DATABASE_URL` a secas o dejada como
`DATABASE_URL_<SERVICIO>`; el cargador de configuración acepta las dos).

### 3.4 Lo específico de cada servicio

| Servicio | Variables propias |
|---|---|
| `catalog` | `ACTIVATION_CODE_PEPPER`, `S3_*`, `VIDEO_PROVIDER_URL` |
| `media` | `S3_*`, `VIDEO_PROVIDER_URL`, `VIDEO_PROVIDER_API_KEY` |
| `identity` | `JWT_REFRESH_SECRET` |
| `engagement` | `SMTP_*`, `MAIL_FROM`, `WEB_URL=https://app.glexco.pe` |
| `api-gateway` | Las ocho `*_URL` y su dominio público |
| `web` | `NEXT_PUBLIC_API_URL=https://api.glexco.pe` |

**`NEXT_PUBLIC_API_URL` tiene que estar en tiempo de CONSTRUCCIÓN**, no solo de
ejecución: Next la incrusta en el bundle del cliente. Si solo se pone como
variable de ejecución, el portal se despliega apuntando a `localhost` y ninguna
llamada del navegador funciona. El `Dockerfile` la declara como `ARG` justo por
esto, y Railway pasa las variables del servicio como argumentos de construcción.

### 3.5 Correo

Engagement necesita un SMTP real. **Mailpit es solo para desarrollo**: acepta
todo y no entrega nada. Resend, Postmark o SES valen; lo que hay que hacer en
cualquiera de los tres es **verificar el dominio con SPF, DKIM y DMARC**, o los
correos de verificación acabarán en la carpeta de no deseado de medio colegio y
parecerá que la plataforma no los envía.

---

## 4. Comprobar que funciona

```bash
curl https://api.glexco.pe/health/ready

GATEWAY_URL=https://api.glexco.pe \
WEB_URL=https://app.glexco.pe \
pnpm smoke
```

**Las pruebas de humo tocan la base y crean datos.** Contra producción con
alumnos reales no se ejecutan: son para el entorno de pruebas, o para producción
antes de dar acceso a nadie.

Los límites de fuerza bruta cuentan **por IP**, y las pruebas salen todas de la
misma: si fallan con 429 tras dos vueltas, es lo esperado.

---

## 5. Lo que queda pendiente

Esto deja la plataforma en marcha, no endurecida. La **fase 8** del
[ROADMAP](ROADMAP.md) sigue sin empezar:

- Pruebas de carga con k6 (arranque de clase, jornada completa).
- Revisión de seguridad y prueba de penetración interna.
- CI/CD con despliegue sin caída y reversión automática.
- Réplicas de lectura y `DATABASE_READ_URLS`, que el código ya contempla.
- Copias de seguridad **probadas restaurándolas**. Una copia que nadie ha
  restaurado nunca no es una copia, es una intención.

Y una pregunta abierta para el cliente que el despliegue vuelve urgente: **el
límite de altas es de diez por IP y hora**, correcto contra un abuso desde
internet, pero una clase de treinta alumnos detrás del NAT de su colegio lo agota
en el minuto tres. Lo razonable es una excepción para las IP declaradas de una
institución con licencia vigente.

---

## 6. Sobre la mudanza a AWS o Huawei

Todo lo de arriba se traduce casi línea por línea, y por eso se hizo con Docker:

| Railway | AWS | Huawei Cloud |
|---|---|---|
| Servicio | ECS Fargate / EKS | CCE |
| PostgreSQL | RDS | RDS for PostgreSQL |
| Redis | ElastiCache | DCS |
| NATS + volumen | ECS + EFS | CCE + EVS |
| Red privada | VPC + Service Discovery | VPC + CoreDNS |
| Cloudflare R2 | Sigue valiendo, o S3 | Sigue valiendo, o OBS |

Lo único que cambia de verdad es **cómo se inyectan las variables** (Secrets
Manager, Parameter Store, CSMS) y **quién enruta el tráfico** (ALB o ELB en vez
del enrutador de Railway). El código no cambia: nunca hubo nada específico de
Railway dentro.
