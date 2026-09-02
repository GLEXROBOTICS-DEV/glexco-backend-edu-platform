# CLAUDE.md — Guía para instancias de Claude que trabajen en este repositorio

Este archivo es el punto de entrada para cualquier instancia de Claude (u otro
agente) que retome el proyecto. Léelo entero antes de tocar código.

**Documentos hermanos, en orden de lectura recomendado:**

| Documento | Para qué sirve |
|---|---|
| [docs/BITACORA.md](docs/BITACORA.md) | **Empieza aquí.** Qué se hizo en cada sesión, por qué, y qué queda pendiente. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Las fases del proyecto y qué entra en cada una. |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones de arquitectura y su justificación. |
| [docs/ESCALABILIDAD.md](docs/ESCALABILIDAD.md) | Modelo de capacidad y estrategia de escalado. |
| [docs/DOMINIO.md](docs/DOMINIO.md) | Reglas de negocio: roles, kits, códigos, salones. |

---

## 1. Qué es este proyecto

Plataforma educativa **GLEXCO** para robótica educativa (kits UBTECH: uKit, uGoT,
Yanshee, Dobot, Cruzr, GO2, entre otros). Cuatro portales sobre un mismo backend:

- **GLEXCO Discover** — primaria (6–12 años). Lúdico, gamificado.
- **GLEXCO Academy** — secundaria, técnico, institutos y universidad. Sobrio.
- **GLEXCO Teacher Center** — docentes.
- **GLEXCO Admin** — personal interno de GLEXCO y administradores de institución.

La fuente de requisitos es la propuesta comercial en
`C:\Users\SValera\Downloads\PROPUESTA DE CONTENIDO PLATAFORMA ONLINE - REVISAR\`
(PDF de 15 páginas + 5 maquetas HTML). El texto extraído del PDF está resumido en
[docs/DOMINIO.md](docs/DOMINIO.md); no hace falta volver a abrirlo.

### El modelo de negocio, en un párrafo

La escuela (o la familia) compra **un libro por grado**, y cada libro corresponde
a un **kit** de robótica. Dentro del libro viene un **código de activación**. Al
registrarse, el alumno introduce ese código junto con su institución, su docente
y su salón. El código **caduca al canjearse** (un solo uso) y a partir de ahí el
alumno ve **únicamente el contenido de ese kit**. El docente ve cuántos alumnos
han activado en su salón. El registro por institución viene **marcado por
defecto**, pero el registro independiente debe funcionar igual de bien.

---

## 2. Estado actual

**Fase completada: 0 (cimientos).** Ver [docs/BITACORA.md](docs/BITACORA.md) para
el detalle y el pendiente exacto.

```
Plataforma-Glexco/
├── packages/            ✅ compilan los 5
│   ├── kernel/          Bloques DDD: AggregateRoot, ValueObject, DomainEvent, puertos
│   ├── contracts/       Roles, permisos, vocabulario, nombres de eventos, esquemas Zod
│   ├── config/          Validación de variables de entorno con Zod
│   ├── observability/   Logging estructurado (pino) + trazas (OpenTelemetry)
│   ├── nest-platform/   Adaptadores NestJS: Redis, Postgres, NATS, guards, bootstrap
│   └── tsconfig/        Configuraciones de TypeScript compartidas
├── services/            ⬜ vacíos (esqueleto de carpetas)
│   ├── api-gateway/  identity/  institutions/  catalog/  learning/
│   └── assessment/  engagement/  analytics/  media/
├── apps/web/            ⬜ vacío (Next.js pendiente)
├── infra/docker/        ✅ docker-compose + init SQL (schemas, roles, outbox)
└── docs/                ✅ documentación
```

---

## 3. Cómo trabajar aquí

### Comandos

```bash
pnpm install              # instalar (pnpm 11, NO npm ni yarn)
pnpm infra:up             # levantar Postgres, Redis, NATS, MinIO, Mailpit, Jaeger
pnpm infra:down           # bajar la infraestructura
pnpm infra:reset          # bajar BORRANDO volúmenes y volver a levantar
pnpm build                # compilar todo (Turborepo respeta el grafo de dependencias)
pnpm typecheck            # comprobación de tipos sin emitir
pnpm test                 # pruebas
pnpm --filter @glexco/kernel build     # compilar un paquete concreto
```

### Requisitos de entorno

- **Node ≥ 22** (probado en 24.18).
- **pnpm 11** — instalado con `npm i -g pnpm` (corepack falla por permisos en
  esta máquina: escribe en `C:\Program Files\nodejs`).
- **Docker Desktop** — ⚠️ **no está instalado todavía**. Sin él no hay Postgres,
  Redis, NATS ni MinIO locales. Es el primer bloqueo a resolver antes de poder
  ejecutar cualquier servicio.
- Los scripts de instalación están restringidos a una lista blanca en
  `pnpm-workspace.yaml` (`onlyBuiltDependencies`), como medida contra ataques de
  cadena de suministro. Si una dependencia nueva necesita `postinstall`, añádela
  ahí de forma explícita.

### Convenciones de código

- **Idioma:** comentarios, mensajes de error y documentación **en español**.
  Identificadores en inglés (`ClassroomId`, `redeemActivationCode`). Los textos
  visibles al usuario son claves de traducción, nunca literales.
- **Sin tildes en comentarios de código.** Es deliberado: evita problemas de
  codificación al pasar archivos por herramientas y shells en Windows. En los
  `.md` sí se usan tildes con normalidad.
- **Los comentarios explican POR QUÉ, no QUÉ.** Si un comentario parafrasea la
  línea siguiente, sobra. Si explica una decisión no obvia o un riesgo evitado,
  vale su peso en oro. Este repositorio ya sigue ese estilo: mantenlo.
- **Arquitectura hexagonal por servicio:**
  ```
  src/
  ├── domain/          Agregados, objetos de valor, eventos. CERO dependencias externas.
  ├── application/     Casos de uso. Dependen de puertos (interfaces), nunca de librerías.
  ├── infrastructure/  Adaptadores: Postgres, Redis, NATS, S3, SMTP.
  └── interface/       Controladores HTTP y consumidores de eventos.
  ```
  La regla que lo sostiene: **las dependencias apuntan hacia dentro**. `domain`
  no importa nada de `infrastructure`. Si necesitas romper esto, es señal de que
  falta un puerto.
- **Errores:** el dominio lanza `DomainError` (de `@glexco/kernel`), nunca
  `HttpException`. El `DomainExceptionFilter` traduce a códigos HTTP.
- **Validación:** esquemas Zod en `@glexco/contracts`, compartidos entre backend
  y frontend. El backend **siempre** revalida; la validación de cliente es
  comodidad, no seguridad.

### Al añadir un microservicio nuevo

1. Crea `services/<nombre>/` con la estructura hexagonal de arriba.
2. Añade su schema y su rol en `infra/docker/postgres/init/01-schemas.sql`, y su
   entrada en el bucle de `02-outbox-template.sql`.
3. Añade su `DATABASE_URL_<NOMBRE>` y su puerto a `.env.example`.
4. Usa `bootstrapService()` de `@glexco/nest-platform`: trae apagado ordenado,
   cabeceras de seguridad, CORS y filtro de errores.
5. Registra el `HealthController` y arranca el `OutboxRelay` si publica eventos.

---

## 4. Invariantes que NO se pueden romper

Estas reglas existen por una razón concreta. Si una tarea parece exigir saltarse
alguna, para y pregunta antes de continuar.

1. **Aislamiento entre instituciones.** Un usuario nunca puede ver datos de otra
   institución. El guard de permisos comprueba *qué clase de operación* puede
   hacer; el caso de uso comprueba *sobre qué recurso concreto*. Ambas cosas son
   necesarias. Aquí hay datos de menores de edad: una fuga es un incidente grave,
   no un bug.

2. **Los códigos de activación son de un solo uso.** El canje va dentro de una
   transacción con bloqueo de fila (`SELECT ... FOR UPDATE`). Sin eso, dos
   peticiones simultáneas con el mismo código otorgan dos accesos.

3. **Eventos siempre por outbox.** Nunca publiques a NATS directamente desde un
   caso de uso. Usa `tx.enqueue(event)` dentro de la unidad de trabajo.

4. **Nada de estado en memoria del proceso.** Sesiones, cachés, contadores de
   límite y cerrojos van a Redis. Con N réplicas detrás de un balanceador, el
   estado local es incorrecto por definición.

5. **Las contraseñas se hashean con Argon2id** (bcrypt disponible por
   compatibilidad). Nunca en texto plano, nunca con SHA-*, nunca en los logs — la
   redacción de campos sensibles ya está configurada en `@glexco/observability`.

6. **Los buckets son privados.** El contenido se sirve con URLs prefirmadas de
   vida corta. Nunca hagas público un bucket "para que funcione".

7. **Toda lectura pesada va al pool de réplicas** (`DB_READ_POOL`); las
   escrituras y las lecturas que deben ver su propia escritura, al de escritura
   (`DB_WRITE_POOL`). Ver [docs/ESCALABILIDAD.md](docs/ESCALABILIDAD.md).

---

## 5. Errores conocidos del entorno (ya resueltos, no repetir)

- **Heredocs de Bash con TypeScript grande fallan** en este entorno Windows: se
  corrompen las comillas y los escapes. Escribe los archivos con la herramienta
  de escritura, o con Python usando `io.open(..., newline='\n')`.
- **Nunca escribas caracteres de control literales en expresiones regulares.**
  Se corrompen al pasar por el shell. Usa una función que recorra puntos de
  código (ver `hasForbiddenControlChars` en `packages/contracts/src/schemas/common.ts`).
- **`@opentelemetry/resources` 1.30 no exporta `resourceFromAttributes`** (eso es
  de la 2.x). Se usa `new Resource({...})` con claves de atributo literales.
- **`declare private` en una clase que se devuelve desde una función** produce
  TS4094. La marca de tipo de `Identifier` es `declare readonly`, sin `private`.
- **pnpm 11 ignora el campo `pnpm` de `package.json`**: `onlyBuiltDependencies`
  va en `pnpm-workspace.yaml`.

---

## 6. Decisiones ya tomadas por el cliente (no volver a preguntar)

| Tema | Decisión |
|---|---|
| Almacenamiento de contenido | **Híbrido**: videos largos en proveedor externo privado con restricción de dominio; PDFs, PPTs y fichas en almacenamiento de objetos propio con URLs prefirmadas. |
| Mensajería profesor↔alumno | **Anuncios asíncronos**, sin WebSockets. Modelo agnóstico al transporte para poder añadir tiempo real después. |
| Persistencia | **Un PostgreSQL, un schema y un rol por servicio.** Migrable a base por servicio cambiando la `DATABASE_URL`. |
| Alcance | **Toda la propuesta**, por fases, documentando cada sesión en `docs/BITACORA.md`. |
| Escala objetivo | Diseñar para ~8M registrados. Ver [docs/ESCALABILIDAD.md](docs/ESCALABILIDAD.md). |
| Diseño visual | Canvas de **Claude Design** aprobado por el cliente antes de codificar componentes. Iconografía propia (`@glexco/icons`) + Lucide para el cromo de interfaz. |
| Despliegue | Railway primero; después AWS o Huawei Cloud. Todo debe quedar listo para balanceador y escalado horizontal desde el principio. |

---

## 7. Cómo cerrar una sesión de trabajo

Antes de terminar, **actualiza [docs/BITACORA.md](docs/BITACORA.md)** con una
entrada nueva que responda a tres preguntas:

1. **Qué se hizo** — archivos y capacidades, no una lista de commits.
2. **Por qué** — las decisiones no obvias y las alternativas descartadas.
3. **Qué falta** — el siguiente paso concreto, y cualquier bloqueo pendiente.

Si tomaste una decisión de arquitectura, añádela también a
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
