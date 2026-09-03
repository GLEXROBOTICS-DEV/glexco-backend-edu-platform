import { z } from 'zod';

/**
 * Tipos de archivo que la plataforma admite subir.
 *
 * La lista es cerrada y se comparte con el frontend, para que el selector de
 * archivos ofrezca exactamente lo mismo que el backend acepta. Aun asi el
 * backend revalida y, sobre todo, comprueba la firma binaria del archivo ya
 * subido: esto de aqui es comodidad para el usuario, no seguridad.
 */
export const ACCEPTED_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
] as const;

export const uploadScopeSchema = z.enum(['evidence', 'content', 'avatar', 'document']);
export type UploadScope = z.infer<typeof uploadScopeSchema>;

export const requestUploadSchema = z.object({
  scope: uploadScopeSchema,
  mimeType: z.enum(ACCEPTED_UPLOAD_TYPES, {
    errorMap: () => ({ message: 'errors.validation.media_type_not_accepted' }),
  }),

  /**
   * Nombre original, solo para mostrarselo al usuario.
   *
   * NO se usa para construir la ruta en el almacen: esa la deriva el dominio del
   * id del recurso. Un nombre que viniera del cliente puede llevar `../` y
   * escribir donde no debe, o pisar el archivo de otra persona.
   */
  filename: z.string().trim().min(1).max(255),

  /** Tamano declarado. Permite rechazar antes de firmar nada; el limite de
   *  verdad lo aplica la politica de la URL prefirmada. */
  sizeBytes: z.coerce.number().int().positive(),
});
export type RequestUploadRequest = z.infer<typeof requestUploadSchema>;

/**
 * Compartir material alojado fuera de la plataforma.
 *
 * Es el flujo que ya usan los centros: el video de la exposicion vive en el
 * OneDrive de la universidad y lo que circula es el enlace. La validacion de
 * verdad -https, sin credenciales, sin acortador, dominio en lista blanca- la
 * hace el backend; esto solo evita el viaje de ida y vuelta obvio.
 */
export const shareLinkSchema = z.object({
  scope: uploadScopeSchema,
  url: z.string().trim().url('errors.validation.link_malformed').max(2048),
  /** Como lo vera el docente en su listado. */
  title: z.string().trim().min(1).max(200),
});
export type ShareLinkRequest = z.infer<typeof shareLinkSchema>;
