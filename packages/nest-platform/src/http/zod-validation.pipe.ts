import { type ArgumentMetadata, HttpException, HttpStatus, type PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, ZodError } from 'zod';
import { getRequestContext } from '@glexco/observability';

/**
 * Valida y NORMALIZA la entrada con el mismo esquema Zod que usa el formulario
 * del frontend.
 *
 * Que devuelva el dato parseado (y no el original) es intencional: el esquema
 * recorta espacios, pasa el correo a minusculas y normaliza el codigo de
 * activacion, asi que el caso de uso recibe siempre datos en forma canonica y no
 * tiene que repetir esa limpieza.
 *
 * Los mensajes son claves de traduccion, no frases: el cliente decide en que
 * idioma mostrarlas.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new HttpException(
      {
        code: 'VALIDATION_FAILED',
        message: 'Los datos enviados no son validos.',
        fieldErrors: toFieldErrors(result.error),
        correlationId: getRequestContext()?.correlationId ?? 'unknown',
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** Agrupa los problemas por campo para que el formulario los pinte en su sitio. */
function toFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/** Azucar para usarlo en un parametro: `@Body(zodBody(loginSchema)) input: LoginInput` */
export const zodBody = <T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
