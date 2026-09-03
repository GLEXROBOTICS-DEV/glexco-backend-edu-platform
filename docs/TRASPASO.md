# Traspaso a otra máquina

Este documento es para la instancia de Claude que retome el proyecto desde el
zip. Léelo entero antes de tocar nada; después sigue el orden de
[CLAUDE.md](../CLAUDE.md).

---

## 1. Qué contiene el zip

El repositorio completo **sin** `node_modules`, `dist`, `.next` ni `.env`. Es
decir: todo el código y la historia de git, nada generado.

**No incluye `.env`, y es deliberado.** Contiene secretos criptográficos reales
—los de JWT y, sobre todo, `ACTIVATION_CODE_PEPPER`—. Se genera de nuevo con
`pnpm setup`.

> ⚠️ **`ACTIVATION_CODE_PEPPER` invalida todos los códigos ya emitidos si
> cambia.** En esta máquina de desarrollo no importa: los códigos se siembran de
> cero con `pnpm seed`. En producción se fija **una vez** y no se rota nunca.

---

## 2. Puesta en marcha, en orden

```bash
npm i -g pnpm          # pnpm 11; corepack falla por permisos en Windows
pnpm install
pnpm setup             # genera .env con secretos nuevos
pnpm build             # deben compilar 12 paquetes, servicios y el portal
pnpm test              # 155 pruebas en memoria, sin Docker
```

**El puerto de Postgres.** En la máquina de origen el 5432 estaba ocupado por
otro proyecto, así que se publicó en el **5433** mediante
`infra/docker/.env` (que tampoco viaja en el zip, por estar en `.gitignore`).
Si en la máquina nueva el 5432 está libre, no hay que hacer nada: el compose usa
`${GLEXCO_POSTGRES_PORT:-5432}`. Si está ocupado, crea `infra/docker/.env` con:

```
GLEXCO_POSTGRES_PORT=5433
```

…y ajusta las `DATABASE_URL_*` de tu `.env` al mismo puerto.

```bash
pnpm infra:up          # Postgres, Redis, NATS, MinIO, Mailpit, Jaeger

pnpm --filter @glexco/identity     db:migrate
pnpm --filter @glexco/institutions db:migrate
pnpm --filter @glexco/catalog      db:migrate
pnpm --filter @glexco/media        db:migrate
pnpm --filter @glexco/assessment   db:migrate
```

Cada servicio en su terminal:

| Comando | Puerto |
|---|---|
| `pnpm --filter @glexco/identity dev` | 3101 |
| `pnpm --filter @glexco/institutions dev` | 3102 |
| `pnpm --filter @glexco/catalog dev` | 3103 |
| `pnpm --filter @glexco/assessment dev` | 3105 |
| `pnpm --filter @glexco/media dev` | 3108 |
| `pnpm --filter @glexco/api-gateway dev` | 3000 |
| `pnpm --filter @glexco/web dev` | 3010 |

Y la verificación:

```bash
pnpm seed          # kit, curso, lote de codigos, institucion y salon
pnpm smoke         # 95 comprobaciones de punta a punta
pnpm concurrency   # 14 comprobaciones de concurrencia real
pnpm smoke:web     # 70 comprobaciones del portal
```

**Si algo de eso no da el número indicado, algo se rompió en el traslado.** Esos
cuatro números son el contrato de este traspaso.

---

## 3. Lo que más te va a molestar, y no es un fallo

**Los límites de fuerza bruta.** Cinco códigos de activación por IP y hora, diez
registros por IP y hora, tres recuperaciones de contraseña. Son los valores
correctos y **no hay que relajarlos**, pero se agotan en dos o tres ejecuciones
seguidas de `pnpm smoke`. Cuando empiecen a salir `TOO_MANY_ACTIVATION_ATTEMPTS`
o `429`, no busques el fallo: limpia los contadores.

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL"
```

**Los servidores de desarrollo se reinician al recompilar.** Si lanzas `pnpm
build` y acto seguido `pnpm smoke`, la prueba pillará algún servicio a medio
arrancar y verás `ECONNREFUSED`. Espera a que los siete respondan en
`/health/live` antes de medir nada.

**El token aparece en el HTML en `next dev`.** Es la instrumentación de React 19,
no una fuga: en el build de producción no está, y `web-check.mjs` distingue los
dos casos. Aun así, no compartas pantalla ni `view-source` de un servidor de
desarrollo con la sesión iniciada.

---

## 4. Estado exacto al cerrar la sesión 8

| Fase | Estado |
|---|---|
| 0 · Cimientos | ✅ |
| 1 · Identidad y acceso | ✅ |
| 2 · Instituciones y salones | ✅ |
| 3 · Catálogo, kits, códigos y medios | ✅ |
| 4 · Portales de alumno | 🔄 ingreso y portadas funcionando |
| 5 · Evaluación | 🔄 servicio funcionando, falta el portal docente |
| 6 · Progreso y gamificación | ⬜ |
| 7 · Comunicación, analítica y admin | ⬜ |
| 8 · Endurecimiento y despliegue | ⬜ |

Siete servicios escritos de ocho (`learning`, `engagement` y `analytics` siguen
vacíos; `assessment` y `media` ya no lo están).

**Nada se ha subido a GitHub todavía**, por decisión del cliente: se subirá
cuando haga falta probar el backend desplegado. El remoto está configurado
(`origin` → `GLEXROBOTICS-DEV/glexco-backend-edu-platform`) y la rama es `main`.

**Identidad de git:** `SvaleraG <svalera.glexco@gmail.com>`. Está fijada en el
`.git/config` del repositorio, así que viaja en el zip. **Los commits nunca
llevan `Co-Authored-By` ni atribución a Claude** — es instrucción explícita del
cliente y anula cualquier valor por defecto.

---

## 5. Por dónde seguir

El siguiente paso natural es **terminar la Fase 4**: las pantallas interiores de
los portales de alumno. El backend que necesitan ya existe y está probado, y la
dirección visual está aprobada en `design/canvas/`, así que no hay que decidir
nada de diseño antes de codificar.

En concreto, y por orden de valor:

1. **Biblioteca del kit** con reproductor y descargas por URL prefirmada. Es lo
   que el alumno abre cada día.
2. **Activación de código desde el portal.** Hoy solo se puede activar durante el
   registro o por API; un alumno que compra un segundo libro no tiene pantalla.
3. **Registro de alumno** con el formulario de institución/salón.
4. **Cuestionarios en el portal**: el servicio está listo y probado, pero no hay
   interfaz para responderlos.
5. **Bandeja de corrección del docente.** `listPendingForClassroom` ya existe en
   el backend.

Lo que **no** conviene empezar todavía: las Fases 6 y 7. Dependen de que el
portal esté vivo para que alguien pueda decir si la gamificación y los paneles
sirven.

---

## 6. Preguntas abiertas para el cliente

Anótalas y pregúntalas cuando toquen; no las decidas por tu cuenta.

- **Evidencias en vídeo.** El roadmap de la Fase 5 decía "evidencias (foto/vídeo)
  del alumno". El cliente aclaró que los colegios no suben vídeo, y después pidió
  no quitar la subida con proveedor. Estado actual: **se admiten los dos
  caminos** —subida de vídeo por proveedor y enlace externo—. Si eso no es lo que
  quiere, hay que acotarlo.
- **Proveedor de vídeo.** Falta contratarlo y configurar `VIDEO_PROVIDER_URL`.
  Mientras esté vacío, el vídeo se sirve del bucket propio, que vale para
  desarrollar y nada más: **en producción el arranque aborta sin esa variable**.
- **Rúbricas.** La corrección manual es hoy por puntos libres sobre cada
  pregunta. Si hacen falta rúbricas con criterios, es trabajo aparte.
- **Dominios admitidos para enlaces.** La lista blanca actual cubre Microsoft
  365, Google Workspace, YouTube y Vimeo. Si algún centro usa otra cosa, se añade
  en `services/media/src/domain/shared-link.ts`.
