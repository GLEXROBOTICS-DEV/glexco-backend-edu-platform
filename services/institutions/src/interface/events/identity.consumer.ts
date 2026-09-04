import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer, JoiningUnitOfWork } from '@glexco/nest-platform';
import { EVENTS, ROLES, type Role } from '@glexco/contracts';
import type { Clock, ExecutionContext, LoggerPort } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { EnrollStudentUseCase } from '../../application/enroll-student.usecase';
import type {
  ClassroomRepository,
  InstitutionRepository,
  StudentDirectory,
  TeacherDirectory,
} from '../../domain/repositories';

/**
 * Reacciones de este servicio a lo que ocurre en identidad.
 *
 * Es la pieza que cierra el flujo del registro: el alumno se da de alta en
 * identidad y aparece matriculado en su salon sin que ninguno de los dos
 * servicios llame al otro de forma sincrona. Si instituciones esta caido cuando
 * alguien se registra, el evento espera en el stream y se aplica al volver; el
 * alumno no se queda sin matricula, solo tarda mas.
 *
 * Todo manejador se ejecuta DENTRO de la transaccion que abrio el consumidor
 * para la marca de deduplicacion. Por eso reciben una `JoiningUnitOfWork` en vez
 * de la normal: si abriesen su propia transaccion, la marca y el efecto podrian
 * confirmarse por separado y ademas competirian por los mismos bloqueos.
 */
export interface IdentityConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  classrooms: ClassroomRepository;
  institutions: InstitutionRepository;
  teachers: TeacherDirectory;
  students: StudentDirectory;
  clock: Clock;
  logger: LoggerPort;
  /** Logger de pino que usa el propio consumidor; los casos de uso reciben el
   *  puerto `LoggerPort`, que es agnostico a la libreria. */
  natsLogger: Logger;
}

/** Carga util de `identity.user.registered.v1`, en la parte que aqui importa. */
interface UserRegisteredPayload {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  institutionId?: string;
  classroomId?: string;
  grade?: string;
  accountType: 'institutional' | 'independent';
}

interface UserRoleChangedPayload {
  userId: string;
  role: Role;
  institutionId?: string;
}

interface UserDeactivatedPayload {
  userId: string;
}

interface UserProfileUpdatedPayload {
  userId: string;
  firstName: string;
  lastName: string;
}

interface EntitlementGrantedPayload {
  studentId: string;
  kitId: string;
  institutionId: string | null;
}

export function buildIdentityConsumer(deps: IdentityConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'institutions',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    // Solo estos asuntos. Suscribirse a `identity.>` traeria todos los eventos
    // de identidad -incluidos los de sesion, que son miles por minuto- para
    // descartarlos aqui: puro trabajo desperdiciado en la ruta mas caliente.
    subjects: [
      EVENTS.USER_REGISTERED,
      EVENTS.USER_ROLE_GRANTED,
      EVENTS.USER_ROLE_REVOKED,
      EVENTS.USER_DEACTIVATED,
      EVENTS.USER_PROFILE_UPDATED,
      // De catalogo, no de identidad. El consumidor se llama "identity" por
      // historia; lo que importa es que este asunto tiene que llegar a alguien
      // de este servicio, y el salon vive aqui.
      EVENTS.KIT_ENTITLEMENT_GRANTED,
    ],
    logger: deps.natsLogger,
  });

  // -------------------------------------------------------------------------
  // Alta de alumno -> matricula en su salon
  // -------------------------------------------------------------------------
  consumer.on<UserRegisteredPayload>(EVENTS.USER_REGISTERED, async (event, tx) => {
    const payload = event.payload;

    // El personal se resuelve PRIMERO. Un docente tiene institucion pero no
    // salon, asi que comprobar el salon antes lo descartaria y nunca entraria al
    // directorio.
    if (!payload.roles.includes(ROLES.STUDENT)) {
      await upsertTeacher(deps, payload);
      return;
    }

    // Un alumno independiente no tiene salon: compra el libro por su cuenta y
    // accede al contenido de su kit sin pertenecer a ningun colegio. No es un
    // error, es la mitad del modelo de negocio.
    if (payload.accountType !== 'institutional') return;
    if (!payload.institutionId) return;

    // El nombre entra ANTES de matricular, y por la misma via que el del
    // docente. Sin esto, el portal del docente solo tendria identificadores:
    // una bandeja de correccion que dice "a3f1-... entrego su examen" no sirve
    // para nada.
    //
    // Y entra SIN exigir salon, que es el mismo error que ya se corrigio dos
    // lineas mas arriba para el personal. Un alumno con institucion tiene
    // nombre, tenga salon o no: exigir el salon aqui deja el directorio a medias
    // en dos casos reales -el alta que llega sin salon elegido, y la
    // reconstruccion de proyecciones, cuya instantanea no puede llevar salon
    // porque identidad nunca lo guardo-. La matricula, que si lo necesita, se
    // comprueba justo despues.
    await deps.students.upsert({
      userId: payload.userId,
      institutionId: payload.institutionId,
      fullName: `${payload.firstName} ${payload.lastName}`,
      email: payload.email,
    });

    if (!payload.classroomId) return;

    const enroll = new EnrollStudentUseCase(
      deps.classrooms,
      deps.institutions,
      // Se suma a la transaccion del consumidor en vez de abrir la suya.
      new JoiningUnitOfWork(tx.client as PoolClient, 'institutions'),
      deps.clock,
      deps.logger,
    );

    await enroll.execute(
      {
        classroomId: payload.classroomId,
        studentId: payload.userId,
        institutionId: payload.institutionId,
      },
      contextFromEvent(event.metadata.correlationId),
    );
  });

  // -------------------------------------------------------------------------
  // Rol de docente concedido -> entra al directorio
  // -------------------------------------------------------------------------
  consumer.on<UserRoleChangedPayload>(EVENTS.USER_ROLE_GRANTED, async (event) => {
    if (event.payload.role !== ROLES.TEACHER) return;
    if (!event.payload.institutionId) return;

    // El nombre no viaja en este evento, solo el rol. Si el docente ya estaba en
    // el directorio se conserva su nombre; si no, se crea con un marcador que el
    // evento de alta o el de perfil completara.
    const existing = await deps.teachers.findName(event.payload.userId);

    await deps.teachers.upsert({
      userId: event.payload.userId,
      institutionId: event.payload.institutionId,
      fullName: existing ?? 'Docente',
      email: '',
    });
  });

  consumer.on<UserRoleChangedPayload>(EVENTS.USER_ROLE_REVOKED, async (event) => {
    if (event.payload.role !== ROLES.TEACHER) return;
    await deps.teachers.remove(event.payload.userId);
  });

  // -------------------------------------------------------------------------
  // Baja de usuario
  // -------------------------------------------------------------------------
  consumer.on<UserDeactivatedPayload>(EVENTS.USER_DEACTIVATED, async (event) => {
    // Se retira del directorio de docentes, pero NO se tocan las matriculas de
    // los alumnos: su progreso, sus evaluaciones y sus certificados cuelgan de
    // ellas. Una cuenta desactivada no puede entrar, y eso ya basta.
    await deps.teachers.remove(event.payload.userId);
  });

  // -------------------------------------------------------------------------
  // Cambio de nombre -> se refleja en el directorio
  // -------------------------------------------------------------------------
  consumer.on<UserProfileUpdatedPayload>(EVENTS.USER_PROFILE_UPDATED, async (event) => {
    // `rename` y no `upsert`: este evento no trae institucion ni correo, y un
    // upsert los sobrescribiria con vacio. Ademas, si el usuario no esta en el
    // directorio no hace nada, que es lo correcto para un alumno.
    const fullName = `${event.payload.firstName} ${event.payload.lastName}`;

    // Se intenta en los dos directorios: cada `rename` es un UPDATE que no hace
    // nada si la fila no esta, asi que el evento no necesita traer el rol -que
    // no trae- para acertar con la tabla.
    await deps.teachers.rename(event.payload.userId, fullName);
    await deps.students.rename(event.payload.userId, fullName);
  });

  // -------------------------------------------------------------------------
  // El alumno activo su kit -> se anota en su matricula
  // -------------------------------------------------------------------------
  //
  // **Nadie escuchaba esto, y era el fallo mas caro de la pantalla del docente.**
  // El kit de la matricula solo se rellenaba si se pasaba al matricular, y el
  // canje ocurre DESPUES: primero el alumno entra al salon y luego teclea el
  // codigo de su libro. Resultado: la columna "kit" de la lista de clase decia
  // "sin activar" para todos, siempre, incluidos los que ya lo habian activado.
  //
  // Y esa es la senal mas util que tiene un docente en las primeras semanas: los
  // libros comprados que nadie activo son dinero que el colegio pago y no usa, y
  // el unico problema que a esas alturas todavia se puede arreglar.
  consumer.on<EntitlementGrantedPayload>(EVENTS.KIT_ENTITLEMENT_GRANTED, async (event, tx) => {
    const payload = event.payload;

    // Se marca en TODAS sus matriculas activas y no solo en una: un alumno puede
    // estar en dos salones -cambio de grupo a mitad de curso- y el kit es del
    // alumno, no del salon.
    await (tx.client as PoolClient).query(
      `UPDATE institutions.enrollments
          SET kit_id = $2
        WHERE student_id = $1 AND status = 'active' AND kit_id IS NULL`,
      [payload.studentId, payload.kitId],
    );
  });

  return consumer;
}

async function upsertTeacher(
  deps: IdentityConsumerDeps,
  payload: UserRegisteredPayload,
): Promise<void> {
  if (!payload.roles.includes(ROLES.TEACHER) || !payload.institutionId) return;

  await deps.teachers.upsert({
    userId: payload.userId,
    institutionId: payload.institutionId,
    fullName: `${payload.firstName} ${payload.lastName}`,
    email: payload.email,
  });
}

/**
 * Contexto de ejecucion para un caso de uso invocado desde un evento.
 *
 * No hay actor humano: la operacion la dispara el sistema al reaccionar a un
 * hecho ya ocurrido. Se conserva el identificador de correlacion para poder
 * enlazar estos logs con los de la peticion HTTP que provoco el registro.
 */
function contextFromEvent(correlationId?: string): ExecutionContext {
  return {
    correlationId: correlationId ?? 'event',
    locale: 'es',
    requestedAt: new Date(),
  };
}
