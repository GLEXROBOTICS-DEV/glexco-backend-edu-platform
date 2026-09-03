import {
  AggregateRoot,
  BusinessRuleError,
  DomainEvent,
  ForbiddenError,
  Guard,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import {
  ASSESSMENT_TYPES,
  EVENTS,
  QUESTION_TYPES,
  type AssessmentType,
  type PublicationStatus,
  type QuestionType,
} from '@glexco/contracts';

export class AssessmentId extends defineId('Assessment') {}

const AGGREGATE = 'Assessment';

/**
 * De donde sale una evaluacion.
 *
 * Es la distincion que gobierna todo este agregado y no un campo informativo:
 *
 * - `glexco`: la produce el equipo academico y **es la misma para todos los
 *   colegios**, igual que los tutoriales en video. Viene con el kit.
 * - `institution`: la crea un docente para SU salon.
 *
 * De ahi sale la regla que mas veces se intentara saltar: un docente **no puede
 * modificar** una evaluacion de GLEXCO, porque no es suya y tocarla cambiaria el
 * examen de todos los colegios del pais. Lo que si puede es **duplicarla** y
 * adaptar la copia, que es lo que de verdad quiere hacer cuando lo intenta.
 */
export const ASSESSMENT_ORIGIN = {
  GLEXCO: 'glexco',
  INSTITUTION: 'institution',
} as const;
export type AssessmentOrigin = (typeof ASSESSMENT_ORIGIN)[keyof typeof ASSESSMENT_ORIGIN];

/**
 * Los tipos vienen del vocabulario compartido, no se redefinen aqui.
 *
 * `quiz` es el cuestionario de marcar tipo Coursera; `practical`, `project` y
 * `stem_activity` son entregables que corrige una persona.
 */
export const ASSESSMENT_KIND = ASSESSMENT_TYPES;
export type AssessmentKind = AssessmentType;

export const QUESTION_TYPE = QUESTION_TYPES;
export type { QuestionType };

/**
 * Tipos que la maquina puede corregir sola.
 *
 * `ordering` y `matching` existen en el vocabulario pero NO estan aqui: su
 * correccion no esta escrita todavia, y meterlos en la lista haria que se
 * puntuaran a cero silenciosamente. Fuera de la lista se tratan como manuales,
 * que es el comportamiento correcto mientras no exista el algoritmo.
 */
const AUTO_GRADABLE: readonly QuestionType[] = [
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.TRUE_FALSE,
];

export function isAutoGradable(type: QuestionType): boolean {
  return AUTO_GRADABLE.includes(type);
}

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /** Vacio en las preguntas abiertas y de entrega. */
  options: QuestionOption[];
  /**
   * La clave de correccion.
   *
   * **Nunca sale del servidor hacia un alumno.** Ver `forStudent()`.
   */
  correctOptionIds: string[];
  points: number;
  /** Se muestra DESPUES de corregir, nunca antes. */
  explanation: string | null;
}

/** La misma pregunta, sin la clave. Es lo unico que puede ver un alumno. */
export interface StudentQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  points: number;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface AssessmentPublishedPayload {
  assessmentId: string;
  kitId: string;
  origin: AssessmentOrigin;
  institutionId: string | null;
  classroomId: string | null;
  kind: AssessmentKind;
  title: string;
  questionCount: number;
  publishedAt: string;
}

export class AssessmentPublished extends DomainEvent<AssessmentPublishedPayload> {
  constructor(payload: AssessmentPublishedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.ASSESSMENT_PUBLISHED, AGGREGATE, payload.assessmentId, version, payload, context);
  }
}

// ---------------------------------------------------------------------------

interface AssessmentState {
  kitId: string;
  courseId: string | null;
  origin: AssessmentOrigin;
  /** `null` en las de GLEXCO: son de todos. */
  institutionId: string | null;
  /** `null` = disponible para todos los salones de la institucion. */
  classroomId: string | null;
  authorId: string;
  kind: AssessmentKind;
  title: string;
  description: string;
  questions: Question[];
  /** Porcentaje necesario para aprobar, de 0 a 100. */
  passingScore: number;
  maxAttempts: number;
  timeLimitMinutes: number | null;
  dueAt: Date | null;
  status: PublicationStatus;
  /** Cuantas entregas hay. Decide si el cuestionario todavia puede cambiar. */
  submissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentActor {
  userId: string;
  institutionId?: string | null;
  /** `true` para el personal de GLEXCO. */
  isPlatformStaff: boolean;
}

/**
 * Una evaluacion: cuestionario, tarea o examen.
 *
 * Las tres invariantes que sostiene, en orden de gravedad si se rompen:
 *
 * 1. **La clave de correccion no llega nunca al alumno.** Un cuestionario cuyas
 *    respuestas correctas viajan al navegador no evalua nada: basta mirar la
 *    respuesta de red. `forStudent()` es el unico camino por el que una pregunta
 *    sale hacia un alumno, y ahi la clave no existe.
 *
 * 2. **Un docente no toca una evaluacion de GLEXCO.** Es la misma para todos los
 *    colegios; editarla cambiaria el examen de todo el pais. Puede duplicarla.
 *
 * 3. **Un cuestionario con entregas ya no cambia de preguntas.** Cambiarlas
 *    invalidaria en silencio las notas ya puestas: el alumno respondio a otra
 *    cosa. Se archiva y se crea una version nueva.
 */
export class Assessment extends AggregateRoot<AssessmentId> {
  private constructor(
    id: AssessmentId,
    private state: AssessmentState,
  ) {
    super(id);
  }

  static create(input: {
    id: AssessmentId;
    kitId: string;
    courseId?: string | null;
    origin: AssessmentOrigin;
    institutionId: string | null;
    classroomId?: string | null;
    authorId: string;
    kind: AssessmentKind;
    title: string;
    description?: string;
    passingScore?: number;
    maxAttempts?: number;
    timeLimitMinutes?: number | null;
    dueAt?: Date | null;
    now: Date;
  }): Assessment {
    Guard.againstEmpty(input.title, 'title');
    Guard.againstEmpty(input.kitId, 'kitId');

    // Una evaluacion de institucion sin institucion no tiene dueno, y una de
    // GLEXCO con institucion dejaria de ser comun a todos. Los dos casos son
    // datos corruptos que despues nadie sabe interpretar.
    if (input.origin === ASSESSMENT_ORIGIN.INSTITUTION && !input.institutionId) {
      throw new BusinessRuleError(
        'ASSESSMENT_INSTITUTION_REQUIRED',
        'Una evaluacion de institucion necesita una institucion.',
      );
    }
    if (input.origin === ASSESSMENT_ORIGIN.GLEXCO && input.institutionId) {
      throw new BusinessRuleError(
        'ASSESSMENT_GLEXCO_IS_GLOBAL',
        'Una evaluacion de GLEXCO es comun a todas las instituciones.',
      );
    }

    const passingScore = input.passingScore ?? 60;
    if (passingScore < 0 || passingScore > 100) {
      throw new BusinessRuleError(
        'ASSESSMENT_PASSING_SCORE_INVALID',
        'La nota de aprobacion va de 0 a 100.',
      );
    }

    const assessment = new Assessment(input.id, {
      kitId: input.kitId,
      courseId: input.courseId ?? null,
      origin: input.origin,
      institutionId: input.institutionId,
      classroomId: input.classroomId ?? null,
      authorId: input.authorId,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      questions: [],
      passingScore,
      // Por defecto un solo intento en examen y tres en cuestionario: el
      // cuestionario es para aprender -reintentar es parte de eso- y el examen
      // es para medir.
      // Un cuestionario es para aprender -reintentar es parte de eso- y un
      // entregable se entrega una vez.
      maxAttempts: input.maxAttempts ?? (input.kind === ASSESSMENT_TYPES.QUIZ ? 3 : 1),
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      dueAt: input.dueAt ?? null,
      status: 'draft',
      submissionCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });

    assessment.touch();
    return assessment;
  }

  static rehydrate(id: AssessmentId, state: AssessmentState, version: number): Assessment {
    const assessment = new Assessment(id, state);
    assessment.setVersion(version);
    return assessment;
  }

  /**
   * Comprueba que el actor puede EDITAR esta evaluacion.
   *
   * Es la regla 2, y esta aqui y no en el guard de permisos porque el guard sabe
   * que un docente puede "editar evaluaciones" pero no de cual estamos hablando.
   * Las dos comprobaciones hacen falta.
   */
  assertEditableBy(actor: AssessmentActor): void {
    if (this.state.origin === ASSESSMENT_ORIGIN.GLEXCO) {
      if (!actor.isPlatformStaff) {
        throw new ForbiddenError(
          'ASSESSMENT_IS_GLEXCO_CONTENT',
          'Esta evaluacion viene con el kit y es la misma para todas las instituciones. ' +
            'Duplicala para adaptarla a tu salon.',
          { assessmentId: this.id.value },
        );
      }
      return;
    }

    // El personal de GLEXCO no edita evaluaciones ajenas: puede verlas para dar
    // soporte, pero cambiar el examen de un docente sin que se entere es peor
    // que no poder ayudarle.
    if (actor.institutionId !== this.state.institutionId) {
      throw new ForbiddenError(
        'ASSESSMENT_NOT_OWNED',
        'Esta evaluacion pertenece a otra institucion.',
      );
    }
  }

  /** Anade una pregunta. Solo antes de que existan entregas. */
  addQuestion(question: Omit<Question, 'id'> & { id: string }, now: Date): void {
    this.assertQuestionsMutable();

    Guard.againstEmpty(question.prompt, 'prompt');

    if (question.points <= 0) {
      throw new BusinessRuleError(
        'QUESTION_POINTS_INVALID',
        'Una pregunta tiene que valer mas de cero puntos.',
      );
    }

    if (isAutoGradable(question.type)) {
      if (question.options.length < 2) {
        throw new BusinessRuleError(
          'QUESTION_NEEDS_OPTIONS',
          'Una pregunta de marcar necesita al menos dos opciones.',
        );
      }

      // Sin respuesta correcta, la correccion automatica daria cero a todo el
      // mundo y nadie sabria por que. Es el error de captura mas comun al crear
      // cuestionarios y solo se detecta cuando ya lo hizo la clase entera.
      if (question.correctOptionIds.length === 0) {
        throw new BusinessRuleError(
          'QUESTION_NEEDS_CORRECT_ANSWER',
          'Marca cual es la respuesta correcta.',
        );
      }

      const optionIds = new Set(question.options.map((option) => option.id));
      for (const correctId of question.correctOptionIds) {
        if (!optionIds.has(correctId)) {
          throw new BusinessRuleError(
            'QUESTION_CORRECT_ANSWER_UNKNOWN',
            'La respuesta correcta no esta entre las opciones.',
          );
        }
      }

      if (
        question.type !== QUESTION_TYPE.MULTIPLE_CHOICE &&
        question.correctOptionIds.length !== 1
      ) {
        throw new BusinessRuleError(
          'QUESTION_SINGLE_ANSWER_EXPECTED',
          'Este tipo de pregunta admite una sola respuesta correcta.',
        );
      }
    }

    this.touch();
    this.state.questions.push({ ...question });
    this.state.updatedAt = now;
  }

  removeQuestion(questionId: string, now: Date): void {
    this.assertQuestionsMutable();

    const before = this.state.questions.length;
    this.state.questions = this.state.questions.filter((q) => q.id !== questionId);

    if (this.state.questions.length === before) {
      throw new BusinessRuleError('QUESTION_NOT_FOUND', 'Esa pregunta no existe.');
    }

    this.touch();
    this.state.updatedAt = now;
  }

  updateDetails(
    input: {
      title?: string;
      description?: string;
      passingScore?: number;
      maxAttempts?: number;
      timeLimitMinutes?: number | null;
      dueAt?: Date | null;
    },
    now: Date,
  ): void {
    // Estos SI se pueden cambiar con entregas hechas: mover la fecha de entrega
    // o corregir una errata del enunciado no invalida ninguna nota.
    this.touch();

    if (input.title !== undefined) {
      Guard.againstEmpty(input.title, 'title');
      this.state.title = input.title.trim();
    }
    if (input.description !== undefined) this.state.description = input.description.trim();
    if (input.passingScore !== undefined) this.state.passingScore = input.passingScore;
    if (input.maxAttempts !== undefined) this.state.maxAttempts = input.maxAttempts;
    if (input.timeLimitMinutes !== undefined) this.state.timeLimitMinutes = input.timeLimitMinutes;
    if (input.dueAt !== undefined) this.state.dueAt = input.dueAt;

    this.state.updatedAt = now;
  }

  publish(now: Date): void {
    if (this.state.status === 'published') return;

    if (this.state.questions.length === 0) {
      throw new BusinessRuleError(
        'ASSESSMENT_HAS_NO_QUESTIONS',
        'No se puede publicar una evaluacion sin preguntas.',
      );
    }

    this.state.status = 'published';
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new AssessmentPublished(
          {
            assessmentId: this.id.value,
            kitId: this.state.kitId,
            origin: this.state.origin,
            institutionId: this.state.institutionId,
            classroomId: this.state.classroomId,
            kind: this.state.kind,
            title: this.state.title,
            questionCount: this.state.questions.length,
            publishedAt: now.toISOString(),
          },
          version,
          { actorId: this.state.authorId, tenantId: this.state.institutionId ?? undefined },
        ),
    );
  }

  archive(now: Date): void {
    this.touch();
    this.state.status = 'archived';
    this.state.updatedAt = now;
  }

  /** Lo registra el servicio al aceptar una entrega. */
  registerSubmission(now: Date): void {
    this.touch();
    this.state.submissionCount += 1;
    this.state.updatedAt = now;
  }

  /**
   * Las preguntas tal y como las puede ver un ALUMNO.
   *
   * Es el unico camino por el que una pregunta sale hacia el portal del alumno.
   * No devuelve `correctOptionIds` ni `explanation`, y no es una precaucion
   * teorica: un cuestionario cuyas respuestas correctas viajan al navegador no
   * evalua nada, porque basta abrir la pestana de red del navegador para verlas.
   * Que el frontend "no las pinte" no sirve de nada.
   */
  forStudent(): StudentQuestion[] {
    return this.state.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      options: question.options.map((option) => ({ id: option.id, text: option.text })),
      points: question.points,
    }));
  }

  /** Las preguntas completas, con la clave. Solo para quien puede editar. */
  forAuthor(): Question[] {
    return this.state.questions.map((question) => ({ ...question }));
  }

  findQuestion(questionId: string): Question | undefined {
    return this.state.questions.find((question) => question.id === questionId);
  }

  get totalPoints(): number {
    return this.state.questions.reduce((sum, question) => sum + question.points, 0);
  }

  private assertQuestionsMutable(): void {
    if (this.state.submissionCount > 0) {
      throw new BusinessRuleError(
        'ASSESSMENT_HAS_SUBMISSIONS',
        'Ya hay alumnos que respondieron: cambiar las preguntas invalidaria sus notas. ' +
          'Archiva esta evaluacion y crea una version nueva.',
        { submissions: this.state.submissionCount },
      );
    }
  }

  get kitId(): string {
    return this.state.kitId;
  }
  get origin(): AssessmentOrigin {
    return this.state.origin;
  }
  get institutionId(): string | null {
    return this.state.institutionId;
  }
  get classroomId(): string | null {
    return this.state.classroomId;
  }
  get kind(): AssessmentKind {
    return this.state.kind;
  }
  get title(): string {
    return this.state.title;
  }
  get status(): PublicationStatus {
    return this.state.status;
  }
  get maxAttempts(): number {
    return this.state.maxAttempts;
  }
  get passingScore(): number {
    return this.state.passingScore;
  }
  get dueAt(): Date | null {
    return this.state.dueAt;
  }
  get timeLimitMinutes(): number | null {
    return this.state.timeLimitMinutes;
  }

  snapshot(): Readonly<AssessmentState> {
    return this.state;
  }
}
