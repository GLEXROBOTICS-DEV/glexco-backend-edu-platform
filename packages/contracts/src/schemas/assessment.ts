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
 * `ordering` y `matching` existen en el vocabulario pero todavia no se admiten:
 * su correccion automatica no esta escrita, y aceptarlos daria cero a todo el
 * mundo sin que nadie entendiera por que.
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
  QUESTION_TYPES.FILE_UPLOAD,
] as const;

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
});
export type CreateAssessmentRequest = z.infer<typeof createAssessmentSchema>;

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

    points: z.coerce.number().int().min(1).max(100),
    explanation: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
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
});
export type SaveAnswerRequest = z.infer<typeof saveAnswerSchema>;

export const gradeSubmissionSchema = z.object({
  grades: z
    .array(
      z.object({
        questionId: uuidSchema,
        points: z.coerce.number().int().min(0),
        feedback: z.string().trim().max(2000).optional(),
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
