# Traspaso a otra máquina

Este documento es para la instancia de Claude que retome el proyecto desde el
zip. Léelo entero antes de tocar nada; después sigue el orden de
[CLAUDE.md](../CLAUDE.md).

---

## 1. Qué contiene el zip

El repositorio completo **sin** `node_modules`, `dist`, `.next` ni `.env`: todo
el código y la historia de git, nada generado.

El proyecto **también está en GitHub**, así que el zip es una comodidad y no la
única vía: `git clone https://github.com/GLEXROBOTICS-DEV/glexco-backend-edu-platform.git`
deja lo mismo. Si trabajas desde el zip, comprueba que la carpeta `.git` llegó
(`git log --oneline -5`); si no llegó, clona en su lugar.

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
pnpm build             # deben compilar 15 paquetes, servicios y el portal
pnpm test              # 176 pruebas en memoria, sin Docker
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
pnpm --filter @glexco/engagement   db:migrate
pnpm --filter @glexco/learning     db:migrate
pnpm --filter @glexco/analytics    db:migrate
```

Cada servicio en su terminal:

| Comando | Puerto |
|---|---|
| `pnpm --filter @glexco/identity dev` | 3101 |
| `pnpm --filter @glexco/institutions dev` | 3102 |
| `pnpm --filter @glexco/catalog dev` | 3103 |
| `pnpm --filter @glexco/learning dev` | 3104 |
| `pnpm --filter @glexco/assessment dev` | 3105 |
| `pnpm --filter @glexco/engagement dev` | 3106 |
| `pnpm --filter @glexco/analytics dev` | 3107 |
| `pnpm --filter @glexco/media dev` | 3108 |
| `pnpm --filter @glexco/api-gateway dev` | 3000 |
| `pnpm --filter @glexco/web dev` | 3010 |

Y la verificación:

```bash
pnpm seed          # kit, curso, lote de codigos, institucion y salon
pnpm smoke         # 95 comprobaciones de punta a punta
pnpm concurrency   # 14 comprobaciones de concurrencia real
pnpm smoke:web     # 177 comprobaciones del portal
```

**Si algo de eso no da el número indicado, algo se rompió en el traslado.** Esos
cuatro números son el contrato de este traspaso: 95, 14, 177, más las 176 pruebas
en memoria.

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
`/health/live` antes de medir nada. Pasa lo mismo tras un `pnpm build` del
monorepo: `dev` corre `node --watch dist/main.js`, así que recompilar reinicia
los ocho servicios a la vez.

**El token aparece en el HTML en `next dev`.** Es la instrumentación de React 19,
no una fuga: en el build de producción no está, y `web-check.mjs` distingue los
dos casos. Aun así, no compartas pantalla ni `view-source` de un servidor de
desarrollo con la sesión iniciada.

---

## 4. Estado exacto al cerrar la sesión 12

| Fase | Estado |
|---|---|
| 0 · Cimientos | ✅ |
| 1 · Identidad y acceso | ✅ |
| 2 · Instituciones y salones | ✅ |
| 3 · Catálogo, kits, códigos y medios | ✅ |
| 4 · Portales de alumno | 🔄 registro y activación, ingreso, portadas, progreso y cuestionarios |
| 5 · Evaluación y Teacher Center | 🔄 casi cerrada: falta rúbricas y recursos del docente |
| 6 · Progreso y gamificación | 🔄 progreso, XP, niveles e insignias; faltan certificados |
| **DESPLEGADO en Railway** | ✅ los 15 servicios en línea, con un colegio de demostración sembrado |
| 7 · Comunicación, analítica y admin | 🔄 los cinco dashboards funcionando |
| 8 · Endurecimiento y despliegue | ⬜ |

**Los nueve servicios escritos.** Ya no queda ninguno vacío.

**El ciclo completo de evaluación funciona de punta a punta**: el alumno ve su
kit, responde el cuestionario desde el portal, la máquina corrige lo de marcar al
instante, lo abierto entra en la bandeja del docente, el docente puntúa y cierra
la nota, y el resultado aparece en los cinco dashboards.

**Y desde la sesión 10, el alumno entra solo.** Se registra en `/registro` con el
código de su colegio, elige su salón de la lista real, activa el código de su
libro y termina con la sesión ya iniciada. Un colegio puede empezar a usar la
plataforma sin que nadie de GLEXCO cree una sola cuenta.

**Identidad de git:** `SvaleraG <svalera.glexco@gmail.com>`, fijada en el
`.git/config` del repositorio. **Los commits nunca llevan `Co-Authored-By` ni
atribución a Claude** — es instrucción explícita del cliente y anula cualquier
valor por defecto. La historia está limpia de eso; compruébalo antes de tu
primer push con:

```bash
git log --all --format='%b' | grep -i co-authored-by   # no debe devolver nada
```

**El remoto es `origin` → `GLEXROBOTICS-DEV/glexco-backend-edu-platform`, rama
`main`, y el proyecto ya está subido.** Haz `git pull --rebase` antes de empezar:
puede haber avanzado desde el zip.


---

## 4.bis LA PLATAFORMA ESTÁ DESPLEGADA

**Railway, proyecto `ravishing-forgiveness`.** Los quince servicios en línea, con
un colegio de demostración funcionando de punta a punta.

| | |
|---|---|
| Portal | https://glexcoweb-production.up.railway.app |
| API | https://glexcoapi-gateway-production.up.railway.app |

**Las cuentas y los códigos de prueba están en
[ENTORNO-DEMO.md](ENTORNO-DEMO.md).** Contraseña de todas: `GlexcoDemo2026`.

Cómo se llegó ahí y qué trampas tiene Railway está en
[DESPLIEGUE.md](DESPLIEGUE.md), sección 7. **Léela antes de tocar el despliegue**:
las cinco cosas que documenta costaron una vuelta cada una, y la peor —Railway
genera un `startCommand` que anula el `ENTRYPOINT` de la imagen— tumba el
servicio sin dejar rastro útil en los registros.

### Para trabajar contra Railway

El CLI ya está instalado. La sesión vive en `~/.railway/config.json` y **la lee
cualquier terminal del mismo usuario de Windows**, así que basta con que alguien
haga `railway login` una vez.

Lo que el CLI **no** expone —watch paths, comando previo al despliegue,
`startCommand`— se toca por la API de GraphQL con la misma sesión:
`~/.railway/config.json` → `user.accessToken` → `Bearer` contra
`https://backboard.railway.com/graphql/v2`. La mutación es
`serviceInstanceUpdate(serviceId, environmentId, input)`.

- Proyecto `e73db773-9c79-43c5-98e3-584842c91952`
- Entorno `30bdf65c-e552-4099-a09d-85966515cc82`

**Ojo con `builder`:** su enum solo admite buildpacks (`RAILPACK`, `NIXPACKS`…).
`DOCKERFILE` no es un valor válido; Railway detecta el `Dockerfile` por su cuenta.

---

## 5. Por dónde seguir

> Actualizado al cerrar la **sesión 14**. Lo de arriba manda sobre lo de abajo.

**Lo primero sigue siendo de producto, no de código:** contratar el **proveedor
de vídeo** y un **SMTP real**. Sin el segundo, nadie recibe el correo de
verificación ni el de recuperación —hoy van a Mailpit, que acepta todo y no
entrega nada—. Sin el primero, `ALLOW_BUCKET_VIDEO=true` sigue puesto y con
tráfico real son cientos de megas por vídeo desde nuestro ancho de banda.

### Lo que el cliente ha pedido y está a medias

1. **i18n: traducir el cuerpo de las pantallas.**

   **Síntoma que verás si lo pruebas:** al cambiar a inglés, la barra lateral y
   la pantalla de acceso cambian, y **el cuerpo de las páginas sigue en
   español**. No es un fallo del montaje: es que solo esas superficies están
   traducidas. La infraestructura funciona y lo que queda es mecánico.

   Cómo se continúa, pantalla a pantalla:
   - Componentes de servidor: `const t = await getTranslations('espacio')`.
   - Componentes de cliente (`'use client'`): `const t = useTranslations(...)`.
   - Claves nuevas en `apps/web/src/messages/es.json` **y** `en.json`; si falta
     una en un idioma, next-intl la marca y no rompe la página.
   - Empieza por lo que más se lee: portadas de Discover y Academy, biblioteca,
     evaluaciones y el muro. Los paneles de docente y admin, después.

   Dos decisiones que conviene NO deshacer: el idioma sale del **perfil** del
   usuario y no de la URL (si no, la interfaz y los correos acabarían en idiomas
   distintos), y **las rutas no se traducen** (van en correos ya enviados).
2. **La parte manual de la accesibilidad.** `pnpm a11y` ya cubre lo automatizable
   y sale limpio en 13 pantallas, pero **no puede comprobar tres cosas** y hay
   que hacerlas a ojo: el contraste real sobre la pantalla, el orden de
   tabulación, y si los textos alternativos dicen algo útil. No leas «0
   hallazgos» como «es accesible».

### Después, por valor

3. ~~El comando de reconstrucción de proyecciones.~~ **Hecho en la sesión 15.**

   `pnpm projections:check` compara cada proyección con su origen y dice qué le
   falta; `pnpm projections` lo reconstruye reemitiendo instantáneas a la outbox
   del servicio dueño, para que las rellene su propio manejador. Al añadir un
   consumidor nuevo, **el paso que falta ya no es una chapuza en el sembrador**:
   es registrar su instantánea en `SOURCES` y lanzar el comando.

   Lo único que hay que leer antes de tocarlo está en la cabecera del archivo:
   **solo se reproduce un evento cuyos manejadores sean idempotentes**, y hay tres
   que no lo son —los dos contadores de códigos y `submission.graded`, que acumula
   fallos por pregunta—. Y jamás se reproduce un evento que pide *enviar* algo:
   reproducir `password_reset.requested` mandaría un enlace de recuperación a toda
   la plataforma.

4. ~~`KIT_PUBLISHED` no lo emite nadie.~~ **Hecho en la sesión 15.** Lo emite
   `PublishContentUseCase` con `target: 'kit'`, lo consume `analytics.kit_directory`
   y la pantalla ya dice nombres. Al abrirlo salió que **no existía ningún camino
   que publicase un kit**: `KitRepository.save` estaba implementado y no lo
   llamaba nadie, los kits solo entraban por el sembrador.
5. **Retos, misiones y portafolio** (Fase 6). Son los datos que faltan para que
   «Zona de retos» de Discover y «Proyectos y desafíos» de Academy dejen de estar
   fuera de la barra.
7. **Rúbricas de corrección** y los tipos de pregunta `ordering` y `matching`,
   que están en el vocabulario y no tienen corrección automática escrita.
8. **Portal Admin completo**: instituciones, usuarios, gestión académica y de
   contenidos, comercial. Hoy `/admin` solo tiene la vista de plataforma.
9. **Exportación a PDF, Excel y CSV** de los dashboards.
10. **Fase 8 entera**: pruebas de carga, revisión de seguridad, CI/CD, réplicas de
    lectura y **copias de seguridad probadas restaurándolas**.

### Deudas anotadas que siguen abiertas

- **El límite de altas es por IP**, y una clase de treinta alumnos detrás del NAT
  de su colegio lo agota en el minuto tres. Es una decisión del cliente: lo
  razonable es una excepción para las IP declaradas de una institución con
  licencia vigente.
- **MinIO y Mailpit son provisionales.** Hay que sustituirlos por Cloudflare R2 y
  un SMTP con SPF, DKIM y DMARC antes de que entre nadie real.
- **La contraseña de PostgreSQL conviene rotarla**: se imprimió en la terminal
  durante la sesión 13. La pimienta de los códigos NO se puede rotar —invalidaría
  todos los códigos emitidos—.
- **Los certificados dependen de `CERTIFICATE_PRIVATE_KEY`**, que está solo en el
  servicio `learning` de Railway. Si se pierde, todo lo emitido deja de
  verificarse. Cada certificado lleva impresa la huella de su clave justamente
  para poder rotar sin invalidar lo viejo, pero eso exige **conservar la pública
  antigua**.
- **Ejecutar el sembrador en Railway tiene su procedimiento**, y está en
  [ENTORNO-DEMO.md](ENTORNO-DEMO.md) §5 con sus dos trampas: el comando previo al
  despliegue **no pasa por un intérprete** (encadenar con `&&` descarta el resto
  en silencio) y el código de institución se guarda **normalizado sin guiones**.
  Acuérdate de **borrar después las cuatro variables temporales**: la credencial
  de administrador de PostgreSQL no debe vivir en un servicio de aplicación.

La dirección visual está aprobada en `design/canvas/`, así que no hay que decidir
nada de diseño antes de codificar. **Y hay que abrir el artboard antes de tocar
una pantalla**: durante nueve sesiones solo se adoptó la paleta, y los cuatro
portales acabaron sin el marco del diseño.

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
