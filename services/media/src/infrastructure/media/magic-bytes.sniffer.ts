import type { ContentSniffer } from '../../application/ports';

/**
 * Detecta el tipo real de un fichero por su firma binaria.
 *
 * Se escribe a mano en vez de traer una libreria de deteccion, y no por
 * minimalismo: la lista de tipos que esta plataforma acepta es cerrada y muy
 * corta, y una libreria generica reconoce cientos de formatos. Eso amplia la
 * superficie en la direccion equivocada -lo que interesa es rechazar todo lo que
 * no este en la lista- y hace que la comprobacion que decide si un fichero entra
 * al bucket dependa de codigo que nadie de este equipo ha leido.
 *
 * Cada firma de aqui se puede verificar en un minuto con la especificacion del
 * formato delante.
 */

interface Signature {
  mimeType: string;
  /** Bytes esperados y el desplazamiento donde deben aparecer. */
  parts: ReadonlyArray<{ offset: number; bytes: readonly number[] }>;
}

const SIGNATURES: readonly Signature[] = [
  // JPEG: SOI + marcador. El tercer byte varia segun el codificador, pero
  // FF D8 FF es comun a todos.
  { mimeType: 'image/jpeg', parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },

  // PNG: la firma de ocho bytes del estandar. Los dos ultimos (0D 0A y 1A 0A)
  // existen precisamente para detectar transferencias que corrompieron saltos
  // de linea, asi que comprobarlos enteros vale la pena.
  {
    mimeType: 'image/png',
    parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },

  // WEBP: contenedor RIFF con el marcador de formato en el offset 8. Los cuatro
  // bytes intermedios son el tamano del fichero y no se comprueban.
  {
    mimeType: 'image/webp',
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },

  // PDF: "%PDF-". Se incluye el guion para no aceptar un fichero de texto que
  // empiece por la palabra.
  { mimeType: 'application/pdf', parts: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }] },

  // MP4 y derivados ISO-BMFF: la caja `ftyp` en el offset 4. Los cuatro
  // primeros bytes son su longitud y varian.
  { mimeType: 'video/mp4', parts: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },
];

/** El desplazamiento mas lejano que hay que mirar, mas su longitud. */
const REQUIRED_BYTES = Math.max(
  ...SIGNATURES.flatMap((signature) =>
    signature.parts.map((part) => part.offset + part.bytes.length),
  ),
);

export class MagicBytesSniffer implements ContentSniffer {
  readonly requiredBytes = REQUIRED_BYTES;

  /**
   * Devuelve el tipo detectado, o `null` si no reconoce el contenido.
   *
   * "No lo reconozco" y "no lo acepto" son la misma respuesta a proposito: la
   * lista es cerrada, asi que cualquier cosa fuera de ella se rechaza. Es lo
   * contrario de una lista negra, que siempre va por detras de lo que hay que
   * bloquear.
   */
  detect(prefix: Buffer): string | null {
    for (const signature of SIGNATURES) {
      if (this.matches(prefix, signature)) return signature.mimeType;
    }
    return null;
  }

  private matches(prefix: Buffer, signature: Signature): boolean {
    for (const part of signature.parts) {
      if (prefix.length < part.offset + part.bytes.length) return false;

      for (let i = 0; i < part.bytes.length; i += 1) {
        if (prefix[part.offset + i] !== part.bytes[i]) return false;
      }
    }
    return true;
  }
}
