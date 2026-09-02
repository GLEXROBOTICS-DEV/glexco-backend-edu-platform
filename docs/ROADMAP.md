# Roadmap por fases

Estado de cada fase. La bitácora de lo realmente ejecutado está en
[BITACORA.md](BITACORA.md).

Leyenda: ✅ completada · 🔄 en curso · ⬜ pendiente

---

## ✅ Fase 0 — Cimientos

Todo lo que el resto del proyecto da por hecho.

- [x] Monorepo pnpm + Turborepo, TypeScript estricto.
- [x] `@glexco/kernel` — bloques DDD: `AggregateRoot`, `ValueObject`,
      `DomainEvent`, `Identifier` tipado, jerarquía de errores, puertos
      hexagonales (`CacheStore`, `UnitOfWork`, `PasswordHasher`, `ObjectStorage`,
      `EventPublisher`, `DistributedLock`, `Mailer`, `Clock`).
- [x] `@glexco/contracts` — roles y permisos con ámbito, matriz de creación de
      roles, vocabulario de dominio, catálogo de eventos, esquemas Zod.
- [x] `@glexco/config` — validación de entorno que aborta el arranque si falta
      una variable, con comprobaciones extra de seguridad en producción.
- [x] `@glexco/observability` — logs JSON con correlación y redacción de campos
      sensibles; trazas OpenTelemetry.
- [x] `@glexco/nest-platform` — filtro de errores de dominio, middleware de
      correlación, pipe de validación Zod, guards de JWT y permisos, caché Redis
      con etiquetas y anti-estampida, cerrojo distribuido, rate limiter en Lua,
      pools de escritura/lectura, unidad de trabajo con outbox, cliente NATS
      JetStream, relay de outbox, circuit breaker, health checks, bootstrap con
      apagado ordenado.
- [x] Infraestructura local: Postgres 16, Redis 7, NATS JetStream, MinIO,
      Mailpit, Jaeger. Schemas y roles por servicio, tablas `outbox` y
      `processed_events`.
- [x] Documentación base.

---

## ✅ Fase 1 — Identidad y acceso

El servicio del que dependen todos los demás.

**Hecho:**

- [x] `identity-service`: agregado `User` con todas sus invariantes, objetos de
      valor (`Email`, `PersonName`, `BirthDate`, `PasswordHash`, `LocalePreference`)
      y catálogo de eventos de dominio.
- [x] Registro de alumno (institucional e independiente) con código de libro,
      con el orden de validaciones pensado para no gastar CPU en peticiones basura.
- [x] Argon2id con `PasswordHasher` intercambiable, soporte bcrypt para migración
      y rehash transparente al iniciar sesión.
- [x] JWT: access corto con permisos resueltos + refresh rotativo en cookie
      httpOnly, con detección de reutilización de familia de tokens y ventana de
      gracia para la carrera entre pestañas.
- [x] Verificación de correo y recuperación de contraseña (solicitud y confirmación).
- [x] Consentimiento de apoderado para menores de 14, exigido en el dominio **y**
      con restricción `CHECK` en la base.
- [x] Bloqueo progresivo de cuenta + rate limiting por IP y por cuenta.
- [x] Resistencia a enumeración de usuarios: mensaje único y hash señuelo.
- [x] Registro de auditoría con escritura en lote diferida.
- [x] Esquema SQL con índices parciales, `citext` y concurrencia optimista.
- [x] Ejecutor de migraciones con cerrojo de aviso (seguro con autoescalado).
- [x] 44 pruebas en memoria (dominio + casos de uso), sin Docker, en ~30 ms.

- [x] Cambio de contraseña autenticado, exigiendo la contraseña actual.
- [x] Alta de personal por HTTP con triple control: permiso, matriz de roles y
      **ámbito de institución** (un admin del colegio A no puede crear docentes
      en el colegio B).
- [x] Gestión de sesiones activas ("cerrar sesión en otros dispositivos").
- [x] `api-gateway`: tabla de enrutado explícita, correlación, rate limiting en
      el borde, circuit breaker por servicio y apagado ordenado.
- [x] `pnpm setup` genera `.env` con secretos criptográficos reales.
- [x] `pnpm smoke` verifica 22 comprobaciones de punta a punta contra los
      servicios en ejecución.
- [x] **65 pruebas** en memoria, sin Docker, en ~60 ms.

**Pendiente para dar la fase por cerrada del todo:**

- [ ] Ejecutar la prueba de humo con la infraestructura levantada (bloqueado por
      Docker; WSL pendiente de instalar).
- [ ] Pruebas de integración con Postgres y Redis reales.
- [ ] Envío real de correos (depende del servicio `engagement`, Fase 7). Hoy se
      emite el token y el evento; falta quien los consuma.

## ⬜ Fase 2 — Instituciones, salones y licencias

- [ ] `institutions-service`: `Institution`, `Classroom`, `Enrollment`, `License`.
- [ ] Alta de institución y de su administrador (solo GLEXCO).
- [ ] Alta de docentes (GLEXCO y administrador de institución).
- [ ] Salones con tope de plazas y control de cupo transaccional.
- [ ] Búsqueda pública de institución y salón para el formulario de registro.
- [ ] Licencias, vencimientos y alertas.

## ⬜ Fase 3 — Catálogo, kits y códigos de activación

- [ ] `catalog-service`: `Kit`, `Book`, `ActivationCode`, `Course`, `Module`,
      `Lesson`, `ContentAsset`, `LearningPath`, `Entitlement`.
- [ ] Generación de lotes de códigos y exportación para imprenta.
- [ ] Canje de un solo uso con bloqueo de fila.
- [ ] Motor de derechos de acceso: el alumno ve solo el contenido de su kit.
- [ ] `media-service`: subida con URL prefirmada, validación de tipo real,
      miniaturas, proveedor de video.
- [ ] Caché de catálogo con invalidación por etiqueta al publicar.

## ⬜ Fase 4 — Portales de alumno (Discover y Academy)

- [ ] **Canvas de Claude Design aprobado** antes de codificar.
- [ ] `@glexco/icons`: iconografía SVG propia (robots, insignias, niveles).
- [ ] `apps/web` en Next.js 15: App Router, RSC, i18n es/en, skeletons.
- [ ] Discover: inicio, laboratorio de robots, mis cursos, zona de retos,
      biblioteca multimedia, mis logros, mi perfil.
- [ ] Academy: inicio, laboratorio por niveles, cursos, proyectos y desafíos,
      biblioteca, certificaciones, portafolio, perfil.
- [ ] Accesibilidad WCAG 2.1 AA y navegación completa por teclado.

## ⬜ Fase 5 — Teacher Center y evaluación

- [ ] `assessment-service`: `Assessment`, `Question`, `Rubric`, `Submission`,
      `Grade`.
- [ ] Banco de evaluaciones, rúbricas, calificación automática y manual.
- [ ] Evidencias (foto/video) del alumno.
- [ ] Portal docente: panel, gestión de cursos y estudiantes, centro de
      evaluación, recursos pedagógicos, capacitación docente.

## ⬜ Fase 6 — Progreso, gamificación y certificados

- [ ] `learning-service`: progreso por lección/curso, retos, portafolio.
- [ ] XP, niveles del Explorador, medallas, insignias, ranking.
- [ ] Certificados con plantilla, firma digital, QR y verificación pública.
- [ ] Emisión individual y masiva.

## ⬜ Fase 7 — Comunicación, soporte, analítica y admin

- [ ] `engagement-service`: anuncios de salón, notificaciones, correo,
      mesa de ayuda, base de conocimiento.
- [ ] `analytics-service`: dashboards por alumno, salón, institución y
      plataforma; exportación a PDF, Excel y CSV.
- [ ] Portal Admin completo: panel ejecutivo, instituciones, usuarios, gestión
      académica y de contenidos, certificaciones, comercial, configuración.

## ⬜ Fase 8 — Endurecimiento y despliegue

- [ ] Pruebas de carga con k6 (escenarios de inicio de clase y jornada).
- [ ] Revisión de seguridad y prueba de penetración interna.
- [ ] CI/CD con despliegue sin caída y reversión automática.
- [ ] Railway: servicios, variables, dominios, copias de seguridad.
- [ ] Manifiestos para AWS / Huawei Cloud.
- [ ] Runbooks operativos y alertas.
