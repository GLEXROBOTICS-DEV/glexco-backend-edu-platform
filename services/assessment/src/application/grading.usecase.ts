import {
  DEFAULT_PAGE_SIZE,
  ForbiddenError,
  NotFoundError,
  type CursorQuery,
  type ExecutionContext,
  type UseCase,
} from '@glexco/kernel';
import { ROLES, isPlatformRole, type Role } from '@glexco/contracts';
import { AssessmentId, type Question } from '../domain/assessment.aggregate';
import { SubmissionId } from '../domain/submission.aggregate';
import type { ClassroomDirectory } from './directory';
import type { AssessmentRepository, SubmissionRepository } from './ports';

/**
 * La bandeja de correccion del docente.
 *
 * Existe porque la correccion automatica solo cubre lo de marcar. Todo lo
 * abierto -una respuesta escrita, una foto del robot montado, el enlace al
 * video de la expo- queda en `submitted` esperando a una persona, y sin una
 * bandeja esas entregas no aparecen en ningun sitio: el docente tendria que
 * acordarse de mirar alumno por alumno.
 */

function actorProfile(context: ExecutionContext) {
  const actor = context.actor;
  if (!actor) {
    throw new ForbiddenError('UNAUTHENTICATED', 'Debes iniciar sesion.');
  }

  const roles = actor.roles as Role[];
  return {
    userId: actor.userId,
    institutionId: actor.institutionId ?? null,
    isPlatformStaff: roles.some((role) => isPlatformRole(role)),
    isInstitutionAdmin: roles.includes(ROLES.INSTITUTION_ADMIN),
    isTeacher: roles.includes(ROLES.TEACHER),
  };
}

/**
 * Comprueba el ambito sobre el salon concreto.
 *
 * El guard ya dijo que este actor puede corregir; esto dice que puede corregir
 * AQUI. Las dos comprobaciones son necesarias y ninguna sustituye a la otra:
 * sin la segunda, un docente que teclee el identificador de un salon de otro
 * colegio veria las entregas de sus alumnos, con sus respuestas escritas.
 */
async function assertClassroomInScope(
  directory: ClassroomDirectory,
  classroomId: string,
  actor: ReturnType<typeof actorProfile>,
): Promise<void> {
  const scope = await directory.find(classroomId);

  // El mismo error que si no existiera, para que no se puedan enumerar salones
  // probando identificadores y distinguiendo un 403 de un 404.
  if (!scope) {
    throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no existe.');
  }

  if (actor.isPlatformStaff) return;

  if (scope.institutionId !== actor.institutionId) {
    throw new NotFoundError('CLASSROOM_NOT_FOUND', 'Ese salon no existe.');
  }

  // Un administrador de institucion ve todos los salones de SU colegio; un
  // docente, solo aquellos de los que es titular.
  if (actor.isInstitutionAdmin) return;

  if (scope.teacherId !== actor.userId) {
    throw new ForbiddenError('CLASSROOM_NOT_YOURS', 'Ese salon no es tuyo.');
  }
}

// ---------------------------------------------------------------------------
// Listado de pendientes
// ---------------------------------------------------------------------------

export interface PendingSubmission {
  submissionId: string;
  assessmentId: string;
  assessmentTitle: string;
  kind: string;
  origin: string;
  studentId: string;
  attemptNumber: number;
  submittedAt: string | null;
  /** Lo que ya puso la maquina. Puede ser 0 si todo era abierto. */
  autoScore: number | null;
  maxScore: number;
  /** Preguntas que faltan por puntuar. Es el trabajo real que queda. */
  pendingQuestions: number;
}

export class ListPendingSubmissionsUseCase
  implements
    UseCase<
      { classroomId: string; cursor?: string | undefined; limit?: number | undefined },
      { items: PendingSubmission[]; nextCursor: string | null }
    >
{
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
    private readonly directory: ClassroomDirectory,
  ) {}

  async execute(
    input: { classroomId: string; cursor?: string | undefined; limit?: number | undefined },
    context: ExecutionContext,
  ): Promise<{ items: PendingSubmission[]; nextCursor: string | null }> {
    const actor = actorProfile(context);
    await assertClassroomInScope(this.directory, input.classroomId, actor);

    const page: CursorQuery = {
      limit: input.limit ?? DEFAULT_PAGE_SIZE,
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    };

    const pending = await this.submissions.listPendingForClassroom(input.classroomId, page);

    // Las evaluaciones se cargan en UNA consulta para todo el listado, y no una
    // por fila: una clase de treinta que entrega el mismo examen produciria
    // treinta consultas identicas.
    const ids = [...new Set(pending.items.map((submission) => submission.assessmentId))];
    const assessments = ids.length > 0 ? await this.assessments.findManyByIds(ids) : [];
    const byId = new Map(assessments.map((assessment) => [assessment.id.value, assessment]));

    return {
      items: pending.items.map((submission) => {
        const state = submission.snapshot();
        const assessment = byId.get(submission.assessmentId);

        return {
          submissionId: submission.id.value,
          assessmentId: submission.assessmentId,
          // Si la evaluacion no aparece, la fila sale igual: perder de vista una
          // entrega es peor que mostrarla sin titulo.
          assessmentTitle: assessment?.title ?? 'Evaluacion',
          kind: assessment?.kind ?? 'quiz',
          origin: assessment?.origin ?? 'glexco',
          studentId: state.studentId,
          attemptNumber: state.attemptNumber,
          submittedAt: state.submittedAt ? state.submittedAt.toISOString() : null,
          autoScore: state.score,
          maxScore: state.maxScore,
          pendingQuestions: state.answers.filter((answer) => answer.awardedPoints === null).length,
        };
      }),
      nextCursor: pending.nextCursor,
    };
  }
}

// ---------------------------------------------------------------------------
// Una entrega, para corregirla
// ---------------------------------------------------------------------------

export interface GradableQuestion {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  /** Aqui SI viaja la clave: quien la recibe es quien corrige. */
  correctOptionIds: string[];
  explanation: string | null;
  /** Lo que respondio el alumno. */
  answer: {
    selectedOptionIds: string[];
    text: string | null;
    mediaAssetId: string | null;
    awardedPoints: number | null;
    feedback: string | null;
  } | null;
  /** `true` si la maquina no puede puntuarla y hace falta una persona. */
  needsManualGrading: boolean;
}

export interface SubmissionForGrading {
  submissionId: string;
  assessmentId: string;
  assessmentTitle: string;
  passingScore: number;
  studentId: string;
  classroomId: string | null;
  attemptNumber: number;
  status: string;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  feedback: string | null;
  submittedAt: string | null;
  questions: GradableQuestion[];
}

/**
 * Devuelve la entrega CON la clave de correccion.
 *
 * Es el unico camino por el que la clave sale del servicio, y lo hace hacia
 * quien corrige, nunca hacia el alumno. Que la comprobacion sea
 * `assertClassroomInScope` -y no "es tu entrega"- es justamente lo que impide
 * que un alumno consulte la suya por aqui: tendria el examen resuelto.
 */
export class GetSubmissionForGradingUseCase
  implements UseCase<{ submissionId: string }, SubmissionForGrading>
{
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly submissions: SubmissionRepository,
    private readonly directory: ClassroomDirectory,
  ) {}

  async execute(
    input: { submissionId: string },
    context: ExecutionContext,
  ): Promise<SubmissionForGrading> {
    const actor = actorProfile(context);

    const submission = await this.submissions.findById(SubmissionId.create(input.submissionId));
    if (!submission) {
      throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
    }

    const state = submission.snapshot();

    // Una entrega sin salon es de un alumno independiente: no tiene docente que
    // la corrija, asi que no hay ambito posible y la respuesta correcta es que
    // no existe para nadie.
    if (!state.classroomId) {
      throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
    }

    await assertClassroomInScope(this.directory, state.classroomId, actor);

    const assessment = await this.assessments.findById(AssessmentId.create(submission.assessmentId));
    if (!assessment) {
      throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
    }

    const answers = new Map(state.answers.map((answer) => [answer.questionId, answer]));

    return {
      submissionId: submission.id.value,
      assessmentId: assessment.id.value,
      assessmentTitle: assessment.title,
      passingScore: assessment.snapshot().passingScore,
      studentId: state.studentId,
      classroomId: state.classroomId,
      attemptNumber: state.attemptNumber,
      status: state.status,
      score: state.score,
      maxScore: state.maxScore,
      passed: state.passed,
      feedback: state.feedback,
      submittedAt: state.submittedAt ? state.submittedAt.toISOString() : null,
      questions: assessment.forAuthor().map((question: Question) => {
        const answer = answers.get(question.id) ?? null;

        return {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          options: question.options.map((option) => ({ id: option.id, text: option.text })),
          points: question.points,
          correctOptionIds: question.correctOptionIds,
          explanation: question.explanation,
          answer: answer
            ? {
                selectedOptionIds: answer.selectedOptionIds,
                text: answer.text,
                mediaAssetId: answer.mediaAssetId,
                awardedPoints: answer.awardedPoints,
                feedback: answer.feedback,
              }
            : null,
          // Una pregunta de marcar ya la puntuo la maquina; lo que necesita una
          // persona es lo abierto y las entregas de archivo.
          needsManualGrading: question.correctOptionIds.length === 0,
        };
      }),
    };
  }
}
