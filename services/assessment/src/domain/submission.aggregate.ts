import {
  AggregateRoot,
  BusinessRuleError,
  DomainEvent,
  ForbiddenError,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import { EVENTS } from '@glexco/contracts';
import {
  QUESTION_TYPE,
  isAutoGradable,
  type Assessment,
  type Question,
} from './assessment.aggregate';

export class SubmissionId extends defineId('Submission') {}

const AGGREGATE = 'Submission';

/**
 * Estados de una entrega.
 *
 * Es un subconjunto del vocabulario compartido: `in_progress` mapea a `draft`,
 * y de momento no se usan `pending_review` ni `returned`. Se declara aparte
 * -en vez de reutilizar el enum entero- para que la maquina de estados del
 * agregado tenga exactamente los estados que sabe manejar, y no cuatro mas que
 * nadie escribe.
 */
export const SUBMISSION_STATUS = {
  /** El alumno lo tiene abierto. Es el `draft` del vocabulario. */
  IN_PROGRESS: 'in_progress',
  /** Entregado. Si todo era de marcar, ya trae nota. */
  SUBMITTED: 'submitted',
  /** Corregido del todo, incluida la parte manual. */
  GRADED: 'graded',
} as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

export interface Answer {
  questionId: string;
  /** Opciones marcadas, en las preguntas de marcar. */
  selectedOptionIds: string[];
  /** Texto libre. */
  text: string | null;
  /** Archivo o enlace entregado, por id de `media-service`. */
  mediaAssetId: string | null;
  /** Lo pone la correccion. `null` mientras no se ha corregido esa pregunta. */
  awardedPoints: number | null;
  /** Comentario del docente sobre ESTA pregunta. */
  feedback: string | null;
}

/**
 * Lo que viaja cuando una entrega queda corregida.
 *
 * Lleva mas de lo estrictamente necesario para identificar la entrega, y es
 * deliberado: la analitica construye sus proyecciones **solo con este evento**.
 * Si no trajera `kitId`, `origin` e `institutionId`, tendria que llamar de
 * vuelta al servicio de evaluacion por cada entrega, y eso convierte una
 * proyeccion asincrona en una dependencia sincrona entre servicios: justo lo
 * que el bus existe para evitar.
 *
 * `origin` es el campo que decide si un dato es COMPARABLE entre colegios. Sin
 * el, los dashboards mezclarian las evaluaciones de GLEXCO -iguales para
 * todos- con las que escribe cada docente, y una institucion podria subir su
 * media poniendo examenes faciles.
 *
 * `questionOutcomes` alimenta el dato mas accionable que tiene un docente: que
 * preguntas falla su salon. Solo lleva el id y si se fallo, nunca la respuesta
 * concreta: eso es del alumno y su dueno es este servicio, no la analitica.
 */
export interface SubmissionGradedPayload {
  submissionId: string;
  assessmentId: string;
  studentId: string;
  classroomId: string | null;
  institutionId: string | null;
  kitId: string;
  origin: 'glexco' | 'institution';
  kind: string;
  score: number;
  maxScore: number;
  passed: boolean;
  attemptNumber: number;
  gradedAt: string;
  questionOutcomes: { questionId: string; missed: boolean }[];
}

export class SubmissionGraded extends DomainEvent<SubmissionGradedPayload> {
  constructor(payload: SubmissionGradedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.SUBMISSION_GRADED, AGGREGATE, payload.submissionId, version, payload, context);
  }
}

interface SubmissionState {
  assessmentId: string;
  studentId: string;
  /**
   * Institucion del ALUMNO, no de la evaluacion.
   *
   * La distincion es la que hace que los dashboards existan. Una evaluacion de
   * GLEXCO no pertenece a ninguna institucion -es comun a todas-, pero la
   * entrega de un alumno del colegio San Juan si es del San Juan, y es ahi donde
   * tiene que contar. Tomarla de la evaluacion dejaba sin institucion todos los
   * resultados del banco comun, que son precisamente los unicos comparables
   * entre colegios: el dashboard del director salia vacio.
   */
  institutionId: string | null;
  classroomId: string | null;
  attemptNumber: number;
  answers: Answer[];
  status: SubmissionStatus;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  /** `null` si la corrigio la maquina entera. */
  gradedBy: string | null;
  feedback: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  gradedAt: Date | null;
}

/**
 * El intento de un alumno sobre una evaluacion.
 *
 * La correccion tiene dos mitades y la distincion no es de comodidad:
 *
 * - Lo de **marcar** lo corrige la maquina en el momento de entregar. El alumno
 *   ve su nota al instante, que es lo que hace util un cuestionario para
 *   aprender: si la respuesta llega tres dias despues, ya no la relaciona con lo
 *   que estaba pensando.
 *
 * - Lo **abierto y las entregas** los corrige una persona. Hasta entonces la
 *   entrega queda en `submitted` con la nota parcial de lo automatico, y no en
 *   `graded`: dar por definitiva una nota a la que le falta la mitad de los
 *   puntos le diria al alumno que suspendio cuando aun no se sabe.
 */
export class Submission extends AggregateRoot<SubmissionId> {
  private constructor(
    id: SubmissionId,
    private state: SubmissionState,
  ) {
    super(id);
  }

  static start(input: {
    id: SubmissionId;
    assessment: Assessment;
    studentId: string;
    /** La del alumno. Ver la nota en `SubmissionState`. */
    institutionId: string | null;
    classroomId: string | null;
    attemptNumber: number;
    now: Date;
  }): Submission {
    if (input.assessment.status !== 'published') {
      throw new BusinessRuleError(
        'ASSESSMENT_NOT_PUBLISHED',
        'Esta evaluacion todavia no esta disponible.',
      );
    }

    if (input.attemptNumber > input.assessment.maxAttempts) {
      throw new BusinessRuleError(
        'ASSESSMENT_ATTEMPTS_EXHAUSTED',
        'Ya agotaste los intentos de esta evaluacion.',
        { maxAttempts: input.assessment.maxAttempts },
      );
    }

    // La fecha limite se comprueba al EMPEZAR, no al entregar. Cortar a mitad a
    // quien empezo a tiempo seria castigarle por tardar lo que la evaluacion
    // dura; el limite de tiempo por intento es lo que cubre ese caso.
    if (input.assessment.dueAt && input.now > input.assessment.dueAt) {
      throw new BusinessRuleError(
        'ASSESSMENT_PAST_DUE',
        'La fecha de entrega de esta evaluacion ya paso.',
        { dueAt: input.assessment.dueAt.toISOString() },
      );
    }

    const submission = new Submission(input.id, {
      assessmentId: input.assessment.id.value,
      studentId: input.studentId,
      institutionId: input.institutionId,
      classroomId: input.classroomId,
      attemptNumber: input.attemptNumber,
      answers: [],
      status: SUBMISSION_STATUS.IN_PROGRESS,
      score: null,
      maxScore: input.assessment.totalPoints,
      passed: null,
      gradedBy: null,
      feedback: null,
      startedAt: input.now,
      submittedAt: null,
      gradedAt: null,
    });

    submission.touch();
    return submission;
  }

  static rehydrate(id: SubmissionId, state: SubmissionState, version: number): Submission {
    const submission = new Submission(id, state);
    submission.setVersion(version);
    return submission;
  }

  assertOwnedBy(studentId: string): void {
    if (this.state.studentId !== studentId) {
      // El mismo error que si no existiera: distinguirlos permitiria averiguar
      // que intentos hay probando identificadores.
      throw new ForbiddenError('SUBMISSION_NOT_FOUND', 'Ese intento no existe.');
    }
  }

  /**
   * Guarda una respuesta sin entregar.
   *
   * Existe para que un cuestionario largo no se pierda si al alumno se le cierra
   * el portatil del laboratorio. Se puede reescribir tantas veces como quiera
   * mientras el intento siga abierto.
   */
  answer(input: {
    questionId: string;
    selectedOptionIds?: string[];
    text?: string | null;
    mediaAssetId?: string | null;
    now: Date;
  }): void {
    if (this.state.status !== SUBMISSION_STATUS.IN_PROGRESS) {
      throw new BusinessRuleError(
        'SUBMISSION_ALREADY_SENT',
        'Este intento ya fue entregado y no admite cambios.',
      );
    }

    this.touch();

    const existing = this.state.answers.find((a) => a.questionId === input.questionId);
    const next: Answer = {
      questionId: input.questionId,
      selectedOptionIds: input.selectedOptionIds ?? [],
      text: input.text ?? null,
      mediaAssetId: input.mediaAssetId ?? null,
      awardedPoints: null,
      feedback: null,
    };

    if (existing) {
      Object.assign(existing, next);
    } else {
      this.state.answers.push(next);
    }
  }

  /**
   * Asigna el salon a un intento que se abrio sin el.
   *
   * Un intento sin salon no aparece en la bandeja de correccion de nadie, asi
   * que lo que el alumno escriba se quedaria sin corregir para siempre. Eso
   * puede pasar por dos vias reales: el intento se abrio antes de que la
   * matricula estuviera proyectada -llega por evento, no en el mismo instante
   * que el registro-, o el alumno se matriculo despues de abrirlo.
   *
   * Solo rellena el hueco: nunca CAMBIA un salon ya asignado. Permitirlo
   * dejaria mover una entrega de un salon a otro, es decir, de un docente a
   * otro, y sin dejar rastro.
   */
  attachClassroom(classroomId: string): void {
    if (this.state.status !== SUBMISSION_STATUS.IN_PROGRESS) return;
    if (this.state.classroomId !== null) return;

    this.state.classroomId = classroomId;
    this.touch();
  }

  /**
   * Entrega y corrige lo automatico.
   *
   * Recibe el agregado completo -con la clave- porque la correccion ocurre en el
   * servidor y en ningun otro sitio. Es el mismo motivo por el que
   * `Assessment.forStudent()` no la incluye.
   */
  submit(assessment: Assessment, now: Date): void {
    if (this.state.status !== SUBMISSION_STATUS.IN_PROGRESS) {
      // Idempotente: el doble clic o el reintento de red no deben dar error ni
      // volver a corregir.
      return;
    }

    // El limite de tiempo se comprueba aqui, con el reloj del SERVIDOR. Fiarse
    // del cronometro del navegador es no tener limite: se cambia con la consola
    // abierta en diez segundos.
    if (assessment.timeLimitMinutes !== null) {
      const elapsedMinutes = (now.getTime() - this.state.startedAt.getTime()) / 60_000;
      if (elapsedMinutes > assessment.timeLimitMinutes + 1) {
        // El minuto de gracia cubre la latencia de red del envio final: perder
        // un examen entero porque la peticion tardo dos segundos seria absurdo.
        throw new BusinessRuleError(
          'SUBMISSION_TIME_EXPIRED',
          'Se acabo el tiempo de este intento.',
          { limitMinutes: assessment.timeLimitMinutes },
        );
      }
    }

    this.touch();

    let automaticPoints = 0;
    let pendingManual = false;

    for (const question of assessment.forAuthor()) {
      const answer = this.state.answers.find((a) => a.questionId === question.id);

      if (!isAutoGradable(question.type)) {
        pendingManual = true;
        continue;
      }

      if (!answer) {
        // Sin responder: cero puntos, y se deja constancia para que el alumno
        // vea que no la contesto en vez de creer que fallo.
        this.state.answers.push({
          questionId: question.id,
          selectedOptionIds: [],
          text: null,
          mediaAssetId: null,
          awardedPoints: 0,
          feedback: null,
        });
        continue;
      }

      const points = gradeChoiceQuestion(question, answer.selectedOptionIds);
      answer.awardedPoints = points;
      automaticPoints += points;
    }

    this.state.status = SUBMISSION_STATUS.SUBMITTED;
    this.state.submittedAt = now;
    this.state.maxScore = assessment.totalPoints;
    this.state.score = automaticPoints;

    // Solo se cierra la nota si no queda nada por corregir a mano. Con parte
    // manual pendiente, `passed` sigue en `null`: decirle a un alumno que
    // suspendio cuando falta la mitad de los puntos es peor que no decirle nada.
    if (!pendingManual) {
      this.finalise(automaticPoints, assessment, null, now);
    }
  }

  /** Correccion manual de una pregunta abierta o de entrega. */
  gradeQuestion(input: {
    questionId: string;
    points: number;
    feedback?: string | null;
    question: Question;
  }): void {
    if (this.state.status === SUBMISSION_STATUS.IN_PROGRESS) {
      throw new BusinessRuleError(
        'SUBMISSION_NOT_SENT',
        'Este intento todavia no se ha entregado.',
      );
    }

    if (input.points < 0 || input.points > input.question.points) {
      throw new BusinessRuleError(
        'GRADE_OUT_OF_RANGE',
        `Esta pregunta vale como maximo ${input.question.points} puntos.`,
        { max: input.question.points },
      );
    }

    const answer = this.state.answers.find((a) => a.questionId === input.questionId);
    if (!answer) {
      throw new BusinessRuleError(
        'ANSWER_NOT_FOUND',
        'El alumno no respondio a esa pregunta.',
      );
    }

    this.touch();
    answer.awardedPoints = input.points;
    answer.feedback = input.feedback ?? null;
  }

  /** Cierra la correccion y publica la nota. */
  finaliseGrading(
    assessment: Assessment,
    gradedBy: string,
    feedback: string | null,
    now: Date,
  ): void {
    if (this.state.status === SUBMISSION_STATUS.IN_PROGRESS) {
      throw new BusinessRuleError('SUBMISSION_NOT_SENT', 'Este intento no se ha entregado.');
    }

    const unscored = this.state.answers.filter((a) => a.awardedPoints === null);
    if (unscored.length > 0) {
      throw new BusinessRuleError(
        'SUBMISSION_HAS_UNGRADED_ANSWERS',
        'Quedan preguntas sin puntuar.',
        { pending: unscored.map((a) => a.questionId) },
      );
    }

    const total = this.state.answers.reduce((sum, a) => sum + (a.awardedPoints ?? 0), 0);
    this.touch();
    this.state.feedback = feedback;
    this.finalise(total, assessment, gradedBy, now);
  }

  private finalise(score: number, assessment: Assessment, gradedBy: string | null, now: Date): void {
    const maxScore = assessment.totalPoints;
    // Evaluacion sin puntos: se considera aprobada en vez de dividir por cero.
    const percentage = maxScore === 0 ? 100 : (score / maxScore) * 100;

    this.state.score = score;
    this.state.maxScore = maxScore;
    this.state.passed = percentage >= assessment.passingScore;
    this.state.status = SUBMISSION_STATUS.GRADED;
    this.state.gradedBy = gradedBy;
    this.state.gradedAt = now;

    // Se calcula aqui, con el agregado de la evaluacion delante, porque es el
    // unico punto donde se conocen a la vez los puntos otorgados y los que
    // valia cada pregunta. La analitica no puede deducirlo despues.
    const questionOutcomes = assessment.forAuthor().map((question) => {
      const answer = this.state.answers.find((a) => a.questionId === question.id);
      return {
        questionId: question.id,
        missed: (answer?.awardedPoints ?? 0) < question.points,
      };
    });

    const assessmentState = assessment.snapshot();

    this.record(
      (version) =>
        new SubmissionGraded(
          {
            submissionId: this.id.value,
            assessmentId: this.state.assessmentId,
            studentId: this.state.studentId,
            classroomId: this.state.classroomId,
            // La del alumno, no la de la evaluacion.
            institutionId: this.state.institutionId,
            kitId: assessmentState.kitId,
            origin: assessmentState.origin,
            kind: assessmentState.kind,
            score,
            maxScore,
            // Ya lo fijo `finalise`; el evento nunca lleva un `passed` nulo.
            passed: this.state.passed ?? false,
            attemptNumber: this.state.attemptNumber,
            gradedAt: now.toISOString(),
            questionOutcomes,
          },
          version,
          {
            actorId: gradedBy ?? this.state.studentId,
            tenantId: this.state.institutionId ?? undefined,
          },
        ),
    );
  }

  get status(): SubmissionStatus {
    return this.state.status;
  }
  get studentId(): string {
    return this.state.studentId;
  }
  get assessmentId(): string {
    return this.state.assessmentId;
  }
  get attemptNumber(): number {
    return this.state.attemptNumber;
  }
  get score(): number | null {
    return this.state.score;
  }

  snapshot(): Readonly<SubmissionState> {
    return this.state;
  }
}

/**
 * Puntua una pregunta de marcar.
 *
 * **Todo o nada en las de varias respuestas.** La alternativa -dar puntos
 * parciales por cada acierto- premia marcarlo todo: quien selecciona las cinco
 * opciones acierta las tres correctas y se lleva mas nota que quien penso y
 * marco dos de tres. Con todo o nada, marcar de mas cuesta exactamente igual que
 * fallar, que es lo que se quiere medir.
 */
function gradeChoiceQuestion(question: Question, selected: readonly string[]): number {
  if (question.type === QUESTION_TYPE.MULTIPLE_CHOICE) {
    const expected = new Set(question.correctOptionIds);
    const given = new Set(selected);

    if (expected.size !== given.size) return 0;
    for (const id of expected) {
      if (!given.has(id)) return 0;
    }
    return question.points;
  }

  // Una sola respuesta: marcar dos es fallar, no acertar a medias.
  if (selected.length !== 1) return 0;
  return question.correctOptionIds.includes(selected[0]!) ? question.points : 0;
}
