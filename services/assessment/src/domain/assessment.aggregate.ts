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
  MAX_GROUP_SIZE,
  QUESTION_TYPES,
  type AssessmentType,
  type PublicationStatus,
  type QuestionType,
} from '@glexco/contracts';
import { assertRubricIsUsable, type Rubric } from './rubric';

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
 * `ordering` encaja sin modelo nuevo: `correctOptionIds` ya es un ARRAY
 * ORDENADO, asi que la secuencia correcta es su propio orden.
 *
 * `matching` si necesito modelo, y por eso tardo: emparejar son PARES y
 * `correctOptionIds` es una lista plana. Se resolvio con dos campos propios
 * -`matches` para la columna derecha y `pairs` para la clave- en vez de
 * codificar "izq:der" dentro de un identificador, que seria una estructura
 * escondida en un `string` y se rompe en cuanto un id lleve el separador.
 */
const AUTO_GRADABLE: readonly QuestionType[] = [
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.TRUE_FALSE,
  QUESTION_TYPES.ORDERING,
  QUESTION_TYPES.MATCHING,
];

export function isAutoGradable(type: QuestionType): boolean {
  return AUTO_GRADABLE.includes(type);
}

export interface QuestionOption {
  id: string;
  text: string;
}

/** Una pareja de una pregunta de emparejar: un elemento de cada columna. */
export interface QuestionPair {
  optionId: string;
  matchId: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  /**
   * Rubrica de correccion, en las preguntas que corrige una persona.
   *
   * Vive DENTRO de la pregunta y no en una tabla aparte: una rubrica sin su
   * pregunta no significa nada, se lee y se escribe siempre con ella, y en tabla
   * aparte cada carga de la bandeja de correccion seria un JOIN mas. Es la misma
   * decision que las opciones.
   *
   * `null` en las de marcar: la maquina no necesita criterios para comparar una
   * opcion con la clave.
   */
  rubric?: Rubric | null;
  /**
   * Vacio en las preguntas abiertas y de entrega.
   *
   * En `matching` son la columna IZQUIERDA: lo que hay que emparejar.
   */
  options: QuestionOption[];
  /**
   * La columna DERECHA de una pregunta de emparejar.
   *
   * Puede tener mas elementos que `options`: un distractor a la derecha -una
   * opcion que no empareja con nada- es lo que evita que la ultima pareja se
   * acierte por descarte.
   */
  matches?: QuestionOption[];
  /**
   * La clave de una pregunta de emparejar: que va con que.
   *
   * **Nunca sale del servidor hacia un alumno**, igual que `correctOptionIds`.
   * Va aparte y no dentro de `correctOptionIds` porque un par no es una opcion
   * suelta, y una lista plana no puede representar una relacion.
   */
  pairs?: QuestionPair[];
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
  /**
   * La rubrica SI viaja al alumno, y a proposito.
   *
   * No es parte de la clave de correccion: es el enunciado de como se va a
   * evaluar. Saber de antemano que se puntua el montaje, el cableado y la
   * explicacion es exactamente lo que hace que una rubrica sirva para aprender
   * y no solo para calificar. Esconderla hasta despues la convierte en una
   * sorpresa.
   */
  rubric?: Rubric | null;
  /**
   * La columna derecha de una pregunta de emparejar, DESORDENADA.
   *
   * Sin desordenar, la clave viaja igual: si el docente captura los pares en
   * orden y la derecha sale en ese mismo orden, emparejar el primero con el
   * primero acierta todo. Ver `forStudent()` para como se desordena sin usar
   * azar.
   */
  matches?: QuestionOption[];
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
  /** `null` = se hace individualmente. Ver `GroupWork`. */
  groupWork: GroupWork | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Una actividad que se hace EN GRUPO.
 *
 * Guarda el tamano admitido y no la lista de grupos: los grupos los arma cada
 * alumno al empezar, y quien ya esta en uno desaparece de la lista de los
 * demas. Eso vive en las entregas, que es donde estan los hechos.
 *
 * El tamano es un rango y no un numero fijo porque una clase rara vez se divide
 * exacta: con 23 alumnos y grupos de 4 alguien se queda fuera, y la alternativa
 * -dejar a tres alumnos sin poder entregar- no es una regla, es un fallo.
 */
export interface GroupWork {
  /** Minimo de integrantes, contando a quien crea el grupo. Nunca menos de 2. */
  minSize: number;
  /** Maximo de integrantes, contando a quien crea el grupo. */
  maxSize: number;
}

/**
 * Tope duro del tamano de grupo.
 *
 * Se reexporta de `@glexco/contracts` en vez de repetir el numero: el esquema
 * Zod y el dominio tienen que rechazar exactamente lo mismo, y dos copias de un
 * limite se separan en cuanto alguien cambia una. El `CHECK` de la migracion es
 * la tercera copia y la unica que no se puede importar; lleva su nota.
 */
export { MAX_GROUP_SIZE };

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
    groupWork?: GroupWork | null;
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

    const groupWork = input.groupWork ?? null;
    if (groupWork) assertGroupWorkIsUsable(groupWork);

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
      groupWork,
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

    // Emparejar se valida aparte: su clave son `pairs` y no `correctOptionIds`,
    // asi que la rama de las de marcar -que exige una respuesta correcta entre
    // las opciones- no le aplica.
    if (question.type === QUESTION_TYPE.MATCHING) {
      assertMatchingIsUsable(question);
    } else if (isAutoGradable(question.type)) {
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

      // Ordenar exige la SECUENCIA ENTERA, sin repetir: la clave de una pregunta
      // de ordenar no es una opcion, es el orden completo.
      //
      // Se comprueba aqui ademas de en el esquema porque el esquema solo cubre
      // la via HTTP: el banco de GLEXCO se siembra por otro camino, y una
      // pregunta con la clave a medias no se puede acertar. El salon entero
      // sacaria la misma nota rara sin que nadie supiera por que.
      if (question.type === QUESTION_TYPE.ORDERING) {
        const distintas = new Set(question.correctOptionIds);

        if (
          question.correctOptionIds.length !== question.options.length ||
          distintas.size !== question.options.length
        ) {
          throw new BusinessRuleError(
            'ORDERING_NEEDS_FULL_SEQUENCE',
            'Una pregunta de ordenar necesita todas sus opciones, en el orden correcto y sin repetir.',
          );
        }
      } else if (
        question.type !== QUESTION_TYPE.MULTIPLE_CHOICE &&
        question.correctOptionIds.length !== 1
      ) {
        throw new BusinessRuleError(
          'QUESTION_SINGLE_ANSWER_EXPECTED',
          'Este tipo de pregunta admite una sola respuesta correcta.',
        );
      }
    }

    // La rubrica, si la trae. La comprobacion que importa es que su maximo
    // COINCIDA con los puntos de la pregunta: si diera menos, la pregunta seria
    // imposible de sacar entera y nadie sabria por que; si diera mas, el dominio
    // rechazaria la correccion al pasarse y el docente se quedaria sin poder
    // cerrar la nota despues de haber puntuado todo.
    if (question.rubric) assertRubricIsUsable(question.rubric, question.points);

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
      groupWork?: GroupWork | null;
    },
    now: Date,
  ): void {
    // Estos SI se pueden cambiar con entregas hechas: mover la fecha de entrega
    // o corregir una errata del enunciado no invalida ninguna nota.
    this.touch();

    // El trabajo en grupo NO, y por el mismo motivo que las preguntas: hay
    // grupos ya formados. Pasar a individual dejaria entregas con integrantes
    // que la actividad dice no admitir, y estrechar el rango dejaria grupos
    // validos fuera de sus propias reglas. Las dos cosas se descubren al
    // corregir, cuando ya no hay arreglo.
    if (input.groupWork !== undefined) {
      if (this.state.submissionCount > 0) {
        throw new BusinessRuleError(
          'ASSESSMENT_GROUPS_ALREADY_FORMED',
          'Ya hay entregas, asi que el trabajo en grupo no se puede cambiar. Duplica la actividad y adapta la copia.',
          { submissionCount: this.state.submissionCount },
        );
      }

      if (input.groupWork) assertGroupWorkIsUsable(input.groupWork);
      this.state.groupWork = input.groupWork;
    }

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
      // La rubrica SI sale, porque no es parte de la clave: es el enunciado de
      // como se va a evaluar. Saber de antemano que se puntua el montaje, el
      // cableado y la explicacion es lo que hace que sirva para aprender.
      ...(question.rubric ? { rubric: question.rubric } : {}),
      // La columna derecha sale SIN los pares y ORDENADA POR IDENTIFICADOR.
      //
      // Ordenar por id es desordenar: los identificadores son UUID v4, asi que
      // su orden no guarda ninguna relacion con el orden de captura, y el
      // docente que escribe las parejas en fila no regala la clave. Y se hace
      // asi en vez de con `Math.random()` porque el dominio tiene que ser
      // determinista -una pregunta que sale distinta en cada carga no se puede
      // probar, y al recargar la pantalla el alumno veria la derecha bailar y
      // perderia lo que llevaba emparejado-.
      ...(question.matches
        ? { matches: [...question.matches].sort((a, b) => a.id.localeCompare(b.id)) }
        : {}),
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

  /** `null` cuando la actividad se hace individualmente. */
  get groupWork(): GroupWork | null {
    return this.state.groupWork;
  }

  /**
   * Comprueba que estos integrantes forman un grupo valido para esta actividad.
   *
   * `memberIds` los trae ENTEROS, incluido quien crea el grupo: contar al autor
   * aparte obliga a recordar en cada pantalla si el "3" del docente incluye o no
   * al que pulsa, y esa duda acaba siempre en grupos de tamano equivocado.
   *
   * Lo que NO se comprueba aqui es que los companeros existan, sean de su salon
   * o esten libres: eso son hechos de otros agregados y de la base. Aqui solo
   * vive lo que la actividad declara sobre su propio tamano.
   */
  assertGroupIsValid(memberIds: readonly string[]): void {
    const group = this.state.groupWork;

    if (!group) {
      if (memberIds.length > 0) {
        throw new BusinessRuleError(
          'ASSESSMENT_IS_INDIVIDUAL',
          'Esta actividad se hace individualmente.',
        );
      }
      return;
    }

    const distintos = new Set(memberIds);
    if (distintos.size !== memberIds.length) {
      throw new BusinessRuleError(
        'GROUP_MEMBER_REPEATED',
        'Hay un companero repetido en el grupo.',
      );
    }

    if (distintos.size < group.minSize || distintos.size > group.maxSize) {
      throw new BusinessRuleError(
        'GROUP_SIZE_NOT_ALLOWED',
        group.minSize === group.maxSize
          ? `Esta actividad se hace en grupos de ${group.minSize}.`
          : `Esta actividad se hace en grupos de ${group.minSize} a ${group.maxSize} alumnos.`,
        { minSize: group.minSize, maxSize: group.maxSize, received: distintos.size },
      );
    }
  }

  snapshot(): Readonly<AssessmentState> {
    return this.state;
  }
}

/**
 * Comprueba que un rango de tamano de grupo se pueda cumplir.
 *
 * Las tres cosas que se rechazan son las tres formas de dejar una actividad
 * imposible de entregar, y ninguna da un error entendible mas adelante:
 *
 * - **Un grupo de uno no es un grupo.** Si el docente queria individual, la
 *   casilla de trabajo en grupo es la que hay que desmarcar; admitir `minSize`
 *   1 crearia dos formas de decir lo mismo y ninguna pantalla sabria cual leer.
 * - **Un maximo por debajo del minimo** no lo cumple ningun grupo, y el alumno
 *   solo se entera al intentar empezar.
 * - **Un maximo sin tope** deja que una peticion declare un grupo con mil
 *   integrantes inventados y obligue al servicio a comprobarlos uno a uno.
 */
function assertGroupWorkIsUsable(groupWork: GroupWork): void {
  if (!Number.isInteger(groupWork.minSize) || !Number.isInteger(groupWork.maxSize)) {
    throw new BusinessRuleError(
      'GROUP_SIZE_INVALID',
      'El tamano del grupo se cuenta en alumnos enteros.',
    );
  }

  if (groupWork.minSize < 2) {
    throw new BusinessRuleError(
      'GROUP_SIZE_TOO_SMALL',
      'Un grupo necesita al menos dos alumnos. Si la actividad es individual, no la marques como grupal.',
    );
  }

  if (groupWork.maxSize < groupWork.minSize) {
    throw new BusinessRuleError(
      'GROUP_SIZE_RANGE_INVALID',
      'El maximo de integrantes no puede ser menor que el minimo.',
    );
  }

  if (groupWork.maxSize > MAX_GROUP_SIZE) {
    throw new BusinessRuleError(
      'GROUP_SIZE_TOO_LARGE',
      `Un grupo no puede pasar de ${MAX_GROUP_SIZE} alumnos.`,
      { maxSize: MAX_GROUP_SIZE },
    );
  }
}

/**
 * Comprueba una pregunta de emparejar al capturarla.
 *
 * Se comprueba aqui ademas de en el esquema Zod porque el esquema solo cubre la
 * via HTTP, y el banco de GLEXCO se siembra por otro camino. Una pregunta de
 * emparejar con la clave a medias no se puede acertar, y el salon entero sacaria
 * la misma nota rara sin que nadie supiera por que -el mismo fallo que ya se
 * cerro en las de ordenar-.
 */
function assertMatchingIsUsable(question: Omit<Question, 'id'> & { id: string }): void {
  const matches = question.matches ?? [];
  const pairs = question.pairs ?? [];

  if (question.options.length < 2 || matches.length < 2) {
    throw new BusinessRuleError(
      'MATCHING_NEEDS_TWO_COLUMNS',
      'Una pregunta de emparejar necesita al menos dos elementos en cada columna.',
    );
  }

  // TODA la izquierda tiene que estar emparejada. Dejar un elemento fuera es
  // pedirle al alumno que empareje algo que no puntua, y no hay forma de que lo
  // sepa.
  if (pairs.length !== question.options.length) {
    throw new BusinessRuleError(
      'MATCHING_NEEDS_ALL_PAIRS',
      'Cada elemento de la izquierda necesita su pareja.',
    );
  }

  const optionIds = new Set(question.options.map((option) => option.id));
  const matchIds = new Set(matches.map((match) => match.id));
  const vistosIzquierda = new Set<string>();
  const vistosDerecha = new Set<string>();

  for (const pair of pairs) {
    if (!optionIds.has(pair.optionId) || !matchIds.has(pair.matchId)) {
      throw new BusinessRuleError(
        'MATCHING_PAIR_UNKNOWN',
        'Hay una pareja que apunta a un elemento que no existe.',
      );
    }

    if (vistosIzquierda.has(pair.optionId)) {
      throw new BusinessRuleError(
        'MATCHING_OPTION_DUPLICATED',
        'Un elemento de la izquierda no puede tener dos parejas.',
      );
    }
    vistosIzquierda.add(pair.optionId);

    // Un elemento de la derecha tampoco se reutiliza. Se podria permitir -"todos
    // estos sensores van con Yanshee"-, pero entonces "cuantas parejas acerto"
    // deja de ser explicable: el alumno que asigna el mismo elemento a todo
    // acertaria varias sin haber emparejado nada.
    if (vistosDerecha.has(pair.matchId)) {
      throw new BusinessRuleError(
        'MATCHING_MATCH_DUPLICATED',
        'Un elemento de la derecha no puede emparejarse con dos de la izquierda.',
      );
    }
    vistosDerecha.add(pair.matchId);
  }
}
