import { ValidationError } from '../errors/domain-error';

/**
 * Aserciones de invariantes para constructores de objetos de valor y agregados.
 *
 * Se usan en el dominio, donde no existe la nocion de "peticion HTTP": cada
 * fallo lanza una ValidationError con un codigo estable que el frontend traduce.
 */
export const Guard = {
  againstNullOrUndefined(value: unknown, field: string): void {
    if (value === null || value === undefined) {
      throw new ValidationError('FIELD_REQUIRED', `El campo ${field} es obligatorio.`, { field });
    }
  },

  againstEmpty(value: string | null | undefined, field: string): void {
    if (value === null || value === undefined || value.trim().length === 0) {
      throw new ValidationError('FIELD_REQUIRED', `El campo ${field} es obligatorio.`, { field });
    }
  },

  lengthBetween(value: string, min: number, max: number, field: string): void {
    const length = [...value].length;
    if (length < min || length > max) {
      throw new ValidationError(
        'FIELD_LENGTH_OUT_OF_RANGE',
        `El campo ${field} debe tener entre ${min} y ${max} caracteres.`,
        { field, min, max, actual: length },
      );
    }
  },

  inRange(value: number, min: number, max: number, field: string): void {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new ValidationError(
        'FIELD_OUT_OF_RANGE',
        `El campo ${field} debe estar entre ${min} y ${max}.`,
        { field, min, max, actual: value },
      );
    }
  },

  isPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ValidationError(
        'FIELD_MUST_BE_POSITIVE_INTEGER',
        `El campo ${field} debe ser un entero mayor que cero.`,
        { field, actual: value },
      );
    }
  },

  matches(value: string, pattern: RegExp, field: string, code = 'FIELD_INVALID_FORMAT'): void {
    if (!pattern.test(value)) {
      throw new ValidationError(code, `El campo ${field} no tiene el formato esperado.`, { field });
    }
  },

  oneOf<T>(value: T, allowed: readonly T[], field: string): void {
    if (!allowed.includes(value)) {
      throw new ValidationError('FIELD_NOT_ALLOWED', `El campo ${field} tiene un valor no permitido.`, {
        field,
        allowed,
      });
    }
  },

  /** Asercion generica para reglas que no encajan en las anteriores. */
  that(condition: boolean, code: string, message: string, details?: Record<string, unknown>): void {
    if (!condition) throw new ValidationError(code, message, details);
  },
};
