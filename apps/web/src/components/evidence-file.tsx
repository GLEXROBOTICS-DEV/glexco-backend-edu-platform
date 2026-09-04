'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EVIDENCE_UPLOAD_TYPES } from '@glexco/contracts';

/**
 * El campo de archivo de una evidencia, con compresión EN EL NAVEGADOR.
 *
 * **La foto se reduce antes de salir del dispositivo, y es una decisión de
 * coste además de una comodidad.** Un móvil actual produce fotos de 8 a 15 MB;
 * lo que hace falta para comprobar que un robot está montado cabe en 300 KB. Con
 * treinta alumnos por salón, la diferencia entre subir el original y subir el
 * reducido es de 300 MB por actividad — en almacenamiento, en la factura de
 * salida y en el tiempo que el alumno pasa mirando una barra de progreso desde
 * la conexión de su colegio.
 *
 * Y arregla un rechazo real: el límite del servicio son 12 MB por imagen, así
 * que hoy una foto de móvil moderno **se rechaza**. Comprimir convierte ese
 * rechazo en una entrega.
 *
 * **Sin JavaScript sigue funcionando.** Es un `<input type="file">` normal: si
 * el bundle no llega, el navegador envía el original y el servidor aplica su
 * límite con un mensaje que dice qué hacer. Se pierde la compresión, no la
 * capacidad de entregar — que es la regla de todos los formularios de este
 * portal.
 *
 * Lo que NO se toca:
 *
 * - Los PDF. Recomprimir un documento exige un parser de PDF en el navegador y
 *   lo que se gana es poco: una ficha escaneada ya viene comprimida.
 * - Nada, si el resultado saliera más grande. Pasa con capturas de pantalla y
 *   con imágenes ya optimizadas, y subir una versión peor y más pesada sería lo
 *   contrario de lo que esto hace.
 */

/** Ancho o alto máximo tras reducir. */
const MAX_SIDE = 1600;

/**
 * Desde cuándo merece la pena.
 *
 * Por debajo de esto el archivo ya es pequeño y recomprimir solo le quita
 * calidad sin ahorrar nada que se note.
 */
const COMPRESS_OVER_BYTES = 1_200_000;

/** Calidad del JPEG. 0.82 es donde deja de verse la diferencia en una foto. */
const QUALITY = 0.82;

export function EvidenceFileInput({ name, label, hint }: { name: string; label: string; hint: string }) {
  const t = useTranslations('evaluacion');
  const inputRef = useRef<HTMLInputElement>(null);
  const [resumen, setResumen] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function onChange(): Promise<void> {
    const input = inputRef.current;
    const file = input?.files?.[0];
    if (!input || !file) {
      setResumen(null);
      return;
    }

    if (!file.type.startsWith('image/') || file.size <= COMPRESS_OVER_BYTES) {
      setResumen(null);
      return;
    }

    setTrabajando(true);
    try {
      const reducida = await comprimir(file);

      // Solo se sustituye si de verdad pesa menos. Y con `DataTransfer`, que es
      // la única forma de cambiar los archivos de un input: asignar a
      // `input.files` directamente no está permitido.
      if (reducida && reducida.size < file.size) {
        const transfer = new DataTransfer();
        transfer.items.add(reducida);
        input.files = transfer.files;

        setResumen(
          t('fotoReducida', { antes: enMegas(file.size), despues: enMegas(reducida.size) }),
        );
      } else {
        setResumen(null);
      }
    } catch {
      // Cualquier fallo deja el original. Un navegador sin `createImageBitmap`,
      // una imagen corrupta o una foto enorme que no cabe en memoria no pueden
      // impedir la entrega: como mucho, el servidor dirá que pesa demasiado.
      setResumen(null);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink-700">{label}</span>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={EVIDENCE_UPLOAD_TYPES.join(',')}
        onChange={() => void onChange()}
        className="field file:mr-3 file:rounded-md file:border-0 file:bg-brand-600/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
      />
      <span className="text-xs text-ink-400">{hint}</span>

      {/* `role="status"`: el cambio se anuncia sin robar el foco, que es lo que
          hace falta cuando ocurre mientras el alumno sigue rellenando. */}
      <span role="status" className="text-xs text-state-done-fg">
        {trabajando ? t('reduciendoFoto') : (resumen ?? '')}
      </span>
    </label>
  );
}

/**
 * Reduce una imagen con lo que trae el navegador.
 *
 * `createImageBitmap` con `imageOrientation: 'from-image'` y no una `<img>`
 * suelta: sin eso se pierde la orientación EXIF y **una foto vertical de móvil
 * se sube girada**. Es el fallo clásico de cualquier recorte en canvas, y quien
 * lo sufre es el docente, que corrige un montaje tumbado de lado.
 *
 * Se reencoda a JPEG aunque la entrada sea PNG: una foto en PNG pesa varias
 * veces más y nadie necesita canal alfa en la foto de un robot.
 */
async function comprimir(file: File): Promise<File | null> {
  if (typeof createImageBitmap !== 'function') return null;

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  try {
    const escala = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;

    const context = canvas.getContext('2d');
    if (!context) return null;

    // Fondo blanco antes de dibujar: un PNG con transparencia sobre JPEG -que no
    // tiene alfa- sale con el fondo NEGRO, y una foto recortada se vuelve
    // ilegible.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, ancho, alto);
    context.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY);
    });

    if (!blob) return null;

    return new File([blob], renombrar(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    // Libera la memoria del bitmap, que en una foto de 12 MP son unos 48 MB. Sin
    // esto, elegir tres fotos seguidas en una tableta escolar la deja sin aire.
    bitmap.close?.();
  }
}

/** La extensión tiene que decir la verdad: ya no es un PNG. */
function renombrar(nombre: string): string {
  const base = nombre.replace(/\.[^.]+$/, '') || 'evidencia';
  return `${base}.jpg`;
}

function enMegas(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
