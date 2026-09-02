# Escalabilidad y modelo de capacidad

> Este documento responde a un requisito explícito del cliente: la plataforma
> debe poder crecer hasta ~8 millones de usuarios registrados sin caerse, y estar
> lista desde el principio para balanceadores, escalado horizontal y migración
> de Railway a AWS o Huawei Cloud.

---

## 1. Lo primero: "8 millones" no es un requisito de infraestructura

El número de registrados no dimensiona nada por sí solo. Lo que dimensiona es:

| Magnitud | Por qué importa |
|---|---|
| **Concurrentes en hora punta** | Determina el número de instancias y el tamaño del pool de conexiones. |
| **Peticiones por segundo** | Determina el ancho del balanceador y la capacidad de cómputo. |
| **Mezcla de operaciones** | 10.000 lecturas cacheables y 10.000 escrituras son problemas radicalmente distintos. |
| **Bytes por petición** | El video domina la factura de tráfico; el JSON es ruido a su lado. |

Una plataforma con 8M registrados y 20.000 concurrentes es sencilla. La misma con
800.000 concurrentes durante un lanzamiento es otra arquitectura.

### El perfil concreto de GLEXCO

Este producto tiene una forma de carga muy particular, y aprovecharla es lo que
hace la diferencia entre un sistema caro y uno barato:

1. **La concurrencia es predecible y con picos brutales.** El tráfico se
   concentra en horario escolar (08:00–14:00, zona horaria de Perú) y explota al
   inicio de la clase de robótica: 30 alumnos de un salón abren el mismo video
   **en el mismo minuto**. En vacaciones, el tráfico se desploma.
   → *Consecuencia:* el autoescalado debe ser **por calendario además de por
   métrica**. Reaccionar a la CPU llega tarde cuando el pico dura 90 segundos.

2. **La lectura domina de forma abrumadora.** Ver un video, abrir un PDF, listar
   lecciones. Las escrituras son escasas: marcar progreso, enviar una evaluación,
   publicar un anuncio.
   → *Consecuencia:* réplicas de lectura y caché resuelven la mayor parte.

3. **El contenido base es idéntico para todos y cambia poquísimo.** El video de
   armado del uKit AI es el mismo para los 8 millones y se edita quizá una vez al
   trimestre.
   → *Consecuencia:* es contenido **perfecto para CDN**, con caducidad larga e
   invalidación por etiqueta al publicar. Este es el mayor ahorro disponible.

4. **Los datos están naturalmente particionados por institución.** Ningún alumno
   consulta jamás datos de otro colegio.
   → *Consecuencia:* si algún día hace falta sharding, la clave de partición es
   obvia (`institution_id`) y ya está presente en el modelo desde hoy.

---

## 2. Modelo numérico de referencia

Partiendo del ejemplo del cliente, y ajustándolo al perfil real de uso:

```
Registrados                                    8.000.000
Concurrentes en hora punta (5 %)                 400.000
Peticiones por usuario activo             1 cada 10 seg
──────────────────────────────────────────────────────────
Peticiones entrantes                        40.000 req/s
Objetivo de diseño (margen 2,5-3x)      100.000-120.000 req/s
```

Diseñar para 40.000 exactos es diseñar para caerse el día del lanzamiento. El
margen no es lujo: absorbe el pico de inicio de clase, el reintento en cascada
tras un incidente y el crecimiento del trimestre siguiente.

### Cómo se reparte esa carga

El punto clave: **120.000 req/s en el borde no son 120.000 consultas/s a
PostgreSQL**. Cada capa absorbe una porción, y la base solo ve el residuo.

```
                      120.000 req/s entrantes
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   CDN / borde             Caché Redis              Backend
   ~60.000 (50 %)          ~30.000 (25 %)          ~30.000 (25 %)
   videos, PDF,            catálogo, perfiles,            │
   JS, CSS, imágenes       permisos, salones              │
                                                          │
                        ┌─────────────────┬───────────────┴──┬──────────────┐
                        ▼                 ▼                  ▼              ▼
                  15.000 sin BD     10.000 lecturas    3.000 escrituras  2.000 async
                  (token, validación) → réplicas       → primario        → colas
```

**PostgreSQL solo ve 13.000 operaciones/s**, de las cuales apenas 3.000 son
escrituras. Eso sí es alcanzable con un primario bien dimensionado y tres
réplicas de lectura. Sin las dos primeras capas, las mismas 120.000 req/s
matarían cualquier base de datos del mercado.

**Corolario operativo:** cada punto porcentual que se le quita al CDN o a Redis
se lo come la base de datos, que es lo caro y lo difícil de escalar. Por eso la
estrategia de caché no es una optimización posterior: es parte del diseño.

---

## 3. Arquitectura de despliegue objetivo

```
                              Usuarios
                                 │
                                 ▼
                        DNS (latencia / geo)
                                 │
                                 ▼
              ┌──────────────────────────────────────┐
              │      CDN + WAF + protección DDoS     │
              │  estáticos, video, imágenes, JS/CSS  │
              └──────────────────────────────────────┘
                                 │  (solo lo no cacheable)
                                 ▼
                    Balanceador de carga (L7, multi-AZ)
                                 │
        ┌──────────┬─────────────┼─────────────┬──────────┐
        ▼          ▼             ▼             ▼          ▼
    Gateway    Gateway       Gateway       Gateway    Gateway     ← sin estado, autoescalado
        │          │             │             │          │
        └──────────┴──────┬──────┴─────────────┴──────────┘
                          ▼
     ┌────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
     ▼        ▼          ▼          ▼          ▼          ▼          ▼
  identity institutions catalog  learning  assessment engagement  media   ← microservicios
     │        │          │          │          │          │          │
     └────────┴──────────┴────┬─────┴──────────┴──────────┴──────────┘
                              │
        ┌─────────────────────┼─────────────────────┬──────────────────┐
        ▼                     ▼                     ▼                  ▼
  Redis (cluster)      NATS JetStream        PostgreSQL          Object storage
  caché, sesiones,     eventos de dominio    ├─ Primario         S3 / OBS
  rate limit, locks,           │             ├─ Réplica lectura  (privado,
  colas BullMQ                 ▼             └─ Réplica lectura   URL firmada)
                           Workers
                    correo, certificados,
                    reportes, miniaturas
```

### Correspondencia con lo que ya está implementado

| Requisito de la arquitectura | Dónde vive hoy en el repositorio |
|---|---|
| Backend sin estado | Sesiones y cachés en Redis; nada en memoria del proceso. `packages/nest-platform/src/redis/` |
| Réplicas de lectura | `DB_READ_POOL` / `DB_WRITE_POOL` separados desde el día uno. `database.provider.ts` |
| Caché con invalidación | `RedisCacheStore` con etiquetas y anti-estampida. `redis-cache.store.ts` |
| Rate limiting distribuido | Ventana deslizante en Lua, atómica. `rate-limiter.ts` |
| Circuit breakers | `CircuitBreaker` con estados cerrado/abierto/semiabierto. `resilience/circuit-breaker.ts` |
| Colas / trabajo asíncrono | NATS JetStream + outbox transaccional. `messaging/` |
| Despliegue sin caída | Apagado ordenado con drenaje. `bootstrap.ts` |
| Health checks diferenciados | `/health/live`, `/health/ready`, `/health/startup`. `health/health.controller.ts` |
| Observabilidad | Logs JSON con correlación + trazas OTLP. `packages/observability/` |
| Object storage | Puerto `ObjectStorage` con URLs prefirmadas. `packages/kernel/src/application/ports.ts` |
| Multi-AZ / sharding | *Pendiente de despliegue.* El modelo ya lleva `institution_id` como clave natural de partición. |

---

## 4. Estrategia de caché por capas

La regla es sencilla: **cuanto más lejos del usuario se resuelve una petición,
más cara es**. Cada capa debe absorber todo lo que legítimamente pueda.

| Capa | Qué guarda | TTL | Cómo se invalida |
|---|---|---|---|
| **CDN** | Video, PDF, PPT, imágenes, JS, CSS | 1 año, con hash en el nombre | El nombre cambia al republicar |
| **CDN (API pública)** | Catálogo de kits y cursos publicados | 5 min + `stale-while-revalidate` | Purga por etiqueta al publicar |
| **Redis** | Árbol de curso, permisos, ficha de institución, listas de salón | 5–60 min | Etiqueta (`course:<id>`, `institution:<id>`) |
| **Redis (sesión)** | Familias de refresh token, revocaciones | Vida del token | Explícita al cerrar sesión |
| **Navegador** | Bundle, fuentes, iconos | 1 año inmutable | Hash en el nombre |
| **HTTP condicional** | Respuestas de listado | ETag | `304 Not Modified` |

`stale-while-revalidate` merece una mención: permite servir contenido ligeramente
antiguo mientras se refresca por detrás. Para un catálogo de cursos, que un
usuario vea el estado de hace 30 segundos es irrelevante; que espere 800 ms
porque la caché acaba de caducar, no.

---

## 5. La base de datos es el cuello de botella

Añadir 50 instancias de API es trivial. Escalar escrituras no lo es. Por eso el
diseño ataca el problema desde el principio:

**Ya implementado o decidido:**

- **Separación lectura/escritura** desde el primer día. El código que se escribe
  hoy ya es el correcto cuando existan tres réplicas.
- **Pool acotado por instancia** (`DB_POOL_MAX=10`). Con 8 servicios × 6 réplicas
  son 480 conexiones: por encima de lo que aguanta un Postgres gestionado medio.
  Cuando las réplicas crezcan, la respuesta es **PgBouncer en modo transaction**,
  no subir el número.
- **`statement_timeout`** de 15 s y `idle_in_transaction_session_timeout` de 30 s.
  Una consulta descontrolada no puede agotar el pool y arrastrar al servicio.
- **Índices parciales** donde importa. La outbox indexa solo lo pendiente: la
  consulta del relay toca decenas de filas aunque la tabla tenga millones.
- **Concurrencia optimista** por versión de agregado, en vez de bloqueos largos.
- **Ids generados en el dominio** (UUID), no secuencias: sin punto de contención
  central al escribir desde varias réplicas.

**Pendiente, cuando el volumen lo pida:**

- **Particionado por rango** de `learning.progress_events` y de las tablas de
  analítica. Son las que crecen sin límite: si cada alumno genera 20 eventos de
  progreso al día, 8M de alumnos son 160M de filas diarias. Partición mensual,
  con desprendimiento y archivado de las particiones antiguas.
- **Réplica dedicada para analítica**, para que un reporte pesado del equipo
  comercial no compita con el alumno que intenta abrir su lección.
- **Sharding por `institution_id`** solo si el primario deja de dar abasto. Es la
  última carta, no la primera: añade complejidad enorme.

**Reglas de oro para cualquiera que escriba consultas aquí:**

1. Nada de N+1. Si un listado hace una consulta por elemento, está mal.
2. Toda consulta de listado necesita índice **y** paginación por cursor. `OFFSET`
   está prohibido: se degrada con la profundidad y duplica filas si alguien
   inserta mientras el usuario navega.
3. Ninguna consulta sin límite superior de filas.
4. `EXPLAIN ANALYZE` antes de dar por buena una consulta nueva sobre tabla grande.

---

## 6. Resiliencia

| Mecanismo | Qué evita | Dónde |
|---|---|---|
| **Circuit breaker** | Que un servicio lento agote los sockets del gateway y tumbe la plataforma entera (fallo en cascada). | `circuit-breaker.ts` |
| **Rate limiting** | Que un bot, un script mal hecho o un usuario abusivo consuma la capacidad de todos. | `rate-limiter.ts` |
| **Timeouts en todo** | Que una llamada colgada bloquee un worker indefinidamente. | `bootstrap.ts`, breaker, pools |
| **Backoff con jitter** | Que N réplicas reintenten sincronizadas y rematen al servicio que se recupera. | Outbox relay, unidad de trabajo, NATS |
| **Outbox transaccional** | Perder eventos cuando el proceso muere entre guardar y publicar. | `unit-of-work.ts` + `outbox-relay.ts` |
| **Idempotencia de consumidores** | Efectos duplicados por la entrega at-least-once de JetStream. | Tabla `processed_events` |
| **Apagado ordenado** | Los 502 clásicos de cada despliegue. | `bootstrap.ts` |
| **Degradación elegante** | Que una caída de Redis se convierta en caída total: el rate limiter falla-abierto y la caché cae a la base. | `redis-cache.store.ts`, `rate-limiter.ts` |

Sobre el **fail-open del rate limiter**: es una decisión consciente. Si Redis cae
y bloqueamos todo el tráfico, convertimos una degradación de caché en una caída
completa. Los límites duros de verdad (WAF y balanceador) siguen delante.

---

## 7. Plan de crecimiento por etapas

No hay que construir la arquitectura de 8M el primer día. Hay que construirla de
forma que **crecer no exija reescribir**.

| Etapa | Usuarios | Infraestructura | Cambio necesario en el código |
|---|---|---|---|
| **1. Railway (hoy)** | < 50k | 1 réplica por servicio, 1 Postgres, 1 Redis, 1 NATS | Ninguno |
| **2. Railway escalado** | < 500k | 3–5 réplicas, Postgres con réplica de lectura, CDN delante | Ninguno: apuntar `READ_URLS` a la réplica |
| **3. Cloud gestionado** | < 3M | Kubernetes multi-AZ, Redis en cluster, RDS/RDS-equivalente con 2–3 réplicas, autoescalado | Manifiestos de despliegue; el código no cambia |
| **4. Escala completa** | 8M+ | Multi-región, PgBouncer, particionado de tablas grandes, réplica analítica dedicada | Migraciones de particionado; consultas ya compatibles |

El objetivo de diseño es que **entre la etapa 1 y la 3 no haya que tocar lógica
de negocio**, solo configuración y despliegue. Eso es lo que se está pagando hoy
con la separación de pools, el estado fuera del proceso y los puertos hexagonales.

---

## 8. Pruebas de carga

**Pendiente de implementar** (Fase 8). Plan:

- **k6** en `infra/loadtest/`, escenarios versionados junto al código.
- Escenarios que reflejen el uso real, no tráfico sintético uniforme:
  - *Inicio de clase*: 30 alumnos del mismo salón abriendo el mismo video en 60 s.
  - *Inicio de jornada*: 200.000 inicios de sesión en 15 minutos.
  - *Cierre de trimestre*: envío masivo de evaluaciones y emisión de certificados.
  - *Campaña de registro*: 50.000 canjes de código de activación en una hora.
- Umbral de aceptación: p95 < 300 ms en lecturas, p95 < 800 ms en escrituras,
  con **2–3× el tráfico esperado** y tasa de error < 0,1 %.
- Ejecución obligatoria antes de cada despliegue mayor a producción.
