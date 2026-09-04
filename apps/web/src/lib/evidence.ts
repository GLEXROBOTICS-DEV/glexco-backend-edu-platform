import { EVIDENCE_UPLOAD_TYPES } from '@glexco/contracts';
import { api } from './api';

/**
 * Entrega de EVIDENCIA de un reto: una foto, o el enlace a un vídeo de fuera.
 *
 * **Es OPCIONAL, y así trabajan de verdad.** La mayoría de las veces el docente
 * revisa el montaje en clase y en la plataforma solo registra la nota. La
 * evidencia existe para el caso a distancia, y para dejar constancia de que algo
 * se hizo cuando nadie estaba delante.
 *
 * **El vídeo NO se sube aquí.** El alumno lo publica donde ya lo tiene -YouTube,
 * Drive, el Stream de su centro- y envía el enlace; el docente lo ve allí. Servir
 * vídeo desde nuestro ancho de banda es lo primero que dispara la factura, y el
 * proveedor externo todavía no está contratado. Lo que sí se sube es una FOTO
 * que demuestre que está hecho, que es lo que pesa poco y se mira de un vistazo.
 *
 * La restricción vive en el servicio de medios (`SCOPE_TYPES`), no solo aquí:
 * esta lista es comodidad para el selector de archivos, y quien llame a la API
 * directamente se saltaría cualquier límite que solo viviera en el frontend.
 *
 * **Todo ocurre en el SERVIDOR, dentro de la Server Action.** Es lo que hace que
 * el formulario siga funcionando sin JavaScript: el navegador envía el fichero
 * como cualquier `multipart/form-data` y desde aquí se habla con el almacén.
 * La alternativa habitual -pedir la URL prefirmada desde el navegador y subir
 * con `fetch`- exige JavaScript para lo único que el alumno tiene que poder
 * hacer en un laboratorio con equipos viejos: entregar.
 */

const ACCEPTED: Set<string> = new Set(EVIDENCE_UPLOAD_TYPES);

export interface EvidenceResult {
  mediaAssetId?: string;
  error?: string;
}

/**
 * Sube un fichero y devuelve su identificador de recurso.
 *
 * Tres pasos, y el tercero es el que importa: **confirmar**. Hasta que no se
 * confirma, el recurso está en `pending` y el servicio mira sus bytes de verdad
 * para comprobar que el tipo declarado es el tipo real. Guardar el identificador
 * sin confirmar dejaría la respuesta apuntando a algo que puede no ser una
 * imagen, y el docente abriría un archivo que nadie ha validado.
 */
export async function uploadEvidence(file: File): Promise<EvidenceResult> {
  if (file.size === 0) return {};

  if (!ACCEPTED.has(file.type)) {
    // Se nombra la alternativa en vez de dejarlo en "no se admite": quien
    // intenta subir un vídeo tiene que saber que su sitio es el campo del
    // enlace, no que la plataforma no lo quiere.
    return {
      error: file.type.startsWith('video/')
        ? 'El vídeo no se sube aquí: publícalo en YouTube o Drive y pega el enlace en el campo de abajo.'
        : 'Ese tipo de archivo no se admite. Sube una foto o un PDF.',
    };
  }

  const requested = await api<{
    mediaAssetId: string;
    url: string;
    fields: Record<string, string>;
    maxBytes: number;
  }>('/media/uploads', {
    method: 'POST',
    body: {
      scope: 'evidence',
      mimeType: file.type,
      filename: file.name,
      sizeBytes: file.size,
    },
  });

  if (!requested.ok) {
    // El límite de tamaño se rechaza aquí, antes de firmar nada, así que este
    // mensaje es el que más se va a ver: conviene que diga qué hacer.
    return {
      error:
        requested.error.code === 'MEDIA_TOO_LARGE'
          ? 'El archivo es demasiado grande. Prueba con una foto o un vídeo más corto.'
          : 'No pudimos preparar la entrega de tu archivo. Vuelve a intentarlo.',
    };
  }

  const { mediaAssetId, url, fields } = requested.data;

  // Subida directa al almacén con la política prefirmada. El fichero NO pasa por
  // nuestro backend: con un aula entera subiendo vídeos a la vez, reenviarlos
  // ocuparía el pool de peticiones del servicio sin ninguna razón de negocio.
  const upload = new FormData();
  for (const [name, value] of Object.entries(fields)) upload.append(name, value);
  upload.append('file', file, file.name);

  const stored = await fetch(url, { method: 'POST', body: upload }).catch(() => null);

  if (!stored || !stored.ok) {
    return { error: 'No pudimos guardar tu archivo. Comprueba tu conexión y vuelve a intentarlo.' };
  }

  const confirmed = await api<{ status: 'ready' | 'rejected'; reason?: string }>(
    `/media/uploads/${mediaAssetId}/confirm`,
    { method: 'POST', body: {} },
  );

  if (!confirmed.ok) {
    return { error: 'Tu archivo se subió pero no pudimos validarlo. Vuelve a intentarlo.' };
  }

  if (confirmed.data.status === 'rejected') {
    // El servicio miró los BYTES y no coinciden con lo declarado. No es un fallo
    // nuestro y reintentar el mismo archivo no va a cambiarlo.
    return {
      error: 'Ese archivo no parece ser lo que dice ser. Vuelve a exportarlo y súbelo otra vez.',
    };
  }

  return { mediaAssetId };
}

/**
 * Registra un enlace externo como evidencia.
 *
 * La validación de verdad -https, sin credenciales en la URL, sin acortador- la
 * hace el backend. Aquí solo se ahorra el viaje obvio.
 */
export async function shareEvidenceLink(url: string, title: string): Promise<EvidenceResult> {
  const limpio = url.trim();
  if (limpio.length === 0) return {};

  if (!/^https?:\/\//i.test(limpio)) {
    return { error: 'El enlace tiene que empezar por https://' };
  }

  const created = await api<{ mediaAssetId: string }>('/media/links', {
    method: 'POST',
    body: {
      scope: 'evidence',
      url: limpio,
      // Sin título el docente vería una lista de enlaces sin saber de qué es
      // cada uno. Se usa el enunciado de la pregunta, que es lo que lo describe.
      title: title.slice(0, 200),
    },
  });

  if (!created.ok) {
    return {
      error:
        created.error.code === 'MEDIA_LINK_NOT_ALLOWED'
          ? 'Ese enlace no se admite. Usa uno de tu colegio, de Drive o de YouTube.'
          : 'No pudimos guardar tu enlace. Comprueba que esté bien copiado.',
    };
  }

  return { mediaAssetId: created.data.mediaAssetId };
}

export interface OpenedEvidence {
  mediaAssetId: string;
  /** Firmada y de vida corta para lo subido; la dirección tal cual para un enlace. */
  url: string;
  kind: 'image' | 'video' | 'document' | 'link';
  title: string;
}

/**
 * Abre la evidencia para que el DOCENTE la vea.
 *
 * Era el otro lado del mismo hueco: la pantalla de corrección decía «Entregó un
 * archivo o un enlace» y no lo enseñaba. Corregir un montaje a partir de una
 * foto que no se puede abrir no es corregir, es firmar a ciegas.
 *
 * La URL se pide AL RENDERIZAR y no se guarda en ningún sitio: dura minutos y
 * los buckets son privados. Cachearla la convertiría en un enlace público a la
 * evidencia de un menor, que es exactamente lo que la firma de vida corta
 * existe para evitar.
 */
export async function openEvidence(mediaAssetId: string): Promise<OpenedEvidence | null> {
  const result = await api<{
    url: string;
    mimeType?: string | null;
    title?: string | null;
    kind?: string | null;
  }>(`/media/${encodeURIComponent(mediaAssetId)}/url`);

  if (!result.ok) {
    // No se lanza: el docente tiene que poder seguir corrigiendo el resto de la
    // entrega aunque el almacén no responda en este instante.
    console.error('No se pudo abrir la evidencia', {
      mediaAssetId,
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return null;
  }

  const mime = result.data.mimeType ?? '';

  // `external/link` es lo que devuelve el servicio para un enlace compartido.
  // Se mira ESE valor y no la forma de la URL: la firmada de S3 también empieza
  // por `https`, así que distinguirlas por el protocolo no distingue nada.
  return {
    mediaAssetId,
    url: result.data.url,
    kind:
      mime === 'external/link'
        ? 'link'
        : mime.startsWith('image/')
          ? 'image'
          : mime.startsWith('video/')
            ? 'video'
            : 'document',
    title: result.data.title ?? 'Entrega del alumno',
  };
}
