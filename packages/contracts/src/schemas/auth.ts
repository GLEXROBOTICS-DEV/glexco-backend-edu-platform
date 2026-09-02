import { z } from 'zod';
import {
  emailSchema,
  localeSchema,
  passwordSchema,
  personNameSchema,
  uuidSchema,
} from './common';
import {
  ACTIVATION_CODE_LENGTH,
  ACTIVATION_CODE_PREFIX,
  GRADES,
  LOCALES,
} from '../domain/vocabulary';
import { ALL_ROLES, PORTALS, ROLES } from '../authorization/roles';

/**
 * Codigo impreso en el libro.
 *
 * Se acepta con o sin guiones y en cualquier capitalizacion, y se normaliza a
 * la forma canonica GLX-XXXX-XXXX-XXXX. Un nino copiando de un libro escribira
 * "glx 8f2k..." tanto como "GLX-8F2K-...": exigir un formato exacto solo genera
 * tickets de soporte.
 */
export const activationCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .refine(
    (value) => value.startsWith(ACTIVATION_CODE_PREFIX),
    'errors.validation.activation_code_invalid',
  )
  .refine(
    (value) => value.length === ACTIVATION_CODE_PREFIX.length + ACTIVATION_CODE_LENGTH,
    'errors.validation.activation_code_invalid',
  );

/**
 * Fecha de nacimiento. Se pide porque determina dos cosas con consecuencias
 * legales y de producto: si el registro necesita consentimiento de un adulto, y
 * si el alumno entra al portal Discover o al Academy.
 */
export const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'errors.validation.date_invalid')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return false;
    const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 4 && age <= 100;
  }, 'errors.validation.birth_date_out_of_range');

/**
 * Tipo de cuenta.
 *
 * `institutional` viene marcado por defecto en el formulario porque es el caso
 * mayoritario (el colegio compra los kits), pero el registro independiente debe
 * funcionar igual de bien: hay familias que compran el libro por su cuenta.
 */
export const ACCOUNT_TYPES = ['institutional', 'independent'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const baseRegistrationSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  birthDate: birthDateSchema,
  locale: localeSchema.default('es'),
  /** Consentimiento explicito de terminos y privacidad, con sello de tiempo en
   *  el servidor. Es un requisito legal, no una casilla decorativa. */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'errors.validation.terms_required' }),
  }),
  /** Correo del apoderado. Obligatorio para menores de 14: el aviso de creacion
   *  de cuenta y las notificaciones importantes van tambien a un adulto. */
  guardianEmail: emailSchema.optional(),
});

export const institutionalStudentRegistrationSchema = baseRegistrationSchema.extend({
  accountType: z.literal('institutional'),
  activationCode: activationCodeSchema,
  institutionId: uuidSchema,
  /** Salon elegido de la lista publica de la institucion. El backend verifica
   *  que pertenezca a esa institucion y que tenga cupo libre. */
  classroomId: uuidSchema,
  grade: z.nativeEnum(GRADES),
});

export const independentStudentRegistrationSchema = baseRegistrationSchema.extend({
  accountType: z.literal('independent'),
  activationCode: activationCodeSchema,
  grade: z.nativeEnum(GRADES),
});

export const studentRegistrationSchema = z
  .discriminatedUnion('accountType', [
    institutionalStudentRegistrationSchema,
    independentStudentRegistrationSchema,
  ])
  .superRefine((value, ctx) => {
    const birth = new Date(`${value.birthDate}T00:00:00Z`);
    const ageYears = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (ageYears < 14 && !value.guardianEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guardianEmail'],
        message: 'errors.validation.guardian_email_required',
      });
    }
  });

export type StudentRegistrationInput = z.infer<typeof studentRegistrationSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'errors.validation.password_required'),
  /** Sesion prolongada. Cambia la vida del refresh token, nunca la del access. */
  rememberMe: z.boolean().default(false),
  locale: localeSchema.default('es'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Acceso rapido por codigo institucional, tal como aparece en la pantalla de
 *  ingreso de la propuesta: identifica al colegio antes de pedir credenciales. */
export const institutionCodeLookupSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(4)
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'errors.validation.institution_code_invalid'),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
  locale: localeSchema.default('es'),
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20).max(512),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});

/**
 * Alta de personal (docente, administrador de institucion, empleado GLEXCO).
 *
 * `institutionId` es opcional en el esquema y NO se confia en el: para un actor
 * con ambito de institucion, el servidor ignora este campo y usa el del token.
 * Aceptarlo tal cual permitiria a un administrador crear docentes en otro
 * colegio con solo cambiar un valor del cuerpo.
 */
export const createStaffUserSchema = z.object({
  email: emailSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  role: z.enum([
    ROLES.TEACHER,
    ROLES.INSTITUTION_ADMIN,
    ROLES.CONTENT_MANAGER,
    ROLES.SUPPORT_AGENT,
    ROLES.COMMERCIAL_AGENT,
    ROLES.PLATFORM_ADMIN,
  ]),
  institutionId: uuidSchema.optional(),
  locale: localeSchema.default('es'),
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

/** Cierre de una sesion concreta del propio usuario. */
export const revokeSessionSchema = z.object({
  sessionId: uuidSchema.optional(),
});

/** Cambio de contrasena estando autenticado. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'errors.validation.password_required'),
  newPassword: passwordSchema,
  keepCurrentSession: z.boolean().default(true),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Perfil devuelto tras autenticarse. No incluye el hash ni datos sensibles. */
export const authenticatedUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  roles: z.array(z.enum(ALL_ROLES as unknown as [string, ...string[]])),
  permissions: z.array(z.string()),
  institutionId: uuidSchema.nullable(),
  institutionName: z.string().nullable(),
  /** Portal al que el frontend debe redirigir. */
  portal: z.enum([
    PORTALS.DISCOVER,
    PORTALS.ACADEMY,
    PORTALS.TEACHER,
    PORTALS.INSTITUTION,
    PORTALS.ADMIN,
  ]),
  locale: z.enum(LOCALES),
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/**
 * Respuesta de autenticacion.
 *
 * El access token viaja en el cuerpo y vive en memoria del cliente; el refresh
 * token NUNCA aparece aqui: se entrega en una cookie httpOnly, Secure y
 * SameSite, para que un XSS no pueda robarlo.
 */
export const authResultSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
  user: authenticatedUserSchema,
});
export type AuthResult = z.infer<typeof authResultSchema>;
