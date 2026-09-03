import {
  ForbiddenError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { BADGE_RULES, XP_VALUES, levelFor, newBadgesFor } from '../domain/gamification';
import type {
  ClassroomProgressRow,
  GamificationRepository,
  LearningRepository,
  StudentProgressView,
} from '../domain/repositories';

/**
 * Progreso por consumo de contenido.
 *
 * **Por que existe si ya hay analitica.** El progreso que mide aprendizaje se
 * mide con evaluaciones, y de eso se ocupa analytics. Lo que falta es la senal
 * TEMPRANA: quien se descolgo antes del primer examen. Un alumno que lleva dos
 * semanas sin terminar una leccion se detecta aqui; en analytics no aparece
 * hasta que suspende, que es cuando ya es tarde para ayudarle.
 *
 * El `studentId` sale SIEMPRE del token, nunca de un parametro: aceptarlo de la
 * peticion permitiria a cualquiera marcar lecciones -y cobrar XP- en nombre de
 * otro.
 */

export interface StartLessonInput {
  lessonId: string;
  classroomId?: string | null;
}

export class StartLessonUseCase
  implements UseCase<StartLessonInput, { alreadyCompleted: boolean }>
{
  constructor(
    private readonly learning: LearningRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: StartLessonInput,
    context: ExecutionContext,
  ): Promise<{ alreadyCompleted: boolean }> {
    const actor = context.actor!;

    // El curso y el kit se RESUELVEN aqui, desde el directorio propio del
    // servicio, y no vienen en la peticion. Aceptarlos del cliente permitiria a
    // un alumno atribuirse progreso en un curso que no es el suyo, y con el, los
    // 150 puntos de completarlo.
    const located = await this.learning.locateLesson(input.lessonId);
    if (!located) {
      throw new NotFoundError(
        'LESSON_NOT_FOUND',
        'Esa leccion no esta disponible.',
      );
    }

    // Reabrir NO reinicia nada ni retrocede el estado: volver a consultar algo
    // ya aprendido es lo normal, y un contador que se resetea al repasar
    // castigaria exactamente el habito que se quiere fomentar.
    return this.learning.startLesson({
      studentId: actor.userId,
      lessonId: input.lessonId,
      courseId: located.courseId,
      kitId: located.kitId,
      classroomId: input.classroomId ?? null,
      institutionId: actor.institutionId ?? null,
      now: this.clock.now(),
    });
  }
}

export interface CompleteLessonInput {
  lessonId: string;
  secondsSpent?: number;
}

export interface CompleteLessonOutput {
  /** `false` cuando ya estaba completada. Quien llama distingue un hito nuevo de
   *  un reintento sin tratar el segundo como error. */
  firstCompletion: boolean;
  xpAwarded: number;
  totalXp: number;
  explorerLevel: number;
  levelName: string;
  /** Nivel recien alcanzado, para celebrarlo. `null` si no subio. */
  levelUp: string | null;
  newBadges: { code: string; name: string; description: string }[];
  courseCompleted: boolean;
}

/**
 * Marca una leccion como completada y reparte lo que corresponda.
 *
 * TODO ocurre en una transaccion: el hito, el XP, el resumen y las insignias.
 * Si el XP se concediera fuera, un fallo entre ambos pasos dejaria una leccion
 * completada sin sus puntos, y el alumno no tendria forma de reclamarlos: no hay
 * "volver a completar" algo que ya esta completado.
 */
export class CompleteLessonUseCase
  implements UseCase<CompleteLessonInput, CompleteLessonOutput>
{
  constructor(
    private readonly learning: LearningRepository,
    private readonly gamification: GamificationRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: CompleteLessonInput,
    context: ExecutionContext,
  ): Promise<CompleteLessonOutput> {
    const studentId = context.actor!.userId;
    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const previous = await this.gamification.refreshSummary(studentId, tx);

      const done = await this.learning.completeLesson({
        studentId,
        lessonId: input.lessonId,
        // Se acota: el navegador puede quedarse abierto toda la noche, y un dato
        // de ocho horas en una leccion de quince minutos no informa de nada y
        // ademas ensucia cualquier media que alguien calcule despues.
        secondsSpent: Math.min(Math.max(input.secondsSpent ?? 0, 0), 4 * 3600),
        now,
        tx,
      });

      if (!done.firstCompletion) {
        // Reintento: ni XP, ni insignias, ni evento. Se devuelve el estado tal
        // como esta, que es lo que la pantalla necesita para no mentir.
        const level = levelFor(previous.totalXp);
        return {
          firstCompletion: false,
          xpAwarded: 0,
          totalXp: previous.totalXp,
          explorerLevel: level.level,
          levelName: level.name,
          levelUp: null,
          newBadges: [],
          courseCompleted: false,
        };
      }

      let xpAwarded = 0;

      if (
        await this.gamification.award({
          id: this.ids.uuid(),
          studentId,
          reason: 'lesson_completed',
          reference: input.lessonId,
          points: XP_VALUES.lesson_completed,
          now,
          tx,
        })
      ) {
        xpAwarded += XP_VALUES.lesson_completed;
      }

      // El curso entero. Se comprueba DENTRO de la transaccion: si se hiciera
      // fuera, dos lecciones terminadas a la vez -que pasa en clase- verian
      // ambas "faltaba una" y ninguna otorgaria el premio del curso.
      const course = await this.learning.courseCompletion(studentId, done.courseId, tx);
      const courseCompleted = course.total > 0 && course.completed >= course.total;

      if (
        courseCompleted &&
        (await this.gamification.award({
          id: this.ids.uuid(),
          studentId,
          reason: 'course_completed',
          reference: done.courseId,
          points: XP_VALUES.course_completed,
          now,
          tx,
        }))
      ) {
        xpAwarded += XP_VALUES.course_completed;
      }

      const summary = await this.gamification.refreshSummary(studentId, tx);
      const owned = await this.gamification.badgesOf(studentId, tx);

      const earned = newBadgesFor(
        {
          lessonsCompleted: summary.lessonsCompleted,
          coursesCompleted: summary.coursesCompleted,
          assessmentsPassed: summary.assessmentsPassed,
          totalXp: summary.totalXp,
        },
        owned,
      );

      if (earned.length > 0) {
        await this.gamification.grantBadges(
          studentId,
          earned.map((badge) => ({ code: badge.code, category: badge.category })),
          tx,
        );
      }

      const before = levelFor(previous.totalXp);
      const after = levelFor(summary.totalXp);

      this.logger.info('Leccion completada', {
        studentId,
        lessonId: input.lessonId,
        xpAwarded,
        courseCompleted,
      });

      return {
        firstCompletion: true,
        xpAwarded,
        totalXp: summary.totalXp,
        explorerLevel: after.level,
        levelName: after.name,
        levelUp: after.level > before.level ? after.name : null,
        newBadges: earned.map((badge) => ({
          code: badge.code,
          name: badge.name,
          description: badge.description,
        })),
        courseCompleted,
      };
    });
  }
}

/** El progreso propio. El alcance sale del token: nunca de un parametro. */
export class GetMyProgressUseCase implements UseCase<void, StudentProgressView> {
  constructor(private readonly learning: LearningRepository) {}

  async execute(_input: void, context: ExecutionContext): Promise<StudentProgressView> {
    return this.learning.progressFor(context.actor!.userId);
  }
}

/**
 * Quien de mi salon se ha descolgado.
 *
 * Es la razon de ser de este servicio. La comprobacion es doble, como en el
 * resto de la plataforma: el guard dice que el actor puede leer progreso de un
 * salon, y este caso de uso dice si ESE salon es suyo.
 *
 * **No devuelve un ranking.** Devuelve quien lleva tiempo sin avanzar, que es
 * accionable, en vez de una lista ordenada de mejor a peor, que solo senala. Es
 * la misma regla que gobierna los dashboards: el progreso celebra logros y no
 * expone rezagos, y menos entre menores.
 */
export class GetClassroomProgressUseCase
  implements UseCase<{ classroomId: string }, { items: ClassroomProgressRow[]; staleAfterDays: number }>
{
  constructor(
    private readonly learning: LearningRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: { classroomId: string },
    context: ExecutionContext,
  ): Promise<{ items: ClassroomProgressRow[]; staleAfterDays: number }> {
    const actor = context.actor!;
    const scope = await this.learning.classroomsFor(actor.userId);

    const mine = scope.some((row) => row.classroomId === input.classroomId);
    if (!mine) {
      throw new ForbiddenError(
        'CLASSROOM_NOT_IN_SCOPE',
        'Ese salon no esta en tu ambito.',
      );
    }

    return {
      items: await this.learning.classroomProgress(input.classroomId, this.clock.now()),
      // El umbral viaja CON los datos y no como un pie de pantalla: un pie se
      // pierde al copiar la tabla a una reunion, y ahi es donde "descolgado"
      // pasa a significar algo sobre un nino concreto.
      staleAfterDays: 14,
    };
  }
}

export { BADGE_RULES };
