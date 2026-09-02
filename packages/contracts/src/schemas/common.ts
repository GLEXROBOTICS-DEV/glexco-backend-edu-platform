import { z } from 'zod';
import { LOCALES } from '../domain/vocabulary';

/**
 * Primitivas de validacion compartidas por backend y frontend.
 *
 * Una sola definicion evita el problema clasico de que el formulario acepte algo
 * que la API rechaza. El frontend valida con el mismo esquema para dar
 * retroalimentacion inmediata; el backend lo valida otra vez porque la
 * validacion de cliente es comodidad, nunca seguridad.
 */

export const uuidSchema = z.string().uuid('errors.validation.invalid_id');

export const localeSchema = z.enum(LOCALES);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'errors.validation.email_invalid')
  .max(254, 'errors.validation.email_too_long')
  .email('errors.validation.email_invalid');

/**
 * Politica de contrasenas alineada con NIST SP 800-63B.
 *
 * Longitud minima generosa y sin exigir simbolos ni mayusculas: las reglas de
 * composicion empujan a la gente a patrones predecibles ("Password1!") y aqui
 * hay ninos de 6 anos escribiendo su clave. El rechazo de contrasenas filtradas
 * o triviales se hace en el servidor contra una lista, que es lo que de verdad
 * reduce el riesgo.
 *
 * El maximo de 128 tambien frena un DoS por hash de cadenas enormes, que con
 * argon2 cuesta memoria real por peticion.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'errors.validation.password_too_short')
  .max(PASSWORD_MAX_LENGTH, 'errors.validation.password_too_long')
  .refine((value) => value.trim().length > 0, 'errors.validation.password_blank');

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'errors.validation.name_too_short')
  .max(80, 'errors.validation.name_too_long')
  // Letras (con tildes y enie), espacios, apostrofes, puntos y guiones. Sin
  // digitos ni simbolos, que en este campo casi siempre son ruido o inyeccion.
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u, 'errors.validation.name_invalid');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'errors.validation.slug_invalid');

/**
 * Caracteres de control que nunca deben llegar a un texto visible.
 *
 * Se comprueba recorriendo puntos de codigo en vez de con una expresion regular
 * con escapes literales: mas legible y sin sorpresas de codificacion al pasar el
 * archivo por herramientas intermedias.
 */
const ALLOWED_CONTROL_CODES = new Set([9, 10, 13]); // tabulador, LF, CR

export function hasForbiddenControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (ALLOWED_CONTROL_CODES.has(code)) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Texto libre visible por otros usuarios (anuncios, descripciones).
 * Se sanea en el servidor antes de guardar; aqui solo limitamos tamano y
 * rechazamos caracteres de control que rompen el renderizado.
 */
export const richTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'errors.validation.text_too_long')
    .refine((value) => !hasForbiddenControlChars(value), 'errors.validation.text_invalid');

export const cursorPageQuerySchema = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export const cursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    estimatedTotal: z.number().int().nonnegative().optional(),
  });

/** Sobre de error uniforme que devuelve el gateway. El frontend traduce por `code`. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  correlationId: z.string(),
  /** Campos con error, para pintarlos en el formulario. */
  fieldErrors: z.record(z.array(z.string())).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
