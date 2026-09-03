import type { TransactionContext } from '@glexco/kernel';
import type { XpReason } from './gamification';

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
