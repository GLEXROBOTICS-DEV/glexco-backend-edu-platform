import type { TransactionContext } from '@glexco/kernel';
import type { XpReason } from './gamification';
import type { Mission, StudentFacts } from './mission';

export interface LessonProgressRow {
  studentId: string;
  lessonId: string;
  courseId: string;
  kitId: string;
  classroomId: string | null;
  startedAt: string;
  completedAt: string | null;
  secondsSpent: number;
}

export interface CourseProgressView {
  courseId: string;
  kitId: string;
  title: string;
  lessonCount: number;
  lessonsCompleted: number;
  lessonsStarted: number;
  lastActivityAt: string | null;
}

export interface StudentProgressView {
  studentId: string;
  totalXp: number;
  explorerLevel: number;
  levelName: string;
  xpToNext: number | null;
  nextLevelName: string | null;
  lessonsCompleted: number;
  coursesCompleted: number;
  badges: { code: string; name: string; category: string; awardedAt: string }[];
  courses: CourseProgressView[];
}

/** Una fila de la lista "quien se ha descolgado". */
export interface ClassroomProgressRow {
  studentId: string;
  fullName: string;
  lessonsCompleted: number;
  lessonsStarted: number;
  lastActivityAt: string | null;
  /** Sin actividad reciente. La regla vive en el dominio, no en la consulta. */
  stale: boolean;
}

export interface LearningRepository {
  /**
   * Abre o reabre una leccion. Idempotente: reabrir no reinicia el comienzo ni
   * borra la finalizacion, porque volver a consultar algo ya aprendido es
   * normal y no es un retroceso.
   */
  startLesson(input: {
    studentId: string;
    lessonId: string;
    /** Resuelto por el propio servicio desde `lesson_directory`, NUNCA tomado de
     *  la peticion: aceptarlo permitiria a un alumno atribuirse progreso en un
     *  curso que no es el suyo, y con el, el XP de completarlo. */
    courseId: string;
    kitId: string;
    classroomId: string | null;
    institutionId: string | null;
    now: Date;
  }): Promise<{ alreadyCompleted: boolean }>;

  /** Marca completada. Devuelve `false` si ya lo estaba: quien llama distingue
   *  asi un hito nuevo -que paga XP- de un reintento, que no. */
  completeLesson(input: {
    studentId: string;
    lessonId: string;
    secondsSpent: number;
    now: Date;
    tx: TransactionContext;
  }): Promise<{ firstCompletion: boolean; courseId: string; kitId: string }>;

  /** Cuantas lecciones del curso ha completado, y cuantas tiene. Es lo que
   *  decide si el curso entero acaba de completarse. */
  courseCompletion(
    studentId: string,
    courseId: string,
    tx?: TransactionContext,
  ): Promise<{ completed: number; total: number }>;

  progressFor(studentId: string): Promise<StudentProgressView>;

  classroomProgress(classroomId: string, now: Date): Promise<ClassroomProgressRow[]>;

  /** Salones del actor: por matricula si es alumno, por asignacion si es docente. */
  classroomsFor(userId: string): Promise<{ classroomId: string; teacherId: string | null }[]>;

  /** El curso y el kit a los que pertenece una leccion, segun el directorio
   *  propio. `null` si la leccion no esta publicada o todavia no se proyecto. */
  locateLesson(lessonId: string): Promise<{ courseId: string; kitId: string } | null>;
}

export interface MissionRepository {
  /**
   * Las misiones publicadas de un kit, ordenadas por semana.
   *
   * Devuelve las de GLEXCO mas las de la institucion del alumno, si tiene. Hoy
   * solo hay de GLEXCO; el parametro existe desde el principio porque el
   * alcance es lo ultimo que se debe anadir despues, cuando ya hay pantallas
   * leyendo sin filtro.
   */
  publishedForKit(kitId: string, institutionId: string | null): Promise<Mission[]>;

  /**
   * Lo que la plataforma ya sabe del alumno, medido de los HECHOS.
   *
   * No hay tabla de progreso de misiones: esto sale de `lesson_progress` y de
   * `xp_awards`. Ver la nota de `domain/mission.ts`.
   */
  factsFor(studentId: string, kitId: string): Promise<StudentFacts>;

  /** Que misiones ya cobro, y cuando. Sale de `xp_awards`. */
  completionsFor(studentId: string): Promise<Map<string, Date>>;
}

export interface GamificationRepository {
  /**
   * Concede XP de forma idempotente por (alumno, motivo, referencia).
   *
   * Devuelve `false` si ya estaba concedido. Sin esta garantia, reabrir una
   * leccion completada o un evento reentregado regalan puntos, y un contador que
   * se puede inflar deja de significar nada para quien se lo gano.
   */
  award(input: {
    id: string;
    studentId: string;
    reason: XpReason;
    reference: string;
    points: number;
    now: Date;
    tx: TransactionContext;
  }): Promise<boolean>;

  /** Recalcula el resumen ENTERO desde los hechos. Nunca suma incrementos: un
   *  evento entregado dos veces no puede inflar un total que se recalcula. */
  refreshSummary(studentId: string, tx: TransactionContext): Promise<{
    totalXp: number;
    explorerLevel: number;
    lessonsCompleted: number;
    coursesCompleted: number;
    assessmentsPassed: number;
  }>;

  badgesOf(studentId: string, tx?: TransactionContext): Promise<string[]>;

  grantBadges(
    studentId: string,
    badges: { code: string; category: string }[],
    tx: TransactionContext,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

export interface CertificateRow {
  id: string;
  serial: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  kitId: string;
  institutionName: string | null;
  completion: number;
  issuedAt: string;
  signature: string;
  keyFingerprint: string;
  issuedBy: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

/**
 * Lo que hace falta saber para emitir, y que no esta en el certificado.
 *
 * Se pide en UNA consulta y no campo a campo: emitir en masa recorre treinta
 * alumnos, y con cuatro consultas por alumno serian ciento veinte viajes a la
 * base para una operacion que el docente lanza pulsando un boton.
 */
export interface CertificateEligibility {
  studentName: string;
  courseTitle: string;
  kitId: string;
  institutionName: string | null;
  lessonsCompleted: number;
  lessonCount: number;
}

export interface CertificateRepository {
  /** El certificado vigente de ese alumno y ese curso, si lo hay. */
  findActive(studentId: string, courseId: string): Promise<CertificateRow | null>;
  findBySerial(serial: string): Promise<CertificateRow | null>;
  listByStudent(studentId: string): Promise<CertificateRow[]>;
  insert(row: CertificateRow): Promise<void>;

  /** `null` si el alumno no tiene ese curso: no existe, o no es suyo. */
  eligibility(studentId: string, courseId: string): Promise<CertificateEligibility | null>;

  /** Los alumnos activos de un salon, para la emision masiva. */
  classroomStudents(classroomId: string): Promise<string[]>;
}
