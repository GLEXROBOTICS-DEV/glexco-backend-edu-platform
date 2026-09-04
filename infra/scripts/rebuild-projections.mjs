#!/usr/bin/env node
/**
 * Reconstruccion de proyecciones.
 *
 * ## El problema que resuelve
 *
 * Las proyecciones de esta plataforma se alimentan de eventos, y JetStream **no
 * reproduce hacia atras** para un consumidor que ya existe. El consumidor
 * duradero de cada servicio se llama `<servicio>-consumer` y guarda su posicion;
 * cuando alguien anade un asunto nuevo a su lista, `EventConsumer` ACTUALIZA ese
 * consumidor -conservando la posicion, que es lo correcto para no reprocesar el
 * stream entero- y por tanto el asunto nuevo nace sin el pasado.
 *
 * El sintoma es siempre el mismo: una tabla de directorio vacia y una pantalla
 * que dice `None`, "un compañero" o "sin activar". Paso CUATRO veces en la
 * sesion 14 -el nombre del colegio y del alumno en aprendizaje, el del autor en
 * engagement, y el kit de la matricula- y las cuatro se arreglo a mano desde el
 * sembrador. Esto es lo que sustituye a esa chapuza.
 *
 * ## Como lo resuelve
 *
 * Reemitiendo un evento de INSTANTANEA por cada fila que hoy existe en la tabla
 * de origen, **a la outbox del servicio que la posee**. Desde ahi lo publica su
 * relay como cualquier otro evento y lo consume todo el mundo por el camino
 * normal. Tres consecuencias buscadas:
 *
 * - No se publica a NATS a mano: sigue valiendo el invariante 3 (eventos siempre
 *   por outbox), y el evento queda registrado como cualquier otro.
 * - No se escribe en la proyeccion de destino. Este guion no conoce ni una sola
 *   tabla de directorio para escribirla: la rellena su propio manejador, que es
 *   el unico que sabe como. Un guion que escribiera los directorios seria una
 *   segunda implementacion de cada proyeccion, y se desincronizaria.
 * - El ritmo lo pone el relay (100 eventos por pasada y segundo, por servicio).
 *   Una reconstruccion grande tarda; a cambio no puede tumbar a los consumidores.
 *
 * ## La regla de seguridad, que es lo importante de este archivo
 *
 * **Solo se puede reproducir un evento cuyo manejador sea idempotente.** No basta
 * con que el evento describa un hecho. Los tres que estan excluidos a proposito,
 * con su motivo, estan en `NO_REPRODUCIBLES` mas abajo, y el guion se niega a
 * emitir cualquier cosa que no este en `SOURCES`.
 *
 * Y por encima de eso: **jamas se reproduce un evento que pide enviar algo.**
 * `identity.email_verification.requested` y `identity.password_reset.requested`
 * son ordenes de mandar un correo, no hechos consumados; reproducirlos enviaria
 * a toda la plataforma un enlace de recuperacion de contrasena. Por eso la lista
 * es blanca y explicita, y no un patron como `identity.>`.
 *
 * ## Uso
 *
 *   node infra/scripts/rebuild-projections.mjs --check
 *   node infra/scripts/rebuild-projections.mjs --dry-run
 *   node infra/scripts/rebuild-projections.mjs --events=identity.user.registered.v1
 *   node infra/scripts/rebuild-projections.mjs --service=institutions --wait
 *
 * En local toma cada `DATABASE_URL_<SERVICIO>` de `.env`. En Railway se le pasa
 * un `ADMIN_DATABASE_URL` unico, igual que al sembrador (ver ENTORNO-DEMO.md §5).
 */

import { createHash } from 'node:crypto';
import pg from 'pg';
import { EVENTS } from '@glexco/contracts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const CHECK_ONLY = flag('check');
const DRY_RUN = flag('dry-run');
const WAIT = flag('wait');
const FORCE = flag('force');
const BATCH = Math.max(1, Number(value('batch', '500')) || 500);
const ONLY_EVENTS = value('events', '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const ONLY_SERVICE = value('service', '');

// ---------------------------------------------------------------------------
// Eventos que NO se pueden reproducir, y por que
// ---------------------------------------------------------------------------
/**
 * Esta lista no es documentacion: es la que se imprime cuando alguien pide uno
 * de estos por `--events`. Sin ella, el siguiente que quiera reconstruir los
 * dashboards de notas descubriria el problema despues de haber duplicado las
 * cifras en produccion.
 */
const NO_REPRODUCIBLES = {
  'assessment.submission.graded.v1':
    'analytics.question_miss_facts acumula (answered = answered + 1). Reproducirlo ' +
    'infla los fallos por pregunta, que es justo el dato que el docente usa para ' +
    'decidir que repasar. Los hechos por alumno (student_assessment_facts) SI son ' +
    'idempotentes; el problema es solo el recuento por pregunta.',
  'catalog.activation_code.batch_generated.v1':
    'analytics.institution_rollups.codes_issued acumula (+ EXCLUDED). Reproducirlo ' +
    'duplica los codigos emitidos de cada colegio, que es una cifra comercial.',
  'catalog.activation_code.redeemed.v1':
    'analytics.institution_rollups.codes_redeemed acumula (+ 1). Mismo caso.',
  'identity.email_verification.requested.v1':
    'NO es un hecho, es una orden de enviar un correo. Reproducirlo escribiria a ' +
    'toda la plataforma. Nunca se reproduce.',
  'identity.password_reset.requested.v1':
    'Igual, y peor: manda un enlace de recuperacion de contrasena a todo el mundo. ' +
    'Nunca se reproduce.',
};

// ---------------------------------------------------------------------------
// Las instantaneas
// ---------------------------------------------------------------------------
/**
 * Cada entrada dice como convertir el estado ACTUAL de una tabla en el evento
 * que lo habria producido.
 *
 * `cursor` es una expresion SQL que sirve a la vez para ordenar y para paginar
 * por clave (`> $1`), de modo que una reconstruccion de millones de filas no
 * necesita `OFFSET` ni cargar la tabla en memoria.
 *
 * **El payload lleva lo que la tabla sabe, y nada mas.** No se inventa un
 * `createdBy` ni una fecha que no se guardo: un actor fabricado aparece despues
 * en una auditoria como si alguien hubiera hecho algo. Los consumidores ya leen
 * estos campos como opcionales, porque los eventos son de vocabulario abierto.
 */
const SOURCES = [
  {
    event: 'identity.user.registered.v1',
    service: 'identity',
    schema: 'identity',
    aggregateType: 'User',
    /**
     * El alta de usuario: es la que alimenta TODOS los directorios de nombres
     * (institutions.teacher_directory y student_directory, learning.student_directory,
     * engagement.author_directory) y la que hizo falta rellenar a mano tres veces.
     *
     * **La instantanea no lleva `classroomId` ni `activationCodeId`, y eso es
     * precisamente lo que la hace segura.** Los dos eran datos del formulario de
     * registro: identidad nunca los guardo -el salon vive en instituciones y el
     * codigo en catalogo-. Al faltar, el manejador de instituciones no vuelve a
     * matricular y el de catalogo no vuelve a canjear el codigo del libro; los
     * nombres, que es lo que se busca, entran igual. La matricula se reconstruye
     * con `institutions.enrollment.student_enrolled.v1`, que sale de la tabla que
     * de verdad la guarda.
     */
    from: 'identity.users',
    where: '',
    cursor: 'id::text',
    columns:
      'id, version, email, first_name, last_name, roles, institution_id, locale, ' +
      'account_type, guardian_email, birth_date, created_at',
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.created_at,
      payload: {
        userId: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        roles: row.roles,
        ...(row.institution_id ? { institutionId: row.institution_id } : {}),
        locale: row.locale,
        // Se recalcula por la fecha de nacimiento y no se copia de ningun sitio:
        // la marca original no se guardo como columna.
        requiresGuardianConsent: isMinor(row.birth_date),
        ...(row.guardian_email ? { guardianEmail: row.guardian_email } : {}),
        accountType: row.account_type,
        registeredAt: iso(row.created_at),
      },
    }),
  },

  {
    event: 'institutions.institution.created.v1',
    service: 'institutions',
    schema: 'institutions',
    aggregateType: 'Institution',
    /** Alimenta analytics.institution_directory y learning.institution_directory. */
    from: 'institutions.institutions',
    where: '',
    cursor: 'id::text',
    columns: 'id, version, code, name, short_name, education_levels, city, created_at',
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.created_at,
      payload: {
        institutionId: row.id,
        // El codigo se guarda normalizado (sin guiones) y asi debe viajar: es lo
        // que hace la via normal, y el panel lo muestra tal cual.
        code: row.code,
        name: row.name,
        shortName: row.short_name,
        educationLevels: row.education_levels,
        city: row.city,
        createdAt: iso(row.created_at),
      },
    }),
  },

  {
    event: 'institutions.classroom.created.v1',
    service: 'institutions',
    schema: 'institutions',
    aggregateType: 'Classroom',
    /** Alimenta engagement.classroom_directory, assessment.classroom_directory
     *  (la comprobacion de ambito del docente) y analytics.classroom_rollups. */
    from: 'institutions.classrooms',
    where: '',
    cursor: 'id::text',
    columns:
      'id, version, institution_id, teacher_id, name, grade, capacity, academic_year, created_at',
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.created_at,
      payload: {
        classroomId: row.id,
        institutionId: row.institution_id,
        teacherId: row.teacher_id,
        name: row.name,
        grade: row.grade,
        capacity: row.capacity,
        academicYear: row.academic_year,
        createdAt: iso(row.created_at),
      },
    }),
  },

  {
    event: 'institutions.enrollment.student_enrolled.v1',
    service: 'institutions',
    schema: 'institutions',
    aggregateType: 'Classroom',
    /**
     * Solo las matriculas ACTIVAS. Reproducir una retirada como alta la
     * resucitaria en engagement y en learning, que marcan `active = true` al
     * recibirla; las bajas se reproducen -si algun dia hace falta- con su propio
     * evento, y ese es el que sabe apagarlas.
     *
     * Se enriquece con el nombre del alumno desde `student_directory`, del MISMO
     * schema, porque el manejador de aprendizaje solo pisa el nombre si el evento
     * trae uno: sin esto la lista de clase queda con las filas correctas y los
     * nombres en blanco, que es media reconstruccion.
     */
    from: `institutions.enrollments e
             JOIN institutions.classrooms c ON c.id = e.classroom_id
             LEFT JOIN institutions.student_directory d ON d.user_id = e.student_id`,
    where: "e.status = 'active'",
    cursor: "(e.classroom_id::text || ':' || e.student_id::text)",
    columns: `e.classroom_id, e.student_id, e.enrolled_at, c.version, c.institution_id,
              c.teacher_id, c.grade, c.capacity, d.full_name,
              (SELECT count(*) FROM institutions.enrollments x
                WHERE x.classroom_id = e.classroom_id AND x.status = 'active') AS enrolled_count`,
    build: (row) => ({
      aggregateId: row.classroom_id,
      // El agregado es el SALON, asi que treinta alumnos comparten agregado y
      // version: sin distinguir por alumno, el id determinista seria el mismo
      // para los treinta y la outbox descartaria veintinueve por conflicto. Solo
      // se habria matriculado al primero de la lista.
      key: `${row.classroom_id}:${row.student_id}`,
      version: row.version,
      occurredAt: row.enrolled_at,
      payload: {
        classroomId: row.classroom_id,
        institutionId: row.institution_id,
        studentId: row.student_id,
        teacherId: row.teacher_id,
        grade: row.grade,
        enrolledCount: Number(row.enrolled_count),
        capacity: row.capacity,
        enrolledAt: iso(row.enrolled_at),
        ...(row.full_name ? { fullName: row.full_name } : {}),
      },
    }),
  },

  {
    event: 'institutions.classroom.teacher_assigned.v1',
    service: 'institutions',
    schema: 'institutions',
    aggregateType: 'Classroom',
    /**
     * `previousTeacherId` va a null a proposito: la tabla guarda quien es el
     * docente, no quien lo fue. El manejador de engagement solo usa el actual.
     */
    from: 'institutions.classrooms',
    where: "status = 'active'",
    cursor: 'id::text',
    columns: 'id, version, institution_id, teacher_id, updated_at',
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.updated_at,
      payload: {
        classroomId: row.id,
        institutionId: row.institution_id,
        teacherId: row.teacher_id,
        previousTeacherId: null,
        assignedAt: iso(row.updated_at),
      },
    }),
  },

  {
    event: 'catalog.course.published.v1',
    service: 'catalog',
    schema: 'catalog',
    aggregateType: 'Course',
    /**
     * Las lecciones viajan DENTRO del evento del curso, como en la via normal:
     * asi una sola reemision reconstruye `course_directory` y `lesson_directory`
     * a la vez, y el "3 de 12" de la portada vuelve a cuadrar.
     */
    from: 'catalog.courses',
    where: "status = 'published'",
    cursor: 'id::text',
    columns: `id, version, kit_id, title, updated_at,
              (SELECT count(*) FROM catalog.lessons l
                WHERE l.course_id = courses.id AND l.status = 'published') AS lesson_count,
              (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'lessonId', l.id, 'title', l.title, 'orderIndex', l.order_index)
                        ORDER BY l.order_index), '[]'::jsonb)
                 FROM catalog.lessons l
                WHERE l.course_id = courses.id AND l.status = 'published') AS lessons`,
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.updated_at,
      payload: {
        courseId: row.id,
        kitId: row.kit_id,
        title: row.title,
        lessonCount: Number(row.lesson_count),
        lessons: row.lessons,
      },
    }),
  },

  {
    event: 'catalog.entitlement.granted.v1',
    service: 'catalog',
    schema: 'catalog',
    aggregateType: 'Entitlement',
    /**
     * El que arregla la columna "kit" de la lista de clase. Solo los derechos
     * ACTIVOS: el manejador de instituciones rellena `enrollments.kit_id`, y
     * reproducir uno revocado devolveria el acceso aparente a un kit retirado.
     */
    from: 'catalog.entitlements',
    where: 'active',
    cursor: 'id::text',
    columns:
      'id, version, student_id, kit_id, grade, institution_id, source_activation_code_id, granted_at',
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.granted_at,
      payload: {
        entitlementId: row.id,
        studentId: row.student_id,
        kitId: row.kit_id,
        grade: row.grade,
        institutionId: row.institution_id,
        sourceActivationCodeId: row.source_activation_code_id,
        grantedAt: iso(row.granted_at),
      },
    }),
  },

  {
    event: 'assessment.assessment.published.v1',
    service: 'assessment',
    schema: 'assessment',
    aggregateType: 'Assessment',
    /**
     * Hoy no lo consume nadie, asi que reproducirlo no hace nada. Esta registrado
     * de todas formas porque el proximo consumidor que lo escuche -el catalogo de
     * evaluaciones del panel de GLEXCO es el candidato- necesitara exactamente
     * esto el dia que se despliegue, y ese es el dia en que nadie se acuerda de
     * escribir el guion.
     */
    from: 'assessment.assessments',
    where: "status = 'published'",
    cursor: 'id::text',
    columns: `id, version, kit_id, origin, institution_id, classroom_id, kind, title,
              updated_at, jsonb_array_length(questions) AS question_count`,
    build: (row) => ({
      aggregateId: row.id,
      version: row.version,
      occurredAt: row.updated_at,
      payload: {
        assessmentId: row.id,
        kitId: row.kit_id,
        origin: row.origin,
        institutionId: row.institution_id,
        classroomId: row.classroom_id,
        kind: row.kind,
        title: row.title,
        questionCount: Number(row.question_count),
        publishedAt: iso(row.updated_at),
      },
    }),
  },
];

// ---------------------------------------------------------------------------
// El informe de salud
// ---------------------------------------------------------------------------
/**
 * Cada proyeccion, con el recuento que tiene y el que deberia tener.
 *
 * Existe porque el fallo de una proyeccion vacia **no se manifiesta como un
 * error**: la pantalla se pinta, responde 200 y dice `None`. Las cuatro veces de
 * la sesion 14 las descubrio el cliente mirando la pagina, no una alerta. Esto
 * lo convierte en una comprobacion de un comando.
 *
 * `target` y `source` se cuentan con CONEXIONES DISTINTAS -la del servicio dueno
 * de cada tabla-, asi que esto no es una consulta cruzada entre schemas: es una
 * herramienta de operacion comparando dos cifras. Ningun servicio hace esto.
 */
const PROJECTIONS = [
  {
    target: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.teacher_directory' },
    source: {
      service: 'identity',
      // El rol `teacher` exactamente, no "todo el que no es alumno": el
      // manejador solo mete al directorio a quien lo tiene. Un director de
      // colegio o alguien de GLEXCO tienen institucion y no son docentes, y
      // contarlos aqui daba un hueco permanente que no existia.
      sql: "SELECT count(*) FROM identity.users WHERE 'teacher' = ANY(roles) AND institution_id IS NOT NULL",
    },
    feeds: 'identity.user.registered.v1',
    note: 'nombres del docente en el panel y en la bandeja de correccion',
  },
  {
    target: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.student_directory' },
    source: {
      service: 'identity',
      sql: "SELECT count(*) FROM identity.users WHERE 'student' = ANY(roles) AND institution_id IS NOT NULL",
    },
    feeds: 'identity.user.registered.v1',
    note: 'lista de clase del docente',
  },
  {
    target: { service: 'learning', sql: 'SELECT count(*) FROM learning.student_directory' },
    source: {
      service: 'identity',
      sql: "SELECT count(*) FROM identity.users WHERE 'student' = ANY(roles)",
    },
    feeds: 'identity.user.registered.v1',
    note: 'nombre impreso en el certificado (sin nombre no se emite)',
  },
  {
    target: { service: 'engagement', sql: 'SELECT count(*) FROM engagement.author_directory' },
    source: { service: 'identity', sql: 'SELECT count(*) FROM identity.users' },
    feeds: 'identity.user.registered.v1',
    note: 'autor de cada mensaje del muro; vacio = "un compañero"',
  },
  {
    target: { service: 'learning', sql: 'SELECT count(*) FROM learning.institution_directory' },
    source: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.institutions' },
    feeds: 'institutions.institution.created.v1',
    note: 'colegio impreso en el certificado',
  },
  {
    target: { service: 'analytics', sql: 'SELECT count(*) FROM analytics.institution_directory' },
    source: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.institutions' },
    feeds: 'institutions.institution.created.v1',
    note: 'cartera de clientes del panel de GLEXCO, por nombre y no por UUID',
  },
  {
    target: { service: 'engagement', sql: 'SELECT count(*) FROM engagement.classroom_directory' },
    source: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.classrooms' },
    feeds: 'institutions.classroom.created.v1',
    note: 'anuncios y muro del salon',
  },
  {
    target: { service: 'assessment', sql: 'SELECT count(*) FROM assessment.classroom_directory' },
    source: { service: 'institutions', sql: 'SELECT count(*) FROM institutions.classrooms' },
    feeds: 'institutions.classroom.created.v1',
    note: 'comprobacion de ambito: de que salones puede corregir un docente',
  },
  {
    target: {
      service: 'engagement',
      sql: 'SELECT count(*) FROM engagement.classroom_members WHERE active',
    },
    source: {
      service: 'institutions',
      sql: "SELECT count(*) FROM institutions.enrollments WHERE status = 'active'",
    },
    feeds: 'institutions.enrollment.student_enrolled.v1',
    note: 'que anuncios y preguntas ve cada alumno',
  },
  {
    target: {
      service: 'learning',
      sql: 'SELECT count(*) FROM learning.classroom_members WHERE active',
    },
    source: {
      service: 'institutions',
      sql: "SELECT count(*) FROM institutions.enrollments WHERE status = 'active'",
    },
    feeds: 'institutions.enrollment.student_enrolled.v1',
    note: 'progreso por salon que ve el docente',
  },
  {
    target: { service: 'learning', sql: 'SELECT count(*) FROM learning.course_directory' },
    source: {
      service: 'catalog',
      sql: "SELECT count(*) FROM catalog.courses WHERE status = 'published'",
    },
    feeds: 'catalog.course.published.v1',
    note: 'el "3 de 12" de la portada',
  },
  {
    target: { service: 'learning', sql: 'SELECT count(*) FROM learning.lesson_directory' },
    source: {
      service: 'catalog',
      sql: "SELECT count(*) FROM catalog.lessons WHERE status = 'published'",
    },
    feeds: 'catalog.course.published.v1',
    note: 'sin esto no se puede completar una leccion: el servicio no la conoce',
  },
  {
    target: {
      service: 'institutions',
      sql: "SELECT count(*) FROM institutions.enrollments WHERE status = 'active' AND kit_id IS NOT NULL",
    },
    source: {
      service: 'catalog',
      sql: `SELECT count(*) FROM catalog.entitlements e
             WHERE e.active AND e.institution_id IS NOT NULL`,
    },
    feeds: 'catalog.entitlement.granted.v1',
    note: 'columna "kit" de la lista de clase; en cero = "sin activar" para todos',
    /**
     * Aqui las dos cifras NO tienen por que coincidir, y por eso solo se mira si
     * la de la izquierda es cero.
     *
     * La diferencia entre "derechos concedidos" y "matriculas con kit" es un dato
     * de NEGOCIO, no un fallo: son los alumnos que activaron su libro sin estar
     * matriculados en un salon -o que se dieron de baja despues-. Tratarla como
     * hueco haria que el comando pidiera reconstruir esta proyeccion en cada
     * ejecucion, para siempre, y esa es la via mas rapida a que nadie vuelva a
     * mirar el informe.
     *
     * Lo que si es un fallo es el cero con derechos concedidos, que es
     * exactamente como se manifesto en produccion: nadie consumia el evento y la
     * columna decia "sin activar" para todos, incluidos los que ya lo habian
     * activado.
     */
    onlyIfEmpty: true,
  },
];

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------

const clients = new Map();

/**
 * Una conexion por servicio, con SU credencial cuando existe.
 *
 * En local cada servicio tiene su `DATABASE_URL_<SERVICIO>` en `.env` y su
 * propio rol, que es el que puede escribir en su outbox y leer sus tablas: usar
 * la credencial de cada uno mantiene la reconstruccion dentro de los mismos
 * permisos que la via normal. En Railway se pasa un `ADMIN_DATABASE_URL` unico,
 * porque ahi las credenciales por servicio viven en cada servicio y no en la
 * maquina desde la que se lanza esto.
 */
async function clientFor(service) {
  if (clients.has(service)) return clients.get(service);

  const url =
    process.env[`DATABASE_URL_${service.toUpperCase()}`] ??
    process.env.ADMIN_DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      `Falta DATABASE_URL_${service.toUpperCase()} (o ADMIN_DATABASE_URL) para ${service}.`,
    );
  }

  const client = new pg.Client({
    connectionString: url,
    // Railway sirve Postgres con certificado propio.
    ssl: /railway|proxy\.rlwy|amazonaws/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  clients.set(service, client);
  return client;
}

async function closeAll() {
  for (const client of clients.values()) await client.end().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const iso = (date) => (date instanceof Date ? date.toISOString() : new Date(date).toISOString());

function isMinor(birthDate) {
  if (!birthDate) return false;
  const born = new Date(birthDate);
  const fourteen = new Date();
  fourteen.setFullYear(fourteen.getFullYear() - 14);
  return born > fourteen;
}

/**
 * Id de evento determinista.
 *
 * Se deriva de (evento, agregado, version), no al azar, para que volver a
 * lanzar el comando **no vuelva a publicar lo mismo**: el `ON CONFLICT
 * (event_id) DO NOTHING` de la outbox lo descarta. Si el agregado cambio, su
 * version cambio y el id es otro, asi que la instantanea nueva si se emite.
 *
 * `--force` mete una sal con la hora para poder reemitir a la fuerza cuando la
 * fila anterior sigue en la outbox y hay que reparar un consumidor que se comio
 * el evento (por ejemplo, si su marca de `processed_events` quedo escrita por un
 * despliegue a medias).
 */
function eventIdFor(event, aggregateId, version) {
  const salt = FORCE ? `:${Date.now()}` : '';
  const hex = createHash('sha256')
    .update(`glexco-replay:${event}:${aggregateId}:${version}${salt}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const count = async (service, sql) => {
  const client = await clientFor(service);
  const { rows } = await client.query(sql);
  return Number(rows[0].count);
};

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

async function report() {
  console.log('\nEstado de las proyecciones\n');

  const gaps = new Set();

  for (const projection of PROJECTIONS) {
    let have;
    let want;
    try {
      have = await count(projection.target.service, projection.target.sql);
      want = await count(projection.source.service, projection.source.sql);
    } catch (error) {
      console.log(`  ??  ${label(projection)}  -> ${error.message.split('\n')[0]}`);
      continue;
    }

    // `have > want` no es un fallo: un directorio conserva a quien ya no cuenta
    // en el origen (un docente al que se le retiro el rol, un colegio archivado)
    // y borrarlo dejaria sin nombre a lo que ese usuario escribio o firmo.
    const missing = Math.max(0, want - have);
    const broken = projection.onlyIfEmpty ? have === 0 && want > 0 : missing > 0;

    if (broken) gaps.add(projection.feeds);

    const mark = broken ? 'FALTA' : 'ok';
    const detail = broken ? `  faltan ${missing}` : projection.onlyIfEmpty ? '  (informativo)' : '';

    console.log(
      `  ${mark.padEnd(6)} ${label(projection).padEnd(44)} ${String(have).padStart(6)} / ${String(want).padStart(6)}${detail}`,
    );
    console.log(`         ${projection.note}`);
  }

  if (gaps.size === 0) {
    console.log('\nTodas las proyecciones cuadran con su origen.\n');
    return [];
  }

  console.log(`\nHay huecos. Los cierra reproduciendo:\n`);
  for (const event of gaps) console.log(`  --events=${event}`);
  console.log('');
  return [...gaps];
}

const label = (projection) => projection.target.sql.match(/FROM ([a-z_.]+)/)[1];

// ---------------------------------------------------------------------------
// Reemision
// ---------------------------------------------------------------------------

async function replay(source) {
  const client = await clientFor(source.service);
  const where = source.where ? `WHERE ${source.where}` : '';
  const paged = source.where ? `AND ${source.cursor} > $1` : `WHERE ${source.cursor} > $1`;

  let cursor = '';
  let emitted = 0;
  let skipped = 0;
  let sampled = false;

  for (;;) {
    const { rows } = await client.query(
      `SELECT ${source.columns}, ${source.cursor} AS __cursor
         FROM ${source.from}
        ${where} ${paged}
        ORDER BY ${source.cursor}
        LIMIT $2`,
      [cursor, BATCH],
    );

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].__cursor;

    for (const row of rows) {
      const snapshot = source.build(row);
      const eventId = eventIdFor(
        source.event,
        snapshot.key ?? snapshot.aggregateId,
        snapshot.version,
      );

      if (!sampled && (DRY_RUN || process.env.REPLAY_VERBOSE === '1')) {
        console.log(`\n  ejemplo de ${source.event}:`);
        console.log(`  ${JSON.stringify(snapshot.payload, null, 2).replace(/\n/g, '\n  ')}\n`);
        sampled = true;
      }

      if (DRY_RUN) {
        emitted += 1;
        continue;
      }

      const metadata = {
        eventId,
        eventName: source.event,
        occurredAt: iso(snapshot.occurredAt),
        aggregateId: snapshot.aggregateId,
        aggregateType: source.aggregateType,
        aggregateVersion: snapshot.version,
        // Marca de reconstruccion. No la lee ningun manejador -y no debe leerla:
        // un evento reproducido tiene que aplicarse igual que el original-, pero
        // es lo que permite responder despues "de donde salieron estos 8.000
        // eventos del martes" mirando la outbox.
        replay: true,
      };

      // `metadata` NO puede ir vacio ni a medias: el consumidor enruta por
      // `metadata.eventName` y deduplica por `metadata.eventId`. Con un objeto
      // vacio el evento se publica, llega al bus y se descarta SIN ERROR. Ese
      // fallo ya costo un "10 de 0 emitidos" que duro semanas.
      const { rowCount } = await client.query(
        `INSERT INTO ${source.schema}.outbox
           (event_id, event_name, aggregate_type, aggregate_id, aggregate_version, payload, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          eventId,
          source.event,
          source.aggregateType,
          snapshot.aggregateId,
          snapshot.version,
          JSON.stringify(snapshot.payload),
          JSON.stringify(metadata),
        ],
      );

      if (rowCount === 1) emitted += 1;
      else skipped += 1;
    }

    if (rows.length < BATCH) break;
  }

  return { emitted, skipped };
}

/**
 * Espera a que el relay vacie la outbox.
 *
 * Sin esto, el comando termina diciendo "8.000 eventos emitidos" y las
 * proyecciones siguen vacias durante minutos, porque el relay envia 100 por
 * segundo y por servicio. Quien lo lance en un despliegue necesita saber cuando
 * ha ACABADO de verdad, no cuando se han escrito las filas.
 */
async function waitForDrain(services) {
  console.log('\nEsperando a que el relay publique lo emitido...');

  for (let attempt = 0; attempt < 600; attempt += 1) {
    let pending = 0;
    const detail = [];

    for (const service of services) {
      const client = await clientFor(service);
      const { rows } = await client.query(
        `SELECT count(*) FROM ${service}.outbox WHERE published_at IS NULL`,
      );
      const value = Number(rows[0].count);
      pending += value;
      if (value > 0) detail.push(`${service}: ${value}`);
    }

    if (pending === 0) {
      console.log('  Outbox vacia: todo publicado.');
      return true;
    }

    if (attempt % 5 === 0) console.log(`  pendientes -> ${detail.join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(
    '  Sigue habiendo pendientes tras diez minutos. Comprueba que el servicio ' +
      'esta en pie y que NATS responde: el relay solo publica si los dos estan.',
  );
  return false;
}

// ---------------------------------------------------------------------------

/**
 * Comprueba que cada instantanea nombra un evento que existe de verdad.
 *
 * Una errata en un nombre de evento **no falla**: el evento se escribe en la
 * outbox, el relay lo publica a un asunto que nadie escucha, el comando informa
 * de "8.000 emitidos" y las proyecciones siguen vacias. Es el mismo fallo
 * silencioso que el `metadata: '{}'` del sembrador, y se corta aqui comparando
 * contra el catalogo de `@glexco/contracts`, que es la unica fuente.
 */
function verifyCatalogue() {
  const known = new Set(Object.values(EVENTS));
  const unknown = SOURCES.filter((source) => !known.has(source.event));

  if (unknown.length > 0) {
    throw new Error(
      `Estos eventos no estan en el catalogo de @glexco/contracts:\n` +
        unknown.map((source) => `  ${source.event}`).join('\n') +
        `\nUn nombre mal escrito se publica igual, a un asunto que nadie escucha.`,
    );
  }

  const both = SOURCES.filter((source) => NO_REPRODUCIBLES[source.event]);
  if (both.length > 0) {
    throw new Error(
      `Estos eventos estan a la vez en SOURCES y en NO_REPRODUCIBLES: ` +
        both.map((source) => source.event).join(', '),
    );
  }
}

async function main() {
  verifyCatalogue();

  for (const requested of ONLY_EVENTS) {
    if (NO_REPRODUCIBLES[requested]) {
      console.error(`\nNo se puede reproducir ${requested}.\n`);
      console.error(`  ${NO_REPRODUCIBLES[requested]}\n`);
      process.exitCode = 1;
      return;
    }
    if (!SOURCES.some((source) => source.event === requested)) {
      console.error(`\nNo hay instantanea registrada para ${requested}.\n`);
      console.error('  Reproducible hoy:');
      for (const source of SOURCES) console.error(`    ${source.event}`);
      console.error(
        '\n  Anadir una exige comprobar ANTES que todos sus manejadores son\n' +
          '  idempotentes. Ver la cabecera de este archivo.\n',
      );
      process.exitCode = 1;
      return;
    }
  }

  const suggested = await report();
  if (CHECK_ONLY) return;

  let selected = SOURCES;
  if (ONLY_EVENTS.length > 0) {
    selected = SOURCES.filter((source) => ONLY_EVENTS.includes(source.event));
  } else if (suggested.length > 0) {
    // Sin `--events`, se reproduce solo lo que el informe ha visto corto. Es la
    // diferencia entre reparar y reemitir la plataforma entera por costumbre.
    selected = SOURCES.filter((source) => suggested.includes(source.event));
  } else {
    console.log('No hay nada que reconstruir. Con --events=<evento> se fuerza uno concreto.\n');
    return;
  }

  if (ONLY_SERVICE) selected = selected.filter((source) => source.service === ONLY_SERVICE);

  if (selected.length === 0) {
    console.log('El filtro no deja ninguna instantanea que reproducir.\n');
    return;
  }

  console.log(`${DRY_RUN ? 'Simulacion' : 'Reemitiendo'}: ${selected.length} instantanea(s)\n`);

  const touched = new Set();

  for (const source of selected) {
    const { emitted, skipped } = await replay(source);
    touched.add(source.service);
    console.log(
      `  ${source.event}  ->  ${emitted} emitido(s)` +
        (skipped > 0 ? `, ${skipped} ya estaban en la outbox` : ''),
    );
  }

  if (DRY_RUN) {
    console.log('\nSimulacion: no se ha escrito nada.\n');
    return;
  }

  if (WAIT) await waitForDrain([...touched]);

  console.log(
    '\nHecho. Los eventos estan en la outbox; los publica el relay de cada\n' +
      'servicio, asi que el servicio de origen tiene que estar EN PIE. Vuelve a\n' +
      'lanzar con --check para confirmar que los huecos se cerraron.\n',
  );
}

main()
  .catch((error) => {
    console.error('\nFallo la reconstruccion:', error.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
