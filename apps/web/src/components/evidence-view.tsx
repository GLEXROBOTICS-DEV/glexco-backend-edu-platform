import { openEvidence } from '../lib/evidence';

/**
 * La evidencia que entregó el alumno, abierta.
 *
 * **Se muestra, no se anuncia.** Antes esta pantalla decía «Entregó un archivo o
 * un enlace» y ahí acababa: el docente tenía que puntuar un montaje sin haberlo
 * visto. Una foto se pinta; un vídeo se reproduce con el reproductor nativo; un
 * PDF y un enlace externo se abren fuera, avisando de que salen del sitio.
 *
 * Es un componente de servidor a propósito: la URL viene firmada y dura minutos,
 * así que se pide al renderizar. Pasarla al cliente para que él la pidiera la
 * dejaría escrita en el HTML de una página que se puede guardar o compartir por
 * error, y lo que hay al otro lado es la foto de un menor.
 */
export async function EvidenceView({ mediaAssetId }: { mediaAssetId: string }) {
  const evidence = await openEvidence(mediaAssetId);

  if (!evidence) {
    return (
      <p className="text-sm text-ink-500">
        Entregó un archivo, pero no pudimos abrirlo ahora mismo. Vuelve a cargar la página en un
        momento.
      </p>
    );
  }

  if (evidence.kind === 'image') {
    return (
      <figure className="grid gap-2" data-evidence="image">
        {/* `img` y no `next/image`: la URL está firmada y caduca, así que el
            optimizador la cachearía y devolvería un enlace roto minutos después.
            Y el alto máximo evita que una foto de móvil en vertical ocupe tres
            pantallas y esconda el campo de puntuación. */}
        <img
          src={evidence.url}
          alt={`Entrega del alumno: ${evidence.title}`}
          className="max-h-96 w-auto rounded-lg border border-line-200 object-contain"
        />
        <figcaption>
          <a
            href={evidence.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Ver a tamaño completo
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </figcaption>
      </figure>
    );
  }

  if (evidence.kind === 'video') {
    return (
      <video
        src={evidence.url}
        controls
        preload="metadata"
        data-evidence="video"
        className="max-h-96 w-full rounded-lg border border-line-200 bg-ink-900"
      >
        {/* Sin soporte de vídeo queda el enlace, que es lo único que se puede
            ofrecer y es mejor que un hueco negro. */}
        <a href={evidence.url}>Descargar el vídeo que entregó</a>
      </video>
    );
  }

  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noreferrer noopener"
      data-evidence={evidence.kind}
      className="btn btn-secondary"
    >
      {evidence.kind === 'link' ? 'Abrir el enlace que entregó' : 'Abrir el archivo que entregó'}
      <span className="sr-only"> (se abre en otra pestaña)</span>
      <span aria-hidden="true">&#8599;</span>
    </a>
  );
}
