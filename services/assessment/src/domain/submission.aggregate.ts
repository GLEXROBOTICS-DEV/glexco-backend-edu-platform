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
  type QuestionPair,
} from './assessment.aggregate';
import { scoreRubric, type RubricSelection } from './rubric';

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
  /**
   * El nivel que el docente eligio en cada criterio de la rubrica.
   *
   * Se guarda el DESGLOSE y no solo el total, porque es lo unico que convierte
   * una nota en algo que el alumno puede arreglar: "12 de 20" no dice si perdio
   * los puntos por el montaje o por la explicacion.
   */
  rubricSelections?: RubricSelection[];
  /**
   * Los pares que armo el alumno, en las preguntas de emparejar.
   *
   * Va aparte de `selectedOptionIds` porque un par no es una opcion marcada:
   * una lista plana no puede decir QUE va con QUE.
   */
  pairs?: QuestionPair[];
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
  /**
   * Los integrantes del grupo, incluido `studentId`. Vacio si es individual.
   *
   * Se guarda la lista completa y no "los otros": al corregir hay que repartir
   * la nota entre TODOS, y una lista que excluye al autor obliga a acordarse de
   * sumarlo en cada sitio donde se recorra. Ese olvido deja a quien entrego sin
   * su propia nota, que es el fallo mas dificil de ver porque la pantalla del
   * docente si la muestra.
   */
  memberIds: string[];
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
    /**
     * Los companeros elegidos, SIN el propio alumno: es lo que manda el
     * selector del portal. Aqui se le anade antes de validar el tamano.
     */
    groupmateIds?: readonly string[];
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

    // El grupo se arma aqui y no en el caso de uso: el tamano admitido es una
    // regla de la actividad, y comprobarla fuera del dominio significaria que el
    // sembrador o un consumidor de eventos podrian crear grupos que la propia
    // actividad dice no admitir.
    const groupmates = (input.groupmateIds ?? []).filter((id) => id !== input.studentId);
    const memberIds = groupmates.length > 0 ? [input.studentId, ...groupmates] : [];

    if (input.assessment.groupWork) {
      // Incluso sin companeros elegidos se valida: un grupal con la lista vacia
      // tiene que fallar por tamano, no colarse como entrega individual.
      input.assessment.assertGroupIsValid(memberIds.length > 0 ? memberIds : [input.studentId]);
    } else {
      input.assessment.assertGroupIsValid(memberIds);
    }

    const submission = new Submission(input.id, {
      assessmentId: input.assessment.id.value,
      studentId: input.studentId,
      institutionId: input.institutionId,
      classroomId: input.classroomId,
      attemptNumber: input.attemptNumber,
      memberIds,
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
    /** Los pares, en las preguntas de emparejar. */
    pairs?: QuestionPair[];
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
      ...(input.pairs ? { pairs: input.pairs } : {}),
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

      const points = gradeChoiceQuestion(question, answer.selectedOptionIds, answer.pairs ?? []);
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

  /**
   * Correccion manual de una pregunta abierta o de entrega.
   *
   * **Con rubrica, los puntos los calcula el DOMINIO a partir de los niveles
   * elegidos, y se ignora cualquier total que venga de fuera.** Es la garantia
   * que sostiene la rubrica entera: si el formulario mandara el total, un
   * `points` manipulado otorgaria mas de lo que la rubrica permite y la
   * comprobacion de "no mas del maximo de la pregunta" no lo notaria mientras
   * cupiera. Aqui, lo maximo que se puede otorgar es la suma de los mejores
   * niveles, porque no hay otra forma de llegar a un numero.
   */
  gradeQuestion(input: {
    questionId: string;
    points: number;
    feedback?: string | null;
    question: Question;
    /** Un nivel por criterio. Solo en preguntas con rubrica. */
    rubric?: RubricSelection[];
  }): void {
    if (this.state.status === SUBMISSION_STATUS.IN_PROGRESS) {
      throw new BusinessRuleError(
        'SUBMISSION_NOT_SENT',
        'Este intento todavia no se ha entregado.',
      );
    }

    // Con rubrica manda la rubrica: el total que venga en `points` no se usa.
    const puntos = input.question.rubric
      ? scoreRubric(input.question.rubric, input.rubric ?? [])
      : input.points;

    if (puntos < 0 || puntos > input.question.points) {
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
    answer.awardedPoints = puntos;
    answer.feedback = input.feedback ?? null;
    if (input.question.rubric) answer.rubricSelections = input.rubric ?? [];
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

    // La nota llega a CADA integrante, con un evento por cabeza.
    //
    // Es lo que hace que un trabajo en grupo cuente: la analitica archiva por
    // (alumno, evaluacion) y el progreso tambien, asi que un solo evento daria
    // la nota a quien pulso entregar y dejaria a los demas sin nada en su
    // portal, sin insignia y sin contar en la media de su salon -aunque el
    // docente vea la entrega corregida en su pantalla-.
    //
    // Y los fallos por pregunta van SOLO en el evento de quien entrego. El
    // grupo respondio una vez: repetirlos por cada integrante multiplicaria por
    // cuatro la muestra de "lo que mas falla tu salon", que es justo el dato con
    // el que el docente decide que volver a explicar.
    const destinatarios =
      this.state.memberIds.length > 0 ? this.state.memberIds : [this.state.studentId];

    for (const studentId of destinatarios) {
      const esQuienEntrego = studentId === this.state.studentId;

      this.record(
        (version) =>
          new SubmissionGraded(
            {
              submissionId: this.id.value,
              assessmentId: this.state.assessmentId,
              studentId,
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
              questionOutcomes: esQuienEntrego ? questionOutcomes : [],
            },
            version,
            {
              actorId: gradedBy ?? this.state.studentId,
              tenantId: this.state.institutionId ?? undefined,
            },
          ),
      );
    }
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
function gradeChoiceQuestion(
  question: Question,
  selected: readonly string[],
  pairs: readonly QuestionPair[],
): number {
  if (question.type === QUESTION_TYPE.ORDERING) {
    return gradeOrderingQuestion(question, selected);
  }

  if (question.type === QUESTION_TYPE.MATCHING) {
    return gradeMatchingQuestion(question, pairs);
  }

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

/**
 * Ordenar una secuencia.
 *
 * **Con puntuacion parcial, al contrario que las de marcar.** En una pregunta de
 * marcar, media respuesta no es media idea: o sabes cual es o no. En una de
 * ordenar de ocho pasos, todo o nada convierte un intercambio de dos piezas en
 * un cero, y entonces la pregunta ya no mide nada util: el alumno que ordeno
 * siete de ocho y el que no tenia ni idea sacan lo mismo.
 *
 * La regla es la mas simple que se le puede explicar a un docente y a un alumno
 * de nueve anos: **cuantas piezas quedaron en su sitio**. Se redondea hacia
 * abajo para no regalar puntos.
 *
 * Su limitacion conocida, y se asume: quien desplaza la secuencia entera una
 * posicion acierta el orden relativo y saca casi cero. Medirlo bien exige una
 * distancia entre permutaciones -Kendall tau- que nadie sabria explicar en la
 * pantalla de resultados, y una nota que no se puede explicar no se puede
 * discutir con un profesor.
 */
function gradeOrderingQuestion(question: Question, given: readonly string[]): number {
  const expected = question.correctOptionIds;
  if (expected.length === 0) return 0;

  // Sin responder o a medias: no se rellena el resto con aciertos por azar.
  if (given.length !== expected.length) return 0;

  let inPlace = 0;
  for (let i = 0; i < expected.length; i += 1) {
    if (given[i] === expected[i]) inPlace += 1;
  }

  return Math.floor((question.points * inPlace) / expected.length);
}

/**
 * Emparejar dos columnas.
 *
 * **Con puntuacion parcial, por la misma razon que ordenar**: en una pregunta de
 * seis parejas, todo o nada convierte confundir dos en un cero, y entonces el
 * que empareja cinco bien y el que no tiene ni idea sacan lo mismo. La regla es
 * la que se le puede explicar a un alumno de nueve anos: **cuantas parejas
 * acertaste**. Se redondea hacia abajo para no regalar puntos.
 *
 * Un elemento de la izquierda repetido en la respuesta cuenta UNA vez. Sin eso,
 * mandar la misma pareja correcta seis veces daria la nota entera: la
 * puntuacion parcial se convierte en un agujero si no se cuenta por elemento de
 * la izquierda.
 */
function gradeMatchingQuestion(question: Question, given: readonly QuestionPair[]): number {
  const expected = question.pairs ?? [];
  if (expected.length === 0) return 0;

  const clave = new Map(expected.map((pair) => [pair.optionId, pair.matchId]));
  const yaContados = new Set<string>();

  let aciertos = 0;

  for (const pair of given) {
    if (yaContados.has(pair.optionId)) continue;
    yaContados.add(pair.optionId);

    if (clave.get(pair.optionId) === pair.matchId) aciertos += 1;
  }

  return Math.floor((question.points * aciertos) / expected.length);
}
