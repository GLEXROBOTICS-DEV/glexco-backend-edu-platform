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

## ✅ Fase 2 — Instituciones, salones y licencias

**Hecho:**

- [x] Dominio completo: `Institution` (con licencias como entidad interna),
      `Classroom` (con matrículas como entidad interna), y los objetos de valor
      `InstitutionCode`, `InstitutionName`, `EducationLevels`, `ContactInfo`,
      `Capacity`, `ClassroomName`.
- [x] **Tope de plazas** con doble protección: el agregado rechaza matricular en
      un salón lleno, y el repositorio carga la fila con `SELECT … FOR UPDATE`
      para que dos matrículas simultáneas se serialicen.
- [x] Matrícula **idempotente** (el evento de registro puede llegar dos veces) y
      que **conserva el historial** al retirar a un alumno.
- [x] Aislamiento entre instituciones comprobado sobre el recurso concreto:
      docente solo sus salones, admin todo su colegio, GLEXCO todo.
- [x] Casos de uso: crear institución, conceder licencia, buscar institución por
      código (público), crear/editar/listar salones, listar salones elegibles
      para el registro (público), matricular alumno y comprobación previa de
      salón que consulta identidad.
- [x] Esquema SQL con restricción de exclusión para licencias solapadas, índices
      parciales y clave compuesta de matrícula.
- [x] 25 pruebas del dominio.

- [x] Repositorios PostgreSQL, con `findByIdForUpdate` que toma el bloqueo de
      fila dentro de la transacción. El repositorio de salones **solo recibe el
      pool de lectura**: toda escritura pasa por el cliente de la transacción, de
      modo que saltarse el bloqueo por descuido es imposible.
- [x] Proyección `teacher_directory`, alimentada por eventos, para no hacer N
      llamadas a identidad al pintar un listado de salones.
- [x] Controladores HTTP: instituciones, licencias, salones, matrículas, búsqueda
      pública por código y salones elegibles para el registro.
- [x] `InternalOnlyGuard` en `@glexco/nest-platform`: protege la API interna entre
      microservicios con comparación en tiempo constante, y **deniega todo si
      falta el token**, para que un despiste de despliegue no abra una puerta.
- [x] Módulo y arranque con outbox, salud y apagado ordenado.

- [x] `EventConsumer` en `@glexco/nest-platform`: deduplicación en la **misma
      transacción** que el efecto, backoff creciente y aparte de mensajes veneno
      tras agotar reintentos.
- [x] `JoiningUnitOfWork`: permite que el mismo caso de uso sirva desde HTTP y
      desde un evento. Sin ella, el caso de uso abriría una segunda transacción y
      competiría por los mismos bloqueos que la del consumidor.
- [x] Consumidor de identidad: matrícula automática al registrarse, y
      mantenimiento del directorio de docentes.
- [x] Tarea periódica de vencimiento de licencias, bajo cerrojo distribuido para
      que N réplicas no emitan N avisos por licencia.
- [x] `toLoggerPort`: adaptador real de pino al puerto de logging. Corrige un
      fallo silencioso — las firmas están invertidas y el casteo hacía perder el
      contexto de todas las líneas de log.

- [x] Alta de administrador de institución enlazada con identidad: `identity`
      consulta el endpoint interno de `institutions` antes de crear la cuenta.
      Sin eso, un identificador mal tecleado creaba un administrador con permisos
      sobre una institución inexistente, y el fallo aparecía después de forma
      confusa. Una institución suspendida se rechaza para altas nuevas, pero sus
      usuarios actuales conservan el acceso.

## ✅ Fase 3 — Catálogo, kits y códigos de activación

**Hecho:**

- [x] `ActivationCode` con el código guardado **hasheado**, nunca en claro, y una
      pimienta que vive en configuración: robar la base no basta para
      reconstruir hashes.
- [x] Alfabeto sin `0/O/1/I/L` (un niño copiando de papel no debe perder su
      acceso por un carácter ambiguo) y espacio de 31¹² ≈ 7,9·10¹⁷.
- [x] Generación con `randomInt` de `node:crypto`, no `Math.random`: este último
      es predecible desde la semilla del proceso.
- [x] Canje de un solo uso con `SELECT … FOR UPDATE`, idempotente para el mismo
      alumno y conflicto para otro distinto.
- [x] `Entitlement`: el alumno ve únicamente el contenido de su kit. Se crea en
      la **misma transacción** que el canje.
- [x] Esquema SQL con índices parciales y restricciones que impiden estados
      imposibles (un código canjeado sin alumno, por ejemplo).
- [x] Repositorios PostgreSQL, API HTTP y endpoint interno de comprobación
      previa que consulta identidad.
- [x] 25 pruebas del dominio.

- [x] **Generación de lotes y exportación para imprenta.** `POST /catalog/batches`
      con `format=csv`. Los códigos en claro se devuelven **una sola vez**: en la
      base solo queda su hash, así que no existe -ni puede existir- un endpoint
      para volver a descargar el fichero.
- [x] **Consumidor de `identity.user.registered.v1` que canjea de forma
      asíncrona.** Cierra el flujo del registro sin transacción distribuida. El
      evento lleva el **id de la fila** del código, nunca el código.
- [x] Verificado contra infraestructura real: canje de un solo uso con 20
      peticiones simultáneas, tope de plazas, durabilidad de la outbox y
      deduplicación de eventos (`pnpm concurrency`).

- [x] **Caché de catálogo con invalidación por etiqueta.** `CachedContentRepository`
      decora el repositorio y agrupa por `kit:<id>`; publicar invalida el kit
      entero. No se cachea nada que decida un permiso.
- [x] **Publicación de contenido** con tabla explícita de transiciones: de
      borrador a publicado hay que pasar por revisión.
- [x] **Revocación de códigos y derechos.** Anular un código retira, en la misma
      transacción, el acceso que concedió.
- [x] **`media-service`**: subida con URL prefirmada (POST con política, que sí
      puede limitar el tamaño), validación del tipo **real** por firma binaria,
      miniaturas con sharp y proveedor de video externo tras un puerto.

**Pendiente:** nada bloqueante. Lo que queda son mejoras que dependen de tener
frontend o clientes reales:

- [ ] Tarea periódica de limpieza de subidas abandonadas (`listAbandoned` ya
      existe; falta programarla).
- [ ] Contratar el proveedor de video real y configurarlo (`VIDEO_PROVIDER_URL`).
- [ ] Endpoints de alta y edición de contenido (hoy se siembra por SQL; el
      cambio de estado de publicación sí está).
- [x] `GET /catalog/kits`: índice de kits publicados, para elegir uno al crear
      una evaluación.

## 🔄 Fase 4 — Portales de alumno (Discover y Academy)

**Hecho:**

- [x] **Canvas de Claude Design aprobado** antes de codificar.
- [x] `@glexco/icons`: iconografía SVG propia (robot, kit, insignia, nivel, reto,
      código, salón, certificado, biblioteca). Solo iconos **del dominio**; el
      cromo de interfaz sigue viniendo de Lucide.
- [x] `apps/web` en Next.js 15 con App Router y React Server Components.
- [x] Sistema de diseño con los tokens del canvas. Discover y Academy comparten
      componentes y **difieren en densidad**, declarada una sola vez con
      `data-portal`.
- [x] Sesión en cookie `httpOnly`: el token nunca llega a JavaScript. Las
      llamadas autenticadas se hacen desde el servidor.
- [x] Ingreso, cierre de sesión y enrutado al portal por edad y rol.
- [x] Portadas de Discover y Academy leyendo el **kit real** del catálogo.
- [x] Estados vacíos con la acción siguiente, esqueletos con la forma del
      contenido, foco visible y salto al contenido.
- [x] `pnpm smoke:web`: 17 comprobaciones del portal contra el backend real.

**Pendiente:**

- [x] **Mi progreso** en los dos portales: medias separadas de GLEXCO y del
      docente, cuánto ha mejorado, y la evolución en el tiempo.
- [x] Discover: **laboratorio de robots**, **mis kits**, **mis logros** y **mi
      cuenta**. Falta la zona de retos, que depende de los retos de la Fase 6.
- [x] Academy: **laboratorio de robots**, **cursos**, **ruta tecnológica** y **mi
      cuenta**. Faltan proyectos y desafíos (Fase 6), certificaciones (Fase 6) y
      el portafolio.
- [x] **Mi cuenta** en los cuatro portales: cambio de contraseña exigiendo la
      actual, y sesiones abiertas con cierre remoto.
- [x] **Modo oscuro** con la paleta del canvas, en tres estados (claro, oscuro y
      «como el sistema»), sin destello al cargar.
- [x] **Visita guiada** que no arranca sola: se abre desde la barra lateral y se
      puede reabrir siempre.
- [x] Biblioteca multimedia con reproductor y descargas por URL prefirmada.
- [x] Registro de alumno y activación de código desde el portal.
- [x] El alumno responde los cuestionarios desde el portal, sin JavaScript si
      hace falta, y ve su nota al instante.
- [ ] i18n es/en con next-intl (hoy los textos están en español en el código).
- [ ] Auditoría de accesibilidad WCAG 2.1 AA completa y navegación por teclado
      verificada pantalla a pantalla.

## 🔄 Fase 5 — Teacher Center y evaluación

**Hecho:**

- [x] `assessment-service` con `Assessment`, `Question` y `Submission`.
- [x] **Doble origen**: el banco de GLEXCO viene con el kit y es el mismo para
      todos los colegios; el docente crea las suyas para su salón. Un docente
      **no puede editar** las de GLEXCO, pero sí **duplicarlas** para adaptarlas.
- [x] Cuestionarios de marcar corregidos **automáticamente al entregar**
      (el formato tipo Coursera), y corrección manual para lo abierto y las
      entregas.
- [x] **La clave de corrección nunca sale hacia el alumno.** `forStudent()` es el
      único camino y no la incluye.
- [x] Tope de intentos con bloqueo de fila, límite de tiempo contado por el
      reloj del servidor, y preguntas congeladas en cuanto hay entregas.
- [x] Evidencias del alumno: foto, PDF y vídeo por subida, **o enlace externo**
      al OneDrive / Drive / Stream del centro.

**Pendiente:**

- [ ] Rúbricas de corrección (`Rubric`): hoy la corrección manual es por puntos
      libres sobre cada pregunta.
- [x] Panel del docente en el portal, con el dashboard de su salón.
- [x] **Bandeja de corrección** por salón, con el nombre real del alumno y la
      pantalla de puntuación. Ordenada por lo que hay que hacer: lo abierto
      primero, lo que corrigió la máquina plegado como referencia.
- [x] **El docente crea, amplía, publica y duplica sus evaluaciones** desde el
      portal. El banco se presenta en dos bloques —las del kit y las suyas—
      porque se operan distinto.
- [x] **Crear salones desde el portal** (docente y dirección), con selector de
      docente para la dirección. La pantalla no existía y el enlace daba 404.
- [x] **Lista de alumnos del salón** con quién activó su kit y quién se
      descolgó, y **ficha individual de cada alumno** con sus notas y su
      evolución. La dirección ve las de todo su colegio.
- [ ] Portal docente, lo que falta: recursos pedagógicos y capacitación docente.
- [ ] Tipos de pregunta `ordering` y `matching`: están en el vocabulario pero su
      corrección automática no está escrita, así que se tratan como manuales.

## 🔄 Fase 6 — Progreso, gamificación y certificados

> **En curso:** el dominio del certificado (firma Ed25519, serie legible y
> verificación) está escrito y apartado en el borrador de la sesión; falta el
> repositorio, el cableado HTTP y las pantallas.

- [x] `learning-service`: progreso por lección y curso, con la señal de **quién
      se descolgó** antes del primer examen, que es lo que la evaluación sola no
      puede dar.
- [x] XP, niveles del Explorador e insignias. **No hay ranking, y es una
      decisión:** el progreso solo se compara con uno mismo. La propuesta ya lo
      pide para el ranking —*celebra logros, no señala rezagos*— y entre menores
      vale igual.
- [ ] Retos de construcción y programación, misiones semanales, portafolio.
- [ ] Certificados con plantilla, firma digital, QR y verificación pública.
- [ ] Emisión individual y masiva.

## 🔄 Fase 7 — Comunicación, soporte, analítica y admin

**Hecho:**

- [x] `analytics-service` como **proyección de lectura** alimentada por eventos.
      No consulta los otros schemas: ver la sección 11 de
      [ARQUITECTURA.md](ARQUITECTURA.md).
- [x] Los **cinco dashboards** con su ámbito comprobado dos veces —permiso y
      recurso—: alumno, salón, alumno visto por su docente, institución y una
      vista por institución para GLEXCO.
- [x] **Eficacia docente** medida por PROGRESO y no por nota, con el tamaño de la
      muestra en cada fila y el aviso viajando junto a los datos. Las razones
      están en la sección 6.bis de [DOMINIO.md](DOMINIO.md).
- [x] Preguntas más falladas por salón: el dato más accionable para un docente.
- [x] Kits con peor resultado en todos los colegios: si un kit va mal en todas
      partes, el problema es del contenido.
- [x] Activación de códigos por institución, que es la métrica comercial.

**Pendiente:**

- [x] **Pantallas de los dashboards**: progreso del alumno en los dos portales,
      panel del docente con su salón, y panel de institución con la eficacia
      docente. Gráficos en SVG propio, sin librería: +2 kB sobre la carga base.
- [ ] Exportación a PDF, Excel y CSV (la tabla de datos ya permite copiar).
- [x] Panel de GLEXCO en el portal, con el directorio de instituciones que lo
      hace legible: antes listaba la cartera de clientes por UUID.
- [x] `engagement-service`: **correo real** (verificación y recuperación) y
      anuncios de salón. El token del enlace NO viaja en el evento: se pide a
      identidad en el momento de enviar, para que no quede escrito en la outbox
      ni en el stream.
- [ ] `engagement-service`, lo que falta: notificaciones, mesa de ayuda y base
      de conocimiento.
- [ ] **Mensajería docente↔alumno.** La decisión registrada en CLAUDE.md §6 era
      *anuncios asíncronos, sin mensajería*; el cliente la ha reabierto. Es un
      agregado nuevo con implicaciones de protección de menores —conversaciones
      privadas entre un adulto y un menor exigen registro y visibilidad para la
      dirección—, así que no es solo una pantalla más.
- [ ] Portal Admin completo: panel ejecutivo, instituciones, usuarios, gestión
      académica y de contenidos, certificaciones, comercial, configuración.
- [x] Progreso por consumo de contenido (`learning-service`, Fase 6).

## ⬜ Fase 8 — Endurecimiento y despliegue

- [ ] Pruebas de carga con k6 (escenarios de inicio de clase y jornada).
- [ ] Revisión de seguridad y prueba de penetración interna.
- [ ] CI/CD con despliegue sin caída y reversión automática.
- [ ] Railway: servicios, variables, dominios, copias de seguridad.
- [ ] Manifiestos para AWS / Huawei Cloud.
- [ ] Runbooks operativos y alertas.
