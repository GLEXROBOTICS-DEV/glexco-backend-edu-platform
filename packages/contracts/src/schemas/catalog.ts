import { z } from 'zod';
import { uuidSchema } from './common';
import { MAX_CODE_BATCH_SIZE } from '../domain/vocabulary';

/**
 * Peticion de generacion de un lote de codigos de activacion.
 *
 * Un lote es una tirada de imprenta: se pide una vez, se exporta, y los codigos
 * en claro no vuelven a existir. Por eso los limites son estrictos aqui y no
 * "ya lo validara el dominio": una cifra mal tecleada -un cero de mas- imprime
 * un millon de codigos que consumen espacio de claves y no se pueden retirar
 * facilmente.
 */
export const generateCodeBatchSchema = z.object({
  kitId: uuidSchema,

  size: z.coerce
    .number()
    .int('errors.validation.batch_size_invalid')
    .min(1, 'errors.validation.batch_size_invalid')
    .max(MAX_CODE_BATCH_SIZE, 'errors.validation.batch_size_too_large'),

  /**
   * Institucion a la que se destina la tirada, si es un pedido nominal.
   * Vacio para stock general de imprenta.
   */
  distributedTo: uuidSchema.optional(),

  /** Orden de compra, numero de pedido o lo que permita rastrear la tirada. */
  reference: z.string().trim().max(120).optional(),

  /**
   * Caducidad opcional. La mayoria de los codigos no caducan -un libro comprado
   * sigue valiendo el curso siguiente-, pero una promocion o una muestra si.
   */
  expiresAt: z
    .string()
    .datetime({ message: 'errors.validation.date_invalid' })
    .optional(),

  /**
   * Formato de la respuesta. `csv` es lo que se envia a imprenta.
   *
   * No existe un endpoint para descargar el CSV mas tarde, y no es un olvido:
   * en la base solo queda el hash de cada codigo, asi que reconstruir el
   * fichero es imposible por diseno. Quien genera el lote guarda esta respuesta
   * o repite la tirada.
   */
  format: z.enum(['json', 'csv']).default('json'),
});
export type GenerateCodeBatchRequest = z.infer<typeof generateCodeBatchSchema>;

export const listCodeBatchesSchema = z.object({
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCodeBatchesQuery = z.infer<typeof listCodeBatchesSchema>;
