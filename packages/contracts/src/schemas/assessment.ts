import { z } from 'zod';
import { uuidSchema } from './common';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '../domain/vocabulary';

/**
 * Esquemas de evaluacion, compartidos entre backend y frontend.
 *
 * Lo que NO esta aqui es tan importante como lo que si: no hay ningun esquema de
 * respuesta que incluya `correctOptionIds`. La clave de correccion no forma
 * parte de ningun contrato hacia el cliente, y tenerlo asi hace que enviarla por
 * error rompa la compilacion en vez de filtrarse en silencio.
 */

/**
 * Formas de evaluacion admitidas por la API.
 *
 * Salen del vocabulario compartido en vez de repetirse: si alguien anade un tipo
 * alli y no aqui, la diferencia se nota al compilar y no en produccion.
 *
 * Ya estan los siete: `ordering` y `matching` fueron los ultimos en entrar, y
 * solo lo hicieron cuando su correccion automatica estuvo escrita. Aceptar un
 * tipo sin algoritmo lo puntuaria a cero en silencio, que es peor que no
 * ofrecerlo.
 */
export const ASSESSMENT_KINDS = [
  ASSESSMENT_TYPES.QUIZ,
  ASSESSMENT_TYPES.PRACTICAL,
  ASSESSMENT_TYPES.PROJECT,
  ASSESSMENT_TYPES.STEM_ACTIVITY,
] as const;

export const SUPPORTED_QUESTION_TYPES = [
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.TRUE_FALSE,
  QUESTION_TYPES.SHORT_ANSWER,
  QUESTION_TYPES.ORDERING,
  QUESTION_TYPES.MATCHING,
  QUESTION_TYPES.FILE_UPLOAD,
] as const;

/**
 * Tope duro del tamano de grupo, compartido por el esquema y el dominio.
 *
 * Es un limite de seguridad antes que pedagogico: sin el, una peticion podria
 * declarar un grupo con mil alumnos inventados y obligar al servicio a
 * comprobarlos uno a uno.
 *
 * Va ANTES del esquema que lo usa: una `const` no se eleva, y declararla debajo
 * revienta al cargar el modulo, no al validar.
 */
export const MAX_GROUP_SIZE = 10;

export const createAssessmentSchema = z.object({
  kitId: uuidSchema,
  courseId: uuidSchema.optional(),

  /**
   * Salon al que se limita. Vacio = para todos los salones de la institucion.
   *
   * El ORIGEN no se pide: lo decide el backend segun quien crea. Aceptarlo aqui
   * permitiria a un docente publicar su cuestionario como contenido de GLEXCO a
   * todos los colegios cambiando un solo campo.
   */
  classroomId: uuidSchema.optional(),

  kind: z.enum(ASSESSMENT_KINDS),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),

  passingScore: z.coerce.number().int().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),

  /** Minutos por intento. El limite lo cuenta el reloj del SERVIDOR. */
  timeLimitMinutes: z.coerce.number().int().min(1).max(480).optional(),

  dueAt: z.string().datetime({ message: 'errors.validation.date_invalid' }).optional(),

  /**
   * Actividad en grupo. Ausente = individual.
   *
   * El rango se valida aqui **y** en el dominio, y no sobra: este esquema solo
   * cubre la via HTTP, y el banco de GLEXCO entra por el sembrador. La regla
   * que importa -que el maximo no sea menor que el minimo- se comprueba con
   * `refine` porque un campo no puede mirar al otro por su cuenta.
   */
  groupWork: z
    .object({
      minSize: z.coerce.number().int().min(2).max(MAX_GROUP_SIZE),
      maxSize: z.coerce.number().int().min(2).max(MAX_GROUP_SIZE),
    })
    .refine((value) => value.maxSize >= value.minSize, {
      message: 'errors.validation.group_size_range',
      path: ['maxSize'],
    })
    .optional(),
});
export type CreateAssessmentRequest = z.infer<typeof createAssessmentSchema>;

/**
 * Los companeros elegidos al empezar una actividad en grupo.
 *
 * Van SIN el propio alumno -es quien manda la peticion- y como maximo uno menos
 * que el tope: el servidor le anade a el antes de comprobar el tamano.
 */
export const startAttemptSchema = z.object({
  classroomId: uuidSchema.optional(),
  groupmateIds: z.array(uuidSchema).max(MAX_GROUP_SIZE - 1).optional(),
});
export type StartAttemptRequest = z.infer<typeof startAttemptSchema>;

export const addQuestionSchema = z
  .object({
    type: z.enum(SUPPORTED_QUESTION_TYPES),
    prompt: z.string().trim().min(3).max(2000),

    options: z.array(z.object({ text: z.string().trim().min(1).max(500) })).max(10).optional(),

    /**
     * Cuales son correctas, por POSICION en `options`.
     *
     * Por posicion y no por identificador: los identificadores los genera el
     * backend, y aceptarlos del cliente obligaria a validar que existen, que no
     * se repiten y que no pertenecen a otra pregunta. Con posiciones, el unico
     * error posible es un indice fuera de rango.
     */
    correctOptions: z.array(z.coerce.number().int().min(0)).max(10).optional(),

    /**
     * La columna DERECHA de una pregunta de emparejar.
     *
     * Puede tener mas elementos que `options`: un distractor a la derecha evita
     * que la ultima pareja se acierte por descarte.
     */
    matches: z.array(z.object({ text: z.string().trim().min(1).max(500) })).max(10).optional(),

    /**
     * Que va con que, por POSICION en cada columna.
     *
     * Por posicion y no por identificador, igual que `correctOptions`: los
     * identificadores los genera el backend, y aceptarlos del cliente obligaria
     * a validar que existen, que no se repiten y que no son de otra pregunta.
     */
    matchPairs: z
      .array(
        z.object({
          option: z.coerce.number().int().min(0),
          match: z.coerce.number().int().min(0),
        }),
      )
      .max(10)
      .optional(),

    points: z.coerce.number().int().min(1).max(100),
    explanation: z.string().trim().max(1000).optional(),

    /**
     * Rubrica de correccion, en las preguntas que corrige una persona.
     *
     * Su maximo tiene que COINCIDIR con `points`, y lo comprueba el dominio: si
     * diera menos, la pregunta seria imposible de sacar entera y nadie sabria
     * por que; si diera mas, el docente puntuaria todo y no podria cerrar la
     * nota.
     */
    rubric: z
      .object({
        criteria: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(60),
              label: z.string().trim().min(1).max(160),
              levels: z
                .array(
                  z.object({
                    label: z.string().trim().min(1).max(80),
                    points: z.coerce.number().int().min(0).max(100),
                    description: z.string().trim().max(500).optional(),
                  }),
                )
                .min(2)
                .max(6),
            }),
          )
          .min(1)
          .max(10),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    // Emparejar se valida aparte: su clave son `matchPairs` y no
    // `correctOptions`, asi que la regla de "marca cual es la correcta" no le
    // aplica y exigirsela lo dejaria sin poder crearse nunca.
    if (value.type === 'matching') {
      const izquierda = value.options ?? [];
      const derecha = value.matches ?? [];
      const pares = value.matchPairs ?? [];

      if (izquierda.length < 2 || derecha.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['matches'],
          message: 'errors.validation.matching_needs_two_columns',
        });
        return;
      }

      const opcionesUsadas = new Set(pares.map((par) => par.option));
      const parejasUsadas = new Set(pares.map((par) => par.match));

      // Toda la izquierda emparejada, sin repetir ninguna columna, y sin
      // apuntar fuera de rango. Sin esto se publica una pregunta que no se
      // puede acertar y no se descubre hasta que la hizo el salon entero.
      const valido =
        pares.length === izquierda.length &&
        opcionesUsadas.size === izquierda.length &&
        parejasUsadas.size === pares.length &&
        pares.every(
          (par) =>
            par.option < izquierda.length && par.match < derecha.length,
        );

      if (!valido) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['matchPairs'],
          message: 'errors.validation.matching_needs_all_pairs',
        });
      }

      return;
    }

    const needsOptions =
      value.type === 'single_choice' ||
      value.type === 'multiple_choice' ||
      value.type === 'true_false' ||
      value.type === 'ordering';

    if (!needsOptions) return;

    if (!value.options || value.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'errors.validation.question_needs_options',
      });
    }

    // Sin respuesta correcta, la correccion automatica daria cero a toda la
    // clase y nadie sabria por que. Es el error de captura mas comun y solo se
    // descubre cuando ya lo hizo el salon entero.
    if (!value.correctOptions || value.correctOptions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctOptions'],
        message: 'errors.validation.question_needs_correct_answer',
      });
    }

    // `ordering` lleva TODAS las posiciones, en el orden correcto: la clave de
    // una pregunta de ordenar es la secuencia entera, no una opcion suelta. Por
    // eso se le exige una permutacion completa y se le exime de la regla de
    // "una sola respuesta".
    if (value.type === 'ordering') {
      const total = value.options?.length ?? 0;
      const given = value.correctOptions ?? [];
      const distintas = new Set(given);

      // Sin esto, un docente que marque tres de cinco pasos publica una pregunta
      // que no se puede acertar: el alumno ordena cinco y la clave solo describe
      // tres. Y no se descubre hasta que el salon entero saca la misma nota
      // rara, que es exactamente el fallo que esta validacion existe para
      // evitar en las de marcar.
      if (given.length !== total || distintas.size !== total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctOptions'],
          message: 'errors.validation.ordering_needs_full_sequence',
        });
      }

      return;
    }

    if (value.type !== 'multiple_choice' && (value.correctOptions?.length ?? 0) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctOptions'],
        message: 'errors.validation.question_single_answer_expected',
      });
    }
  });
export type AddQuestionRequest = z.infer<typeof addQuestionSchema>;

export const saveAnswerSchema = z.object({
  questionId: uuidSchema,
  selectedOptionIds: z.array(uuidSchema).max(10).optional(),
  text: z.string().trim().max(10_000).optional(),
  /** Archivo subido o enlace compartido, por id de `media-service`. */
  mediaAssetId: uuidSchema.optional(),
  /**
   * Los pares que armo el alumno, en las preguntas de emparejar.
   *
   * Por IDENTIFICADOR y no por posicion, al contrario que en la captura: aqui
   * los identificadores ya existen y el alumno los recibio en `forStudent()`,
   * mientras que la columna derecha le llega desordenada -asi que una posicion
   * no significaria lo mismo para el servidor que para el navegador-.
   */
  pairs: z
    .array(z.object({ optionId: uuidSchema, matchId: uuidSchema }))
    .max(10)
    .optional(),
});
export type SaveAnswerRequest = z.infer<typeof saveAnswerSchema>;

export const gradeSubmissionSchema = z.object({
  grades: z
    .array(
      z.object({
        questionId: uuidSchema,
        points: z.coerce.number().int().min(0),
        feedback: z.string().trim().max(2000).optional(),

        /**
         * El nivel elegido en cada criterio, en las preguntas con rubrica.
         *
         * **Cuando la pregunta tiene rubrica, `points` se IGNORA y la nota sale
         * de aqui.** Lo decide el dominio y no este esquema: si el total
         * mandara, un `points` manipulado otorgaria mas de lo que la rubrica
         * permite y la comprobacion de "no mas del maximo de la pregunta" no lo
         * notaria mientras cupiera.
         */
        rubric: z
          .array(
            z.object({
              criterionId: z.string().trim().min(1).max(60),
              levelIndex: z.coerce.number().int().min(0).max(19),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1),
  feedback: z.string().trim().max(2000).optional(),
});
export type GradeSubmissionRequest = z.infer<typeof gradeSubmissionSchema>;

export const listAssessmentsSchema = z.object({
  kitId: uuidSchema.optional(),
  classroomId: uuidSchema.optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListAssessmentsQuery = z.infer<typeof listAssessmentsSchema>;
