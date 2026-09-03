import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  type Clock,
  type CursorPage,
  type CursorQuery,
  type ExecutionContext,
  type LoggerPort,
  type SecureRandom,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { ROLES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
  type AssessmentActor,
  type AssessmentKind,
  type Question,
  type QuestionType,
} from '../domain/assessment.aggregate';
import type { AssessmentRepository } from './ports';

/** Traduce el actor de la peticion al que entiende el dominio. */
function actorFrom(context: ExecutionContext): AssessmentActor {
  const actor = context.actor;
  if (!actor) {
    throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
  }

  return {
    userId: actor.userId,
    institutionId: actor.institutionId ?? null,
    // El personal de GLEXCO es el unico que puede tocar el banco comun. Se
    // deduce del rol y no de un campo de la peticion: aceptarlo del cuerpo
    // permitiria a cualquiera declararse personal de plataforma.
    isPlatformStaff: actor.roles.some(
      (role) =>
        role === ROLES.PLATFORM_OWNER ||
        role === ROLES.PLATFORM_ADMIN ||
        role === ROLES.CONTENT_MANAGER,
    ),
  };
}

export interface CreateAssessmentInput {
  kitId: string;
  courseId?: string | undefined;
  classroomId?: string | undefined;
  kind: AssessmentKind;
  title: string;
  description?: string | undefined;
  passingScore?: number | undefined;
  maxAttempts?: number | undefined;
  timeLimitMinutes?: number | undefined;
  dueAt?: string | undefined;
}

/**
 * Crea una evaluacion.
 *
 * **El origen no se acepta de la peticion: se deduce de quien la crea.** Si
 * viniera en el cuerpo, un docente podria declarar su cuestionario como
 * contenido de GLEXCO y publicarlo a todos los colegios del pais cambiando un
 * solo campo. El personal de plataforma crea contenido comun; todos los demas,
 * contenido de su institucion.
 *
 * Por el mismo motivo la institucion sale del TOKEN y no del cuerpo: es la misma
 * regla que ya protege el alta de personal en identidad.
 */
export class CreateAssessmentUseCase implements UseCase<CreateAssessmentInput, { assessmentId: string }> {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: CreateAssessmentInput,
    context: ExecutionContext,
  ): Promise<{ assessmentId: string }> {
    const actor = actorFrom(context);
    const now = this.clock.now();

    const origin = actor.isPlatformStaff
      ? ASSESSMENT_ORIGIN.GLEXCO
      : ASSESSMENT_ORIGIN.INSTITUTION;

    if (origin === ASSESSMENT_ORIGIN.INSTITUTION && !actor.institutionId) {
      throw new ForbiddenError(
        'ASSESSMENT_INSTITUTION_REQUIRED',
        'Tu cuenta no pertenece a ninguna institucion.',
      );
    }

    const assessment = Assessment.create({
      id: AssessmentId.create(this.ids.uuid()),
      kitId: input.kitId,
      courseId: input.courseId ?? null,
      origin,
      institutionId: origin === ASSESSMENT_ORIGIN.GLEXCO ? null : actor.institutionId!,
      classroomId: input.classroomId ?? null,
      authorId: actor.userId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? '',
      passingScore: input.passingScore ?? 60,
      maxAttempts: input.maxAttempts ?? undefined,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.assessments.save(assessment, tx);
    });

    this.logger.info('Evaluacion creada', {
      assessmentId: assessment.id.value,
      origin,
      kind: input.kind,
      authorId: actor.userId,
      correlationId: context.correlationId,
    });

    return { assessmentId: assessment.id.value };
  }
}

// ---------------------------------------------------------------------------

export interface AddQuestionInput {
  assessmentId: string;
  type: QuestionType;
  prompt: string;
  options?: { text: string }[] | undefined;
  /** Indices, base 0, de las opciones correctas. */
  correctOptions?: number[] | undefined;
  points: number;
  explanation?: string | undefined;
}

/**
 * Anade una pregunta.
 *
 * Las opciones llegan sin identificador y se les asigna aqui, y las correctas se
 * indican por POSICION. Es deliberado: si el cliente mandara los identificadores,
 * podria repetirlos o referirse a opciones de otra pregunta, y habria que
 * validar todo eso. Con posiciones, un indice fuera de rango es el unico error
 * posible y se detecta en una linea.
 */
export class AddQuestionUseCase implements UseCase<AddQuestionInput, { questionId: string }> {
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
  ) {}

  async execute(
    input: AddQuestionInput,
    context: ExecutionContext,
  ): Promise<{ questionId: string }> {
    const actor = actorFrom(context);
    const now = this.clock.now();
    const questionId = this.ids.uuid();

    await this.unitOfWork.run(async (tx) => {
      const assessment = await this.assessments.findByIdForUpdate(
        AssessmentId.create(input.assessmentId),
        tx,
      );

      if (!assessment) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      assessment.assertEditableBy(actor);

      const options = (input.options ?? []).map((option) => ({
        id: this.ids.uuid(),
        text: option.text,
      }));

      const correctOptionIds = (input.correctOptions ?? []).map((index) => {
        const option = options[index];
        if (!option) {
          throw new BusinessRuleError(
            'QUESTION_CORRECT_ANSWER_UNKNOWN',
            'La respuesta correcta senala una opcion que no existe.',
            { index },
          );
        }
        return option.id;
      });

      const question: Question = {
        id: questionId,
        type: input.type,
        prompt: input.prompt,
        options,
        correctOptionIds,
        points: input.points,
        explanation: input.explanation ?? null,
      };

      assessment.addQuestion(question, now);
      await this.assessments.save(assessment, tx);
    });

    return { questionId };
  }
}

// ---------------------------------------------------------------------------

/**
 * Duplica una evaluacion de GLEXCO para adaptarla.
 *
 * Es la respuesta a lo que un docente intenta hacer cuando choca con "no puedes
 * editar esta evaluacion": no quiere romper el banco comun, quiere su propia
 * version. Sin este caso de uso, la unica salida seria copiar las preguntas a
 * mano, que nadie hace y que ademas pierde la trazabilidad de que salio de ahi.
 *
 * La copia nace en BORRADOR aunque el original estuviera publicado: duplicar y
 * que se publique sola en el salon sin que nadie la revise es exactamente lo que
 * no debe pasar.
 */
export class CloneAssessmentUseCase
  implements UseCase<{ assessmentId: string; classroomId?: string | undefined }, { assessmentId: string }>
{
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: SecureRandom,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: { assessmentId: string; classroomId?: string | undefined },
    context: ExecutionContext,
  ): Promise<{ assessmentId: string }> {
    const actor = actorFrom(context);

    if (!actor.institutionId) {
      throw new ForbiddenError(
        'ASSESSMENT_INSTITUTION_REQUIRED',
        'Tu cuenta no pertenece a ninguna institucion.',
      );
    }

    const source = await this.assessments.findById(AssessmentId.create(input.assessmentId));
    if (!source) {
      throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
    }

    // Se puede duplicar el banco comun y lo propio; lo de OTRA institucion no,
    // ni siquiera para copiarlo: sus examenes no son publicos.
    if (
      source.origin === ASSESSMENT_ORIGIN.INSTITUTION &&
      source.institutionId !== actor.institutionId
    ) {
      throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
    }

    const now = this.clock.now();
    const state = source.snapshot();

    const copy = Assessment.create({
      id: AssessmentId.create(this.ids.uuid()),
      kitId: state.kitId,
      courseId: state.courseId,
      origin: ASSESSMENT_ORIGIN.INSTITUTION,
      institutionId: actor.institutionId,
      classroomId: input.classroomId ?? null,
      authorId: actor.userId,
      kind: state.kind,
      title: `${state.title} (copia)`,
      description: state.description,
      passingScore: state.passingScore,
      maxAttempts: state.maxAttempts,
      timeLimitMinutes: state.timeLimitMinutes,
      dueAt: null,
      now,
    });

    // Las preguntas se copian CON identificadores nuevos. Reutilizarlos ataria
    // las respuestas de dos evaluaciones distintas al mismo id, y al depurar una
    // nota nadie sabria a cual pertenece.
    for (const question of source.forAuthor()) {
      const options = question.options.map((option) => ({ id: this.ids.uuid(), text: option.text }));
      const remap = new Map(question.options.map((option, index) => [option.id, options[index]!.id]));

      copy.addQuestion(
        {
          ...question,
          id: this.ids.uuid(),
          options,
          correctOptionIds: question.correctOptionIds.map((id) => remap.get(id)!),
        },
        now,
      );
    }

    await this.unitOfWork.run(async (tx) => {
      await this.assessments.save(copy, tx);
    });

    this.logger.info('Evaluacion duplicada', {
      sourceId: source.id.value,
      copyId: copy.id.value,
      institutionId: actor.institutionId,
      correlationId: context.correlationId,
    });

    return { assessmentId: copy.id.value };
  }
}

// ---------------------------------------------------------------------------

export class PublishAssessmentUseCase
  implements UseCase<{ assessmentId: string }, { assessmentId: string; status: string }>
{
  constructor(
    private readonly assessments: AssessmentRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    input: { assessmentId: string },
    context: ExecutionContext,
  ): Promise<{ assessmentId: string; status: string }> {
    const actor = actorFrom(context);
    const now = this.clock.now();

    return this.unitOfWork.run(async (tx) => {
      const assessment = await this.assessments.findByIdForUpdate(
        AssessmentId.create(input.assessmentId),
        tx,
      );

      if (!assessment) {
        throw new NotFoundError('ASSESSMENT_NOT_FOUND', 'La evaluacion no existe.');
      }

      assessment.assertEditableBy(actor);
      assessment.publish(now);

      await this.assessments.save(assessment, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...assessment.pullDomainEvents());

      return { assessmentId: assessment.id.value, status: assessment.status };
    });
  }
}

// ---------------------------------------------------------------------------

export interface TeacherAssessmentSummary {
  assessmentId: string;
  title: string;
  kind: AssessmentKind;
  origin: string;
  status: string;
  questionCount: number;
  totalPoints: number;
  classroomId: string | null;
  /** `false` en las de GLEXCO: hay que duplicarlas para adaptarlas. */
  editable: boolean;
  dueAt: string | null;
}

/**
 * Banco del docente: lo suyo y lo que viene con el kit.
 *
 * Devuelve `editable` calculado en vez de dejar que el frontend lo deduzca del
 * origen. Si lo dedujera el frontend, cada pantalla tendria que repetir la regla
 * y la primera que se olvidara mostraria un boton de editar que el backend va a
 * rechazar, que es la peor forma de comunicar un permiso.
 */
export class ListAssessmentsUseCase
  implements
    UseCase<
      { kitId?: string | undefined; classroomId?: string | undefined; page: CursorQuery },
      CursorPage<TeacherAssessmentSummary>
    >
{
  constructor(private readonly assessments: AssessmentRepository) {}

  async execute(
    input: { kitId?: string | undefined; classroomId?: string | undefined; page: CursorQuery },
    context: ExecutionContext,
  ): Promise<CursorPage<TeacherAssessmentSummary>> {
    const actor = actorFrom(context);

    if (!actor.institutionId && !actor.isPlatformStaff) {
      throw new ForbiddenError(
        'ASSESSMENT_INSTITUTION_REQUIRED',
        'Tu cuenta no pertenece a ninguna institucion.',
      );
    }

    const page = await this.assessments.listForTeacher({
      kitId: input.kitId,
      institutionId: actor.institutionId ?? '',
      classroomId: input.classroomId,
      page: input.page,
    });

    return {
      items: page.items.map((assessment) => {
        const state = assessment.snapshot();
        return {
          assessmentId: assessment.id.value,
          title: state.title,
          kind: state.kind,
          origin: state.origin,
          status: state.status,
          questionCount: state.questions.length,
          totalPoints: assessment.totalPoints,
          classroomId: state.classroomId,
          editable:
            state.origin === ASSESSMENT_ORIGIN.INSTITUTION
              ? state.institutionId === actor.institutionId
              : actor.isPlatformStaff,
          dueAt: state.dueAt?.toISOString() ?? null,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }
}
