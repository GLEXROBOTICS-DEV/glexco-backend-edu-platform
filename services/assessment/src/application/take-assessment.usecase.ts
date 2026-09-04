import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { AssessmentId, type StudentQuestion } from '../domain/assessment.aggregate';
import { Submission, SubmissionId } from '../domain/submission.aggregate';
import type { AssessmentRepository, SubmissionRepository } from './ports';

function studentFrom(context: ExecutionContext): { userId: string; institutionId: string | null } {
  const actor = context.actor;
  if (!actor) {
    throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
  }
  return { userId: actor.userId, institutionId: actor.institutionId ?? null };
}

/**
 * Cuando se acaba un intento.
 *
 * Se calcula desde `startedAt`, que es del servidor, y NO desde "ahora": al
 * recargar la pagina se vuelve a pedir el intento abierto, y contando desde
 * ahora el alumno tendria el tiempo entero otra vez cada vez que pulsara F5.
 */
function expiryOf(limitMinutes: number | null, startedAt: Date): string | null {
  if (limitMinutes === null) return null;
  return new Date(startedAt.getTime() + limitMinutes * 60_000).toISOString();
}

export interface StartAttemptOutput {
  submissionId: string;
  attemptNumber: number;
  attemptsLeft: number;
  timeLimitMinutes: number | null;
  /**
   * Instante en que se acaba ESTE intento, en ISO. `null` si no hay limite.
   *
   * Va absoluto y no como "te quedan N minutos" porque el cronometro del
   * navegador tiene que contar contra un instante fijo: si contara los minutos
   * desde que carga la pagina, recargar regalaria el tiempo entero otra vez, y
   * es lo primero que prueba cualquier alumno.
   *
   * Lo calcula el SERVIDOR desde el momento en que se abrio el intento. El
   * cliente solo lo pinta; quien decide si llego tarde sigue siendo el servidor
   * al entregar.
   */
  expiresAt: string | null;
  /** Fecha limite de la evaluacion entera, si la tiene. */
  dueAt: string | null;
  /** Las preguntas SIN la clave de correccion. */
  questions: StudentQuestion[];
}

/**
 * Abre un intento.
 *
 * **El tope de intentos se hace valer con la fila de la evaluacion bloqueada.**
 * Es el mismo patron que el canje del codigo y el tope de plazas del salon, y
 * por el mismo motivo: contar los intentos y despues insertar es la condicion de
 * carrera clasica. Con un alumno pulsando dos veces "empezar" -que pasa
 * constantemente cuando la red va lenta- las dos peticiones contarian "llevas 2
 * de 3" y crearian el tercero y el cuarto.
 *
 * Se bloquea la EVALUACION y no los intentos porque el problema es el intento
 * que todavia no existe, y una fila inexistente no se puede bloquear. La
 * restriccion unica `(assessment_id, student_id, attempt_number)` es la ultima
 * red por si algun dia alguien escribe por otra via.
 *
 * Si ya hay un intento abierto se devuelve ESE, no uno nuevo: al alumno se le
 * cerro el portatil del laboratorio y vuelve, no esta empezando de cero.
 */
export class StartAttemptUseCase implements UseCase<{ assessmentId: string; classroomId?: string | undefined }, StartAttemptOutput> {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: { assessmentId: string; classroomId?: string | undefined },
    context: ExecutionContext,
  ): Promise<StartAttemptOutput> {
    const student = studentFrom(context);
    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const assessment = await this.assessments.findByIdForUpdate(
        AssessmentId.create(input.assessmentId),
        tx,
      );

      if (!assessment) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      // Aislamiento entre instituciones: una evaluacion de otro colegio no
      // existe para este alumno, y el error es el mismo que si no existiera para
      // que no se puedan enumerar probando identificadores.
      if (
        assessment.institutionId !== null &&
        assessment.institutionId !== student.institutionId
      ) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      const open = await this.submissions.findInProgress(assessment.id.value, student.userId);

      // **Fecha limite.** Se guardaba desde el principio y no la comprobaba
      // nadie: se podia abrir y entregar una evaluacion cerrada hace un mes.
      //
      // Solo corta ABRIR uno nuevo. Un intento que ya estaba abierto se puede
      // terminar aunque la fecha pase mientras se responde: cerrarle la puerta a
      // quien esta escribiendo, por haber empezado tres minutos antes del cierre,
      // seria castigarle por algo que el propio sistema le dejo empezar.
      if (!open && assessment.dueAt !== null && now > assessment.dueAt) {
        throw new BusinessRuleError(
          'ASSESSMENT_CLOSED',
          'Esta evaluacion ya cerro y no admite intentos nuevos.',
          { dueAt: assessment.dueAt.toISOString() },
        );
      }

      if (open) {
        // Rellena el salon si el intento se abrio sin el. El caso llega cuando
        // el alumno abre la evaluacion antes de que su matricula este
        // proyectada: sin esto, su entrega no aparece en ninguna bandeja y lo
        // que escriba no lo corrige nadie.
        if (input.classroomId) {
          open.attachClassroom(input.classroomId);
          await this.submissions.save(open, tx);
        }

        return {
          submissionId: open.id.value,
          attemptNumber: open.attemptNumber,
          attemptsLeft: assessment.maxAttempts - open.attemptNumber,
          timeLimitMinutes: assessment.timeLimitMinutes,
          expiresAt: expiryOf(assessment.timeLimitMinutes, open.snapshot().startedAt),
          dueAt: assessment.dueAt ? assessment.dueAt.toISOString() : null,
          questions: assessment.forStudent(),
        };
      }

      const used = await this.submissions.countAttempts(
        assessment.id.value,
        student.userId,
        tx,
      );

      const submission = Submission.start({
        id: SubmissionId.create(this.ids.uuid()),
        assessment,
        studentId: student.userId,
        institutionId: student.institutionId,
        classroomId: input.classroomId ?? null,
        attemptNumber: used + 1,
        now,
      });

      await this.submissions.save(submission, tx);

      this.logger.info('Intento de evaluacion iniciado', {
        assessmentId: assessment.id.value,
        submissionId: submission.id.value,
        studentId: student.userId,
        attempt: used + 1,
        correlationId: context.correlationId,
      });

      return {
        submissionId: submission.id.value,
        attemptNumber: used + 1,
        attemptsLeft: assessment.maxAttempts - (used + 1),
        timeLimitMinutes: assessment.timeLimitMinutes,
        expiresAt: expiryOf(assessment.timeLimitMinutes, submission.snapshot().startedAt),
        dueAt: assessment.dueAt ? assessment.dueAt.toISOString() : null,
        // Aqui esta la garantia que sostiene todo el cuestionario: `forStudent`
        // no devuelve las respuestas correctas. Si las devolviera, verlas seria
        // abrir la pestana de red del navegador.
        questions: assessment.forStudent(),
      };
    });
  }
}

// ---------------------------------------------------------------------------

export interface SaveAnswerInput {
  submissionId: string;
  questionId: string;
  selectedOptionIds?: string[] | undefined;
  text?: string | undefined;
  mediaAssetId?: string | undefined;
}

/** Guarda una respuesta sin entregar, para que un cuestionario largo no se pierda. */
export class SaveAnswerUseCase implements UseCase<SaveAnswerInput, { saved: true }> {
  constructor(
    private readonly submissions: SubmissionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: SaveAnswerInput, context: ExecutionContext): Promise<{ saved: true }> {
    const student = studentFrom(context);
    const now = this.clock.now();

    await this.unitOfWork.run(async (tx) => {
      const submission = await this.submissions.findByIdForUpdate(
        SubmissionId.create(input.submissionId),
        tx,
      );

      if (!submission) {
        throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
      }

      submission.assertOwnedBy(student.userId);
      submission.answer({
        questionId: input.questionId,
        selectedOptionIds: input.selectedOptionIds ?? [],
        text: input.text ?? null,
        mediaAssetId: input.mediaAssetId ?? null,
        now,
      });

      await this.submissions.save(submission, tx);
    });

    return { saved: true };
  }
}

// ---------------------------------------------------------------------------

export interface SubmitAttemptOutput {
  submissionId: string;
  status: string;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  /** `true` si queda parte por corregir a mano. */
  awaitingManualGrading: boolean;
}

/**
 * Entrega el intento y corrige lo automatico.
 *
 * La correccion ocurre **aqui, en el servidor**, con la clave que nunca salio.
 * El alumno ve al instante la nota de lo que era de marcar, que es lo que hace
 * util un cuestionario para aprender: una respuesta que llega tres dias despues
 * ya no se conecta con lo que estaba pensando.
 *
 * Si hay preguntas abiertas o entregas, la nota queda parcial y el estado en
 * `submitted`. No se cierra: decirle a un alumno que suspendio cuando falta la
 * mitad de los puntos por corregir es peor que no decirle nada.
 */
export class SubmitAttemptUseCase implements UseCase<{ submissionId: string }, SubmitAttemptOutput> {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: { submissionId: string },
    context: ExecutionContext,
  ): Promise<SubmitAttemptOutput> {
    const student = studentFrom(context);
    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const submission = await this.submissions.findByIdForUpdate(
        SubmissionId.create(input.submissionId),
        tx,
      );

      if (!submission) {
        throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
      }

      submission.assertOwnedBy(student.userId);

      const assessment = await this.assessments.findByIdForUpdate(
        AssessmentId.create(submission.assessmentId),
        tx,
      );

      if (!assessment) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      const wasInProgress = submission.status === 'in_progress';

      submission.submit(assessment, now);

      // El contador de entregas solo sube la primera vez. Es lo que despues
      // impide cambiar las preguntas, asi que contar de mas congelaria un
      // cuestionario que nadie ha respondido.
      if (wasInProgress) assessment.registerSubmission(now);

      await this.submissions.save(submission, tx);
      if (wasInProgress) await this.assessments.save(assessment, tx);

      (tx as { enqueue(...events: unknown[]): void }).enqueue(...submission.pullDomainEvents());

      const state = submission.snapshot();
      const awaitingManualGrading = submission.status === 'submitted';

      this.logger.info('Intento entregado', {
        submissionId: submission.id.value,
        assessmentId: assessment.id.value,
        studentId: student.userId,
        score: state.score,
        awaitingManualGrading,
        correlationId: context.correlationId,
      });

      return {
        submissionId: submission.id.value,
        status: submission.status,
        score: state.score,
        maxScore: state.maxScore,
        passed: state.passed,
        awaitingManualGrading,
      };
    });
  }
}

// ---------------------------------------------------------------------------

export interface GradeSubmissionInput {
  submissionId: string;
  grades: { questionId: string; points: number; feedback?: string | undefined }[];
  feedback?: string | undefined;
}

/**
 * Correccion manual del docente.
 *
 * Corrige las preguntas indicadas y cierra la nota. Es una sola operacion y no
 * "puntuar" mas "cerrar" por separado: dejarlas sueltas produce entregas
 * puntuadas pero sin nota publicada, que es un estado que nadie mira y en el que
 * las notas se quedan olvidadas hasta que un alumno reclama.
 */
export class GradeSubmissionUseCase
  implements UseCase<GradeSubmissionInput, { submissionId: string; score: number | null; passed: boolean | null }>
{
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: GradeSubmissionInput,
    context: ExecutionContext,
  ): Promise<{ submissionId: string; score: number | null; passed: boolean | null }> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Corregir exige estar autenticado.');
    }

    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const submission = await this.submissions.findByIdForUpdate(
        SubmissionId.create(input.submissionId),
        tx,
      );

      if (!submission) {
        throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
      }

      const assessment = await this.assessments.findById(
        AssessmentId.create(submission.assessmentId),
      );

      if (!assessment) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      // Un docente corrige lo de SU institucion. Sin esta comprobacion, conocer
      // un identificador bastaria para poner nota en otro colegio.
      if (
        assessment.institutionId !== null &&
        assessment.institutionId !== (actor.institutionId ?? null)
      ) {
        throw new ForbiddenError(
          'SUBMISSION_NOT_IN_SCOPE',
          'Ese intento pertenece a otra institucion.',
        );
      }

      for (const grade of input.grades) {
        const question = assessment.findQuestion(grade.questionId);
        if (!question) {
          throw new NotFoundError('QUESTION_NOT_FOUND', 'Esa pregunta no existe.', {
            questionId: grade.questionId,
          });
        }

        submission.gradeQuestion({
          questionId: grade.questionId,
          points: grade.points,
          feedback: grade.feedback ?? null,
          question,
        });
      }

      submission.finaliseGrading(assessment, actor.userId, input.feedback ?? null, now);

      await this.submissions.save(submission, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...submission.pullDomainEvents());

      const state = submission.snapshot();

      this.logger.info('Intento corregido', {
        submissionId: submission.id.value,
        gradedBy: actor.userId,
        score: state.score,
        passed: state.passed,
        correlationId: context.correlationId,
      });

      return {
        submissionId: submission.id.value,
        score: state.score,
        passed: state.passed,
      };
    });
  }
}

// ---------------------------------------------------------------------------

export interface MyAttemptSummary {
  submissionId: string;
  attemptNumber: number;
  status: 'in_progress' | 'submitted' | 'graded';
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  feedback: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
}

export interface MyResultOutput {
  assessmentId: string;
  title: string;
  passingScore: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsLeft: number;
  /** El mejor intento corregido. `null` si aun no ha entregado ninguno. */
  best: MyAttemptSummary | null;
  /** El intento a medias, si lo hay: al volver se sigue, no se abre otro. */
  inProgress: MyAttemptSummary | null;
  attempts: MyAttemptSummary[];
  /** Que le conviene repasar, deducido de lo que fallo. */
  recommendations: string[];
}

/**
 * "Como me fue" en una evaluacion.
 *
 * Existe porque el resultado solo vivia en la pantalla que lo acababa de
 * calcular: al recargar o volver, la pagina abria un intento NUEVO -consumiendo
 * uno de los tres- hasta que el alumno se quedaba sin ninguno y la unica
 * respuesta que veia era "ya agotaste tus intentos". Un intento se gasta cuando
 * el alumno decide volver a intentarlo, nunca por navegar.
 *
 * **No devuelve ni las respuestas correctas ni las explicaciones.** Solo la
 * nota, el estado y las recomendaciones, que se derivan de las preguntas
 * falladas sin decir cual era la buena. La regla es la misma que en
 * `forStudent()`: la clave no cruza esta frontera por ningun camino, y por eso
 * este caso de uso arma su salida a mano en vez de devolver el agregado.
 */
export class MyResultUseCase implements UseCase<{ assessmentId: string }, MyResultOutput> {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
  ) {}

  async execute(
    input: { assessmentId: string },
    context: ExecutionContext,
  ): Promise<MyResultOutput> {
    const student = studentFrom(context);

    const assessment = await this.assessments.findById(AssessmentId.create(input.assessmentId));
    if (!assessment) {
      throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'No encontramos esa evaluacion.');
    }

    const all = await this.submissions.listByStudent(input.assessmentId, student.userId);
    const summaries = all.map((submission) => toSummary(submission));

    const graded = summaries.filter((s) => s.status === 'graded' && s.score !== null);
    // El MEJOR intento y no el ultimo: el tope de intentos existe para que se
    // pueda repasar y mejorar, y quedarse con el ultimo castigaria a quien
    // reintenta y tiene un mal dia.
    const best =
      graded.length > 0
        ? graded.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a))
        : (summaries.find((s) => s.status === 'submitted') ?? null);

    const inProgress = summaries.find((s) => s.status === 'in_progress') ?? null;

    const snapshot = assessment.snapshot();
    const maxAttempts = snapshot.maxAttempts;

    return {
      assessmentId: input.assessmentId,
      title: snapshot.title,
      passingScore: snapshot.passingScore,
      maxAttempts,
      attemptsUsed: all.length,
      attemptsLeft: Math.max(maxAttempts - all.length, 0),
      best,
      inProgress,
      attempts: summaries,
      recommendations: recommendationsFor(best, snapshot.passingScore),
    };
  }
}

function toSummary(submission: Submission): MyAttemptSummary {
  const state = submission.snapshot();
  return {
    submissionId: submission.id.value,
    attemptNumber: state.attemptNumber,
    status: state.status,
    score: state.score,
    maxScore: state.maxScore,
    passed: state.passed,
    feedback: state.feedback,
    submittedAt: state.submittedAt ? state.submittedAt.toISOString() : null,
    gradedAt: state.gradedAt ? state.gradedAt.toISOString() : null,
  };
}

/**
 * Que repasar, a partir de la nota.
 *
 * Deliberadamente genericas y en segunda persona. Decir "fallaste la pregunta 3"
 * exigiria devolver que pregunta era, y de ahi a filtrar la clave hay un paso;
 * ademas, en un cuestionario de tres preguntas, senalar cual se fallo es
 * practicamente decir cual era la buena.
 *
 * El comentario del docente, cuando existe, manda sobre esto: es especifico y
 * viene de alguien que ha visto la entrega.
 */
function recommendationsFor(best: MyAttemptSummary | null, passingScore: number): string[] {
  if (!best || best.score === null || best.maxScore === 0) return [];

  const percentage = Math.round((best.score / best.maxScore) * 100);

  if (percentage >= 90) {
    return ['Lo tienes dominado. Puedes seguir con la siguiente leccion.'];
  }
  if (percentage >= passingScore) {
    return [
      'Aprobaste, pero hay cosas que se te escaparon.',
      'Repasa el material de la leccion antes de seguir: lo siguiente se apoya en esto.',
    ];
  }
  return [
    'Vuelve a ver el tutorial de la leccion y repasa la ficha de trabajo.',
    'Si algo no te cuadra, preguntaselo a tu docente antes de volver a intentarlo.',
  ];
}
