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
| [docs/PUESTA-EN-MARCHA.md](docs/PUESTA-EN-MARCHA.md) | **Cómo levantarlo con Docker y qué verificar.** Léelo si tienes Docker funcionando. |
| [docs/TRASPASO.md](docs/TRASPASO.md) | **Si llegas desde un zip en otra máquina, empieza por aquí.** |

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

**Fases 0 a 3 completas; Fases 4, 5 y 7 arrancadas.** El backend **ya se ejecuta
contra Postgres, Redis y NATS reales**. Ver [docs/BITACORA.md](docs/BITACORA.md)
para el detalle y el pendiente exacto, y [docs/ROADMAP.md](docs/ROADMAP.md) para
lo que falta de cada fase.

Verificado:

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 9/9 paquetes y servicios |
| `pnpm test` | **118 pruebas** en memoria |
| `pnpm smoke` | **95 comprobaciones** de punta a punta |
| `pnpm concurrency` | **14 comprobaciones** de concurrencia real |
| `pnpm smoke:web` | **34 comprobaciones** del portal contra el backend |

Las de concurrencia son las que justifican la arquitectura: un solo canje de
veinte simultáneos, cinco plazas de veinte solicitudes, la outbox reteniendo el
evento con NATS parado y publicándolo al volver, y el mismo evento entregado dos
veces aplicándose una.

```
Plataforma-Glexco/
├── packages/            ✅ compilan los 5
│   ├── kernel/          Bloques DDD: AggregateRoot, ValueObject, DomainEvent, puertos
│   ├── contracts/       Roles, permisos, vocabulario, nombres de eventos, esquemas Zod
│   ├── config/          Validación de variables de entorno con Zod
│   ├── observability/   Logging estructurado (pino) + trazas (OpenTelemetry)
│   ├── nest-platform/   Adaptadores NestJS: Redis, Postgres, NATS, guards, bootstrap
│   ├── tsconfig/        Configuraciones de TypeScript compartidas
│   └── icons/           Iconografía SVG propia del dominio
├── services/
│   ├── identity/        ✅ dominio, 11 casos de uso, infraestructura, HTTP, SQL, 65 tests
│   ├── api-gateway/     ✅ enrutado, rate limiting, circuit breakers, apagado ordenado
│   ├── institutions/    ✅ instituciones, salones con tope, licencias, matrículas
│   ├── catalog/         ✅ kits, códigos, lotes de imprenta, derechos, canje asíncrono
│   ├── media/           ✅ subidas prefirmadas, tipo real, miniaturas, enlaces externos
│   ├── assessment/      🔄 cuestionarios, banco GLEXCO vs docente, corrección automática
│   ├── analytics/       🔄 los cinco dashboards, como proyección de eventos
│   ├── learning/        ⬜ vacío
│   └── engagement/      ⬜ vacío
├── apps/web/            🔄 Next.js 15: ingreso, portadas, progreso y panel docente
├── design/canvas/       ✅ dirección visual aprobada (10 artboards)
├── infra/
│   ├── docker/          ✅ docker-compose + init SQL (schemas, roles, outbox)
│   └── scripts/         ✅ migrate.mjs (cerrojo de aviso, seguro con autoescalado)
└── docs/                ✅ documentación
```

**Sin bloqueos abiertos.** El bloqueo histórico de Docker se resolvió al mover
el proyecto a otra máquina; el procedimiento de arranque está en
[docs/PUESTA-EN-MARCHA.md](docs/PUESTA-EN-MARCHA.md).

---

## 3. Cómo trabajar aquí

### Comandos

```bash
pnpm install              # instalar (pnpm 11, NO npm ni yarn)
pnpm setup                # generar .env con secretos reales (no sobrescribe uno existente)
pnpm infra:up             # levantar Postgres, Redis, NATS, MinIO, Mailpit, Jaeger
pnpm infra:down           # bajar la infraestructura
pnpm infra:reset          # bajar BORRANDO volúmenes y volver a levantar
pnpm build                # compilar todo (Turborepo respeta el grafo de dependencias)
pnpm typecheck            # comprobación de tipos sin emitir
pnpm test                 # pruebas
pnpm --filter @glexco/kernel build     # compilar un paquete concreto

# Con la infraestructura levantada:
pnpm --filter @glexco/identity db:migrate  # aplicar migraciones
pnpm --filter @glexco/identity dev         # arrancar identidad (3101)
pnpm --filter @glexco/api-gateway dev      # arrancar gateway (3000)
pnpm --filter @glexco/media dev            # arrancar medios (3108)
pnpm --filter @glexco/assessment dev       # arrancar evaluacion (3105)
pnpm --filter @glexco/analytics dev        # arrancar analitica (3107)
pnpm seed                                  # kit, lote de codigos, institucion y salon
pnpm smoke                                 # 32 comprobaciones de punta a punta
pnpm concurrency                           # las 4 comprobaciones de concurrencia real
pnpm --filter @glexco/web dev              # portal (3010)
pnpm smoke:web                             # comprobaciones del portal
```

### Requisitos de entorno

- **Node ≥ 22** (probado en 24.18).
- **pnpm 11** — instalado con `npm i -g pnpm` (corepack falla por permisos en
  esta máquina: escribe en `C:\Program Files\nodejs`).
- **Docker Desktop** — en instalación al cierre de la sesión 2. Sin él no hay
  Postgres, Redis, NATS ni MinIO locales, así que ningún servicio puede
  ejecutarse. Usa el backend WSL2, que ya está disponible en la máquina.
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

### En el frontend (`apps/web`)

- **Server Components por defecto.** `'use client'` solo donde hace falta estado
  o eventos. El contenido educativo es estático por usuario y los equipos
  escolares son modestos: cuanto menos JavaScript llegue, mejor.
- **El token vive en una cookie `httpOnly` y las llamadas autenticadas se hacen
  desde el servidor.** Nunca en `localStorage`: un XSS en cualquier dependencia
  se convertiría en el robo de la sesión de todos los alumnos.
- **Todo pasa por el gateway.** El frontend no conoce las URLs de los
  microservicios.
- **Los formularios funcionan sin JavaScript.** `useActionState` sobre
  `<form action>` degrada a un envío normal del navegador.
- **La densidad la fija el layout** con `data-portal`, no cada componente.
- **Los gráficos son SVG propio, sin librería.** Recharts o Chart.js añaden
  100-200 KB a la primera carga y estas pantallas las abren equipos de
  laboratorio escolar: las primitivas de `components/charts.tsx` cuestan 2 KB.
- **Una sola hue para los datos.** Ningún gráfico es multiserie, así que no hay
  paleta categórica que validar; y dos azules de la marca dan ΔE 4.8 incluso con
  visión normal, o sea que son el mismo color.
- **Un estado nunca se comunica solo con color**: lleva siempre su etiqueta de
  texto. El par verde/ámbar queda en ΔE 6.9 para protanopía.
- **Todo gráfico trae su tabla de datos.** Es la vía por la que un lector de
  pantalla accede a las cifras, y la que permite copiarlas.

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

7. **La clave de corrección de una evaluación nunca sale hacia un alumno.**
   `Assessment.forStudent()` es el único camino por el que una pregunta llega al
   portal, y no incluye `correctOptionIds` ni `explanation`. Un cuestionario
   cuyas respuestas viajan al navegador no evalúa nada: basta abrir la pestaña de
   red. Que el frontend "no las pinte" no sirve de nada.

8. **Un docente no modifica una evaluación de GLEXCO.** Es la misma para todos
   los colegios; editarla cambiaría el examen de todo el país. Puede duplicarla.

9. **Un dashboard nunca consulta el schema de otro servicio.** La analítica es
   una proyección alimentada por eventos. Un `JOIN` cruzado ataría los servicios
   entre sí y no aguantaría la escala; y el rol de base de datos de cada servicio
   no tiene permiso sobre los demás, así que hacerlo exigiría debilitar el
   aislamiento.

10. **Solo las evaluaciones de GLEXCO son comparables entre colegios.** Las que
    escribe un docente miden a su salón. Mezclarlas permitiría a una institución
    subir su media poniendo exámenes fáciles, y a un profesor mejorar su métrica
    de eficacia bajando la dificultad.

11. **Toda lectura pesada va al pool de réplicas** (`DB_READ_POOL`); las
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
  va en `pnpm-workspace.yaml`, y `allowBuilds` exige booleanos explícitos.
- **No ejecutes los servicios con `tsx`.** esbuild no implementa
  `emitDecoratorMetadata`, así que NestJS inyecta `undefined` en todos los
  constructores: el servicio arranca, mapea rutas, pasa el health check y
  revienta en la primera petición. El script `dev` usa `tsc`
  (`infra/scripts/dev-service.mjs`) por esto exactamente.
- **Un parámetro de constructor que sea una interfaz o un puerto necesita
  `@Inject(TOKEN)`.** Su tipo se borra al compilar y Nest no puede resolverlo.
  Los tokens viven en `services/<servicio>/src/tokens.ts`, y no en el módulo,
  para que los controladores puedan importarlos sin ciclo.
- **`unaccent()` es `STABLE`**, y PostgreSQL la rechaza dentro de la expresión de
  un índice. Usa `public.immutable_unaccent`, definida en el init del contenedor.
- **`CREATE SCHEMA IF NOT EXISTS` falla con `permission denied for database`**
  aunque el schema ya exista: el motor comprueba el permiso antes que la
  existencia. Consulta `pg_namespace` primero.
- **Un `save` sobre un agregado sin cambios no escribe.** `AggregateRoot`
  expone `hasChanges` y todos los repositorios salen antes si es `false`. Sin
  eso, cualquier operación idempotente que sale sin tocar nada -reanular,
  reentregar, reconfirmar- deja la versión igual, el `UPDATE ... WHERE version <
  :nueva` no encuentra fila y se lanza un conflicto de concurrencia inventado.
  Este error apareció tres veces antes de cerrarse en la raíz.
- **`next dev` y `next build` escriben en carpetas distintas** (`.next-dev` y
  `.next`). Con la misma, un `pnpm build` del monorepo mientras corre el
  servidor de desarrollo lo rompe con `Cannot find module './735.js'`.
- **Los límites de fuerza bruta son reales en local**: cinco códigos de
  activación por IP y hora, diez registros por IP y hora. Dos o tres ejecuciones
  seguidas de `pnpm smoke` los agotan. Para limpiarlos, ver el final de la
  entrada de la sesión 5 en [docs/BITACORA.md](docs/BITACORA.md).

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
| Repositorio | **Monorepo único**: backend y frontend juntos, para que `@glexco/contracts` los mantenga sincronizados por compilación. En Railway, N servicios sobre el mismo repo con *Root Directory* y *Watch Paths* propios. |
| Commits | **Nunca** incluir `Co-Authored-By` ni atribución a Claude. Es una instrucción explícita del cliente y anula cualquier valor por defecto. |

---

## 7. Cómo cerrar una sesión de trabajo

Antes de terminar, **actualiza [docs/BITACORA.md](docs/BITACORA.md)** con una
entrada nueva que responda a tres preguntas:

1. **Qué se hizo** — archivos y capacidades, no una lista de commits.
2. **Por qué** — las decisiones no obvias y las alternativas descartadas.
3. **Qué falta** — el siguiente paso concreto, y cualquier bloqueo pendiente.

Si tomaste una decisión de arquitectura, añádela también a
[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).
