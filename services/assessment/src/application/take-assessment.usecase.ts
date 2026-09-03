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

export interface StartAttemptOutput {
  submissionId: string;
  attemptNumber: number;
  attemptsLeft: number;
  timeLimitMinutes: number | null;
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

      if (open) {
        return {
          submissionId: open.id.value,
          attemptNumber: open.attemptNumber,
          attemptsLeft: assessment.maxAttempts - open.attemptNumber,
          timeLimitMinutes: assessment.timeLimitMinutes,
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
