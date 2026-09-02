import { z } from 'zod';
import { emailSchema, localeSchema, personNameSchema, uuidSchema } from './common';
import {
  DEFAULT_CLASSROOM_CAPACITY,
  EDUCATION_LEVELS,
  GRADES,
  MAX_CLASSROOM_CAPACITY,
} from '../domain/vocabulary';

/**
 * Codigo institucional.
 *
 * Se acepta con separadores y en cualquier capitalizacion: en el papel se
 * escribe "SJB-2026" y en la web lo teclean como "sjb2026" o "SJB 2026". Exigir
 * un formato exacto solo genera tickets de soporte.
 */
export const institutionCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[\s\-_.]/g, ''))
  .refine((value) => /^[A-Z0-9]{4,12}$/.test(value), 'errors.validation.institution_code_invalid');

export const createInstitutionSchema = z.object({
  code: institutionCodeSchema,
  name: z.string().trim().min(3).max(200),
  shortName: z.string().trim().min(2).max(40).optional(),
  educationLevels: z
    .array(z.nativeEnum(EDUCATION_LEVELS))
    .min(1, 'errors.validation.education_levels_required'),
  responsibleName: personNameSchema,
  contactEmail: emailSchema,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s()-]{6,20}$/, 'errors.validation.phone_invalid')
    .optional(),
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200).optional(),
});
export type CreateInstitutionRequest = z.infer<typeof createInstitutionSchema>;

export const grantLicenseSchema = z
  .object({
    seats: z.coerce.number().int().min(1).max(100_000),
    startsAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    reference: z.string().trim().max(120).optional(),
  })
  .refine(
    (value) => new Date(value.expiresAt) > new Date(value.startsAt),
    { message: 'errors.validation.license_period_invalid', path: ['expiresAt'] },
  );
export type GrantLicenseRequest = z.infer<typeof grantLicenseSchema>;

export const createClassroomSchema = z.object({
  name: z.string().trim().min(1).max(60),
  grade: z.nativeEnum(GRADES),
  /** Tope de plazas. La propuesta pone 20 como ejemplo; por defecto son 30. */
  capacity: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_CLASSROOM_CAPACITY)
    .default(DEFAULT_CLASSROOM_CAPACITY),
  academicYear: z.coerce.number().int().min(2020).max(2100).optional(),
  /** Solo un administrador puede asignar el salon a otro docente. */
  teacherId: uuidSchema.optional(),
  /** Se ignora salvo para el personal GLEXCO: para los demas se toma del token. */
  institutionId: uuidSchema.optional(),
});
export type CreateClassroomRequest = z.infer<typeof createClassroomSchema>;

export const updateClassroomSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    capacity: z.coerce.number().int().min(1).max(MAX_CLASSROOM_CAPACITY).optional(),
    teacherId: uuidSchema.optional(),
    archive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'errors.validation.no_changes_provided',
  });
export type UpdateClassroomRequest = z.infer<typeof updateClassroomSchema>;

export const listClassroomsQuerySchema = z.object({
  academicYear: z.coerce.number().int().min(2020).max(2100).optional(),
  grade: z.nativeEnum(GRADES).optional(),
  teacherId: uuidSchema.optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export type ListClassroomsQuery = z.infer<typeof listClassroomsQuerySchema>;

/** Consulta publica del formulario de registro. */
export const selectableClassroomsQuerySchema = z.object({
  institutionId: uuidSchema,
  grade: z.nativeEnum(GRADES),
  academicYear: z.coerce.number().int().min(2020).max(2100).optional(),
});
export type SelectableClassroomsQuery = z.infer<typeof selectableClassroomsQuerySchema>;

export const enrollStudentSchema = z.object({
  studentId: uuidSchema,
  kitId: uuidSchema.optional(),
});

/**
 * Salon tal como lo ve el formulario de registro.
 *
 * Devuelve `hasCapacity` y NO el conteo exacto: el numero permitiria a un
 * tercero medir la matricula de un colegio sondeando un endpoint publico.
 */
export const selectableClassroomSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  teacherName: z.string().nullable(),
  hasCapacity: z.boolean(),
});
export type SelectableClassroomResponse = z.infer<typeof selectableClassroomSchema>;

/** Institucion tal como la ve la pantalla de ingreso. Datos minimos. */
export const publicInstitutionSchema = z.object({
  institutionId: uuidSchema,
  name: z.string(),
  shortName: z.string(),
  city: z.string(),
  educationLevels: z.array(z.nativeEnum(EDUCATION_LEVELS)),
});

export const classroomSummarySchema = z.object({
  id: uuidSchema,
  institutionId: uuidSchema,
  teacherId: uuidSchema,
  teacherName: z.string().nullable(),
  name: z.string(),
  grade: z.nativeEnum(GRADES),
  capacity: z.number().int(),
  enrolledCount: z.number().int(),
  availableSeats: z.number().int(),
  academicYear: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type ClassroomSummaryResponse = z.infer<typeof classroomSummarySchema>;

export const institutionLocaleSchema = localeSchema;
