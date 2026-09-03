/**
 * Vocabulario ubicuo de GLEXCO.
 *
 * Todo termino que aparece en la propuesta de negocio se declara aqui una sola
 * vez y lo consumen backend y frontend. Las etiquetas visibles NO viven en este
 * archivo: son claves de traduccion (es/en) resueltas en el cliente, para que
 * anadir un idioma no obligue a tocar el dominio.
 */

// ---------------------------------------------------------------------------
// Programas y niveles educativos
// ---------------------------------------------------------------------------

/** Los dos grandes programas de la plataforma, tal como los nombra la propuesta. */
export const PROGRAMS = {
  /** Primaria, 6 a 12 anos. Interfaz ludica y gamificada. */
  DISCOVER: 'discover',
  /** Secundaria, tecnico-productiva, institutos y universidad. Interfaz sobria. */
  ACADEMY: 'academy',
} as const;
export type Program = (typeof PROGRAMS)[keyof typeof PROGRAMS];

export const EDUCATION_LEVELS = {
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  TECHNICAL: 'technical',
  HIGHER: 'higher',
  UNIVERSITY: 'university',
} as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[keyof typeof EDUCATION_LEVELS];

/** Nivel educativo -> programa que le corresponde al iniciar sesion. */
export const LEVEL_TO_PROGRAM: Record<EducationLevel, Program> = {
  [EDUCATION_LEVELS.PRIMARY]: PROGRAMS.DISCOVER,
  [EDUCATION_LEVELS.SECONDARY]: PROGRAMS.ACADEMY,
  [EDUCATION_LEVELS.TECHNICAL]: PROGRAMS.ACADEMY,
  [EDUCATION_LEVELS.HIGHER]: PROGRAMS.ACADEMY,
  [EDUCATION_LEVELS.UNIVERSITY]: PROGRAMS.ACADEMY,
};

/**
 * Grados del sistema educativo peruano. El grado importa porque cada grado
 * corresponde a un libro y ese libro a un kit: es la unidad que se compra.
 */
export const GRADES = {
  PRIMARY_1: 'primary_1',
  PRIMARY_2: 'primary_2',
  PRIMARY_3: 'primary_3',
  PRIMARY_4: 'primary_4',
  PRIMARY_5: 'primary_5',
  PRIMARY_6: 'primary_6',
  SECONDARY_1: 'secondary_1',
  SECONDARY_2: 'secondary_2',
  SECONDARY_3: 'secondary_3',
  SECONDARY_4: 'secondary_4',
  SECONDARY_5: 'secondary_5',
  /** Programas post-escolares donde el "grado" es un ciclo o una especialidad. */
  TECHNICAL_PROGRAM: 'technical_program',
  HIGHER_PROGRAM: 'higher_program',
} as const;
export type Grade = (typeof GRADES)[keyof typeof GRADES];

export const GRADE_LEVEL: Record<Grade, EducationLevel> = {
  [GRADES.PRIMARY_1]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.PRIMARY_2]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.PRIMARY_3]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.PRIMARY_4]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.PRIMARY_5]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.PRIMARY_6]: EDUCATION_LEVELS.PRIMARY,
  [GRADES.SECONDARY_1]: EDUCATION_LEVELS.SECONDARY,
  [GRADES.SECONDARY_2]: EDUCATION_LEVELS.SECONDARY,
  [GRADES.SECONDARY_3]: EDUCATION_LEVELS.SECONDARY,
  [GRADES.SECONDARY_4]: EDUCATION_LEVELS.SECONDARY,
  [GRADES.SECONDARY_5]: EDUCATION_LEVELS.SECONDARY,
  [GRADES.TECHNICAL_PROGRAM]: EDUCATION_LEVELS.TECHNICAL,
  [GRADES.HIGHER_PROGRAM]: EDUCATION_LEVELS.HIGHER,
};

/**
 * Escuelas de la ruta tecnologica GLEXCO (propuesta, Interfaz 2).
 * Vocacional -> Tecnica -> Superior -> Especializacion -> Certificacion.
 */
export const ACADEMY_TRACKS = {
  VOCATIONAL: 'vocational',
  VOCATIONAL_AND_HIGHER: 'vocational_and_higher',
  HIGHER_AND_UNIVERSITY: 'higher_and_university',
} as const;
export type AcademyTrack = (typeof ACADEMY_TRACKS)[keyof typeof ACADEMY_TRACKS];

// ---------------------------------------------------------------------------
// Plataformas roboticas
// ---------------------------------------------------------------------------

/**
 * Catalogo de robots UBTECH / GLEXCO.
 *
 * Se modela como dato semilla y no como tabla libre porque el contenido, los
 * cursos y los kits se cuelgan de estas claves. Anadir un robot nuevo es una
 * migracion de datos, no un cambio de esquema.
 */
export const ROBOT_PLATFORMS = {
  UKIT_AI: 'ukit_ai',
  UKIT_EXPLORE: 'ukit_explore',
  UGOT: 'ugot',
  YANSHEE: 'yanshee',
  AI_BOX_PRO: 'ai_box_pro',
  CREABOT: 'creabot',
  DOBOT_MAGICIAN_E6: 'dobot_magician_e6',
  CADEBOT: 'cadebot',
  CRUZR: 'cruzr',
  GO2: 'go2',
  GLEX_1: 'glex_1',
  XPERTUS: 'xpertus',
} as const;
export type RobotPlatform = (typeof ROBOT_PLATFORMS)[keyof typeof ROBOT_PLATFORMS];

export const ROBOT_PROGRAM: Record<RobotPlatform, Program> = {
  [ROBOT_PLATFORMS.UKIT_AI]: PROGRAMS.DISCOVER,
  [ROBOT_PLATFORMS.UKIT_EXPLORE]: PROGRAMS.DISCOVER,
  [ROBOT_PLATFORMS.UGOT]: PROGRAMS.DISCOVER,
  [ROBOT_PLATFORMS.YANSHEE]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.AI_BOX_PRO]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.CREABOT]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.DOBOT_MAGICIAN_E6]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.CADEBOT]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.CRUZR]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.GO2]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.GLEX_1]: PROGRAMS.ACADEMY,
  [ROBOT_PLATFORMS.XPERTUS]: PROGRAMS.ACADEMY,
};

// ---------------------------------------------------------------------------
// Contenido
// ---------------------------------------------------------------------------

export const CONTENT_TYPES = {
  VIDEO: 'video',
  DOCUMENT: 'document',
  PRESENTATION: 'presentation',
  WORKSHEET: 'worksheet',
  GUIDE: 'guide',
  MANUAL: 'manual',
  TUTORIAL: 'tutorial',
  WEBINAR: 'webinar',
  MASTERCLASS: 'masterclass',
  CODE_SAMPLE: 'code_sample',
  BUILD_INSTRUCTION: 'build_instruction',
  EXTERNAL_LINK: 'external_link',
} as const;
export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

/**
 * Donde vive fisicamente el archivo. La estrategia es hibrida:
 * - `object_storage`: PDFs, PPTs, fichas y descargables, en bucket privado con
 *   URL prefirmada de vida corta.
 * - `video_provider`: videos largos en un proveedor con restriccion de dominio,
 *   porque servir video desde nuestro propio ancho de banda es lo primero que
 *   dispara la factura.
 * - `external_link`: recursos de terceros que solo referenciamos.
 */
export const STORAGE_KINDS = {
  OBJECT_STORAGE: 'object_storage',
  VIDEO_PROVIDER: 'video_provider',
  EXTERNAL_LINK: 'external_link',
} as const;
export type StorageKind = (typeof STORAGE_KINDS)[keyof typeof STORAGE_KINDS];

export const PUBLICATION_STATUS = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;
export type PublicationStatus = (typeof PUBLICATION_STATUS)[keyof typeof PUBLICATION_STATUS];

// ---------------------------------------------------------------------------
// Progreso y evaluacion
// ---------------------------------------------------------------------------

export const PROGRESS_STATUS = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;
export type ProgressStatus = (typeof PROGRESS_STATUS)[keyof typeof PROGRESS_STATUS];

export const ASSESSMENT_TYPES = {
  QUIZ: 'quiz',
  PRACTICAL: 'practical',
  PROJECT: 'project',
  STEM_ACTIVITY: 'stem_activity',
} as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[keyof typeof ASSESSMENT_TYPES];

export const QUESTION_TYPES = {
  SINGLE_CHOICE: 'single_choice',
  MULTIPLE_CHOICE: 'multiple_choice',
  TRUE_FALSE: 'true_false',
  SHORT_ANSWER: 'short_answer',
  ORDERING: 'ordering',
  MATCHING: 'matching',
  /** El alumno sube foto o video de su construccion; lo califica el docente. */
  FILE_UPLOAD: 'file_upload',
} as const;
export type QuestionType = (typeof QUESTION_TYPES)[keyof typeof QUESTION_TYPES];

export const SUBMISSION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  AUTO_GRADED: 'auto_graded',
  PENDING_REVIEW: 'pending_review',
  GRADED: 'graded',
  RETURNED: 'returned',
} as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];

// ---------------------------------------------------------------------------
// Gamificacion (solo relevante en Discover, pero el modelo es comun)
// ---------------------------------------------------------------------------

/** Niveles del Explorador, Interfaz 1 de la propuesta. */
export const EXPLORER_LEVELS = [
  { level: 1, key: 'explorer', minXp: 0 },
  { level: 2, key: 'inventor', minXp: 500 },
  { level: 3, key: 'builder', minXp: 1500 },
  { level: 4, key: 'innovator', minXp: 3500 },
  { level: 5, key: 'robotics_master', minXp: 7000 },
] as const;

export const BADGE_CATEGORIES = {
  PARTICIPATION: 'participation',
  PERFORMANCE: 'performance',
  CREATIVITY: 'creativity',
  SKILL: 'skill',
  MILESTONE: 'milestone',
} as const;
export type BadgeCategory = (typeof BADGE_CATEGORIES)[keyof typeof BADGE_CATEGORIES];

// ---------------------------------------------------------------------------
// Instituciones y licencias
// ---------------------------------------------------------------------------

export const INSTITUTION_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  ARCHIVED: 'archived',
} as const;
export type InstitutionStatus = (typeof INSTITUTION_STATUS)[keyof typeof INSTITUTION_STATUS];

export const LICENSE_STATUS = {
  ACTIVE: 'active',
  EXPIRING_SOON: 'expiring_soon',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;
export type LicenseStatus = (typeof LICENSE_STATUS)[keyof typeof LICENSE_STATUS];

// ---------------------------------------------------------------------------
// Codigos de activacion de libro/kit
// ---------------------------------------------------------------------------

export const ACTIVATION_CODE_STATUS = {
  /** Generado, aun no impreso ni entregado. */
  ISSUED: 'issued',
  /** Entregado a una institucion o punto de venta. */
  DISTRIBUTED: 'distributed',
  /** Canjeado por un alumno. A partir de aqui no se puede volver a usar. */
  REDEEMED: 'redeemed',
  /** Anulado por GLEXCO (error de impresion, devolucion, fraude). */
  REVOKED: 'revoked',
  /** Paso su fecha limite sin canjearse. */
  EXPIRED: 'expired',
} as const;
export type ActivationCodeStatus =
  (typeof ACTIVATION_CODE_STATUS)[keyof typeof ACTIVATION_CODE_STATUS];

/**
 * Alfabeto de los codigos impresos en el libro.
 *
 * Excluye 0/O/1/I/L para que un nino no pierda su acceso por transcribir mal un
 * caracter ambiguo desde papel. Quedan 31 simbolos; con 12 posiciones el espacio
 * es de 31^12 (~7.9e17), asi que adivinar un codigo valido es inviable incluso
 * antes de aplicar la limitacion de intentos por IP y por cuenta.
 */
export const ACTIVATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ACTIVATION_CODE_LENGTH = 12;
/** Formato mostrado al usuario: GLX-XXXX-XXXX-XXXX */
export const ACTIVATION_CODE_PREFIX = 'GLX';

/**
 * Tope de codigos por lote.
 *
 * No es un limite tecnico sino de operacion: cien mil codigos son una tirada de
 * imprenta grande y ya pesan unos dos megabytes de CSV. Un lote mayor casi
 * siempre significa un cero de mas al teclear, y como los codigos en claro solo
 * existen una vez, retirarlo despues no es trivial.
 */
export const MAX_CODE_BATCH_SIZE = 100_000;

// ---------------------------------------------------------------------------
// Salones
// ---------------------------------------------------------------------------

/** Tope por defecto de un salon. La propuesta pide topes configurables (ej. 20). */
export const DEFAULT_CLASSROOM_CAPACITY = 30;
export const MAX_CLASSROOM_CAPACITY = 60;

export const ENROLLMENT_STATUS = {
  ACTIVE: 'active',
  /** El alumno cambio de salon o de colegio; se conserva el historial. */
  TRANSFERRED: 'transferred',
  WITHDRAWN: 'withdrawn',
  COMPLETED: 'completed',
} as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUS)[keyof typeof ENROLLMENT_STATUS];

// ---------------------------------------------------------------------------
// Idiomas
// ---------------------------------------------------------------------------

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';
