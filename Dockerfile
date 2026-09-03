# Imagen de cualquier servicio de GLEXCO.
#
# UN SOLO Dockerfile para los diez desplegables. Cual se construye lo decide el
# argumento `SERVICE`. Diez Dockerfiles casi identicos es diez sitios donde
# arreglar la misma vulnerabilidad de la imagen base, y nueve de ellos se quedan
# atras.
#
# **Por que Docker y no el constructor automatico de Railway.** El plan es
# Railway primero y AWS o Huawei Cloud despues. Nixpacks solo existe en Railway:
# migrar significaria reconstruir el empaquetado entero justo cuando hay trafico
# real. Una imagen Docker se despliega igual en Railway, en ECS, en EKS y en CCE,
# asi que el cambio de proveedor pasa a ser una decision de infraestructura y no
# un proyecto de ingenieria.
#
# Uso:
#   docker build --build-arg SERVICE=identity -t glexco/identity .
#   docker build --build-arg SERVICE=web      -t glexco/web .

# ---------------------------------------------------------------------------
# Base
# ---------------------------------------------------------------------------
# Node 22 LTS sobre Alpine. La version va fijada: `node:22-alpine` a secas
# cambiaria de version menor entre dos despliegues del mismo commit, y entonces
# "funciona en produccion" deja de ser una afirmacion sobre el codigo.
FROM node:22.14-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    # Silencia el aviso de actualizacion de corepack en los registros de
    # construccion, que de otro modo enmascara los avisos que si importan.
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

# `libc6-compat` lo necesita sharp, que usa binarios nativos para las miniaturas.
# Va en la base y no solo en media porque la capa se comparte entre imagenes.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencias
# ---------------------------------------------------------------------------
# Se copian SOLO los manifiestos antes del codigo. Es lo que hace que cambiar una
# linea de un caso de uso no vuelva a descargar el arbol de dependencias entero:
# la capa de instalacion se reutiliza mientras el lockfile no cambie, y eso es la
# diferencia entre un despliegue de un minuto y uno de seis.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/kernel/package.json          packages/kernel/
COPY packages/contracts/package.json       packages/contracts/
COPY packages/config/package.json          packages/config/
COPY packages/observability/package.json   packages/observability/
COPY packages/nest-platform/package.json   packages/nest-platform/
COPY packages/tsconfig/package.json        packages/tsconfig/
COPY packages/icons/package.json           packages/icons/
COPY services/identity/package.json        services/identity/
COPY services/institutions/package.json    services/institutions/
COPY services/catalog/package.json         services/catalog/
COPY services/learning/package.json        services/learning/
COPY services/assessment/package.json      services/assessment/
COPY services/engagement/package.json      services/engagement/
COPY services/analytics/package.json       services/analytics/
COPY services/media/package.json           services/media/
COPY services/api-gateway/package.json     services/api-gateway/
COPY apps/web/package.json                 apps/web/

# `--frozen-lockfile` aborta si el lockfile no cuadra con los manifiestos, en vez
# de resolver versiones nuevas en silencio. Un despliegue que instala algo
# distinto de lo que se probo no es el mismo despliegue.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Compilacion
# ---------------------------------------------------------------------------
FROM deps AS build
ARG SERVICE
# Se comprueba pronto y con un mensaje util: sin esto, olvidar el argumento
# produce un fallo de Turbo sobre un filtro vacio que no dice que falta.
RUN test -n "$SERVICE" || (echo "Falta --build-arg SERVICE=<nombre>" && exit 1)

COPY . .

# `...` construye tambien las dependencias del paquete en el orden correcto. Sin
# los tres puntos, Turbo compila solo el servicio y falla al no encontrar el
# `dist` de @glexco/kernel.
#
# El portal necesita ademas la URL publica del gateway EN TIEMPO DE
# CONSTRUCCION: Next la incrusta en el bundle del cliente, asi que pasarla solo
# como variable de ejecucion la deja sin efecto y las llamadas van a localhost.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm turbo run build --filter=@glexco/${SERVICE}...

# Un directorio AUTONOMO con solo lo que este servicio necesita.
#
# `pnpm deploy` resuelve dos problemas de golpe. El primero es el tamano: sin el,
# la imagen arrastra el node_modules de los dieciocho paquetes del espacio de
# trabajo -mas de un gigabyte- cuando este servicio usa una fraccion. El segundo
# es mas sutil: el resultado NO es un espacio de trabajo, asi que en ejecucion no
# hay nada que pueda intentar reinstalar dependencias. Con el arbol de pnpm
# intacto, arrancar con `pnpm start` dispara su comprobacion de dependencias, que
# intenta escribir en /app y falla con EACCES bajo un usuario sin privilegios.
#
# `--legacy` porque el formato nuevo exige `inject-workspace-packages`, que
# cambiaria la resolucion tambien en local.
RUN CI=true pnpm --filter=@glexco/${SERVICE} deploy --prod --legacy /out

# ---------------------------------------------------------------------------
# Ejecucion
# ---------------------------------------------------------------------------
FROM base AS runtime
ARG SERVICE
ENV NODE_ENV=production     GLEXCO_SERVICE=$SERVICE     NODE_OPTIONS="--enable-source-maps"

WORKDIR /app
# Solo el directorio autonomo. Usuario sin privilegios: ejecutar como root
# significa que una ejecucion remota de codigo empieza siendo root dentro del
# contenedor, y no hay ninguna razon para regalarlo.
COPY --from=build --chown=node:node /out /app
USER node

# El puerto real lo fija la variable PORT del entorno. Este EXPOSE es
# documentacion para quien lea la imagen, no una atadura.
EXPOSE 3000

# Se arranca con node directamente y NO con pnpm: pnpm es una herramienta de
# desarrollo, y en ejecucion lo unico que aporta es una comprobacion de
# dependencias que intenta escribir en el disco.
#
# Node 22 maneja SIGTERM correctamente y `bootstrapService` ya implementa el
# apagado ordenado -deja de aceptar peticiones, termina las que hay en vuelo,
# cierra los pools y drena NATS-, asi que no hace falta un init como dumb-init.
COPY --chown=node:node infra/docker/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
