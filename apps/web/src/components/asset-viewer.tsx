import {
  contentTypeLabel,
  durationLabel,
  sizeLabel,
  type OpenedAsset,
} from '../lib/catalog';
import { LessonComplete } from './lesson-complete';

/**
 * Visor de un recurso de la biblioteca.
 *
 * **Todo se renderiza en el servidor y no hay una sola linea de JavaScript
 * propio.** El reproductor es el `<video>` nativo del navegador: trae controles,
 * teclado, subtitulos, velocidad y pantalla completa, y los trae bien. Una
 * libreria de reproduccion cuesta entre 50 y 150 kB en la primera carga, y estas
 * pantallas las abre un aula entera a la vez desde la misma linea del colegio.
 *
 * La URL viene firmada y dura quince minutos. Se pide al renderizar y no se
 * guarda en ningun sitio: ver `openLibraryAsset`.
 */
export function AssetViewer({
  asset,
  backHref,
  portal,
  lessonId,
  lessonCompleted = false,
}: {
  asset: OpenedAsset;
  backHref: string;
  portal: 'discover' | 'academy';
  /** La leccion a la que pertenece el recurso. `null` en material suelto del
   *  kit, que no cuenta para el progreso porque no forma parte de ningun curso. */
  lessonId: string | null;
  lessonCompleted?: boolean;
}) {
  const duration = durationLabel(asset.durationSeconds);
  const size = sizeLabel(asset.sizeBytes);

  return (
    <article data-delivery={asset.delivery} data-asset={asset.assetId}>
      <a href={backHref} className="text-sm font-medium text-brand-600 hover:underline">
        ← Volver a la biblioteca
      </a>

      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-3 font-semibold">
        {asset.title}
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        {[contentTypeLabel(asset.type), duration, size].filter(Boolean).join(' · ')}
      </p>

      {asset.description ? <p className="mt-4 text-ink-700">{asset.description}</p> : null}

      <div className="mt-6">
        <Player asset={asset} />
      </div>

      {/* Marcar la leccion va DESPUES del reproductor y antes de la descarga:
          el orden es el del gesto real -verlo, decir que lo viste, y llevartelo
          si quieres-. */}
      {lessonId ? (
        <div className="mt-6">
          <LessonComplete
            lessonId={lessonId}
            portal={portal}
            alreadyCompleted={lessonCompleted}
          />
        </div>
      ) : null}

      {/* La descarga es una decision del catalogo, no del alumno: hay material
          que se puede llevar -una ficha para imprimir- y material que solo se
          ve. El enlace solo aparece si el recurso lo permite, y el backend lo
          hace valer igual aunque alguien construya la URL a mano. */}
      {asset.downloadable && asset.delivery === 'download' ? (
        <p className="mt-4">
          <a
            href={asset.url}
            download
            data-download="1"
            className="btn btn-primary"
          >
            Descargar
          </a>
        </p>
      ) : null}
    </article>
  );
}

function Player({ asset }: { asset: OpenedAsset }) {
  if (asset.delivery === 'stream') {
    return (
      <video
        controls
        preload="metadata"
        src={asset.url}
        className="w-full rounded-xl bg-ink-900"
        style={{ aspectRatio: '16 / 9' }}
      >
        {/* Texto de reserva para un navegador sin `<video>`, que en un
            laboratorio escolar con equipos viejos no es hipotetico. */}
        Tu navegador no puede reproducir este vídeo.{' '}
        <a href={asset.url}>Ábrelo en una pestaña nueva</a>.
      </video>
    );
  }

  if (asset.delivery === 'embed') {
    return (
      <iframe
        src={asset.url}
        title={asset.title}
        // `allowFullScreen` porque un tutorial de montaje se ve a pantalla
        // completa con el robot delante, no en un recuadro de 400 px.
        allowFullScreen
        // El marco no necesita ningun permiso mas: sin esto hereda los del
        // documento, y un proveedor de video no tiene por que poder pedir la
        // camara ni la ubicacion del alumno.
        sandbox="allow-scripts allow-same-origin allow-presentation"
        className="w-full rounded-xl border-0 bg-ink-900"
        style={{ aspectRatio: '16 / 9' }}
      />
    );
  }

  if (asset.delivery === 'external') {
    return (
      <div className="rounded-xl border border-line-200 bg-white p-5">
        <p className="text-sm text-ink-700">
          Este material está en un servicio de tu colegio y se abre fuera de la plataforma.
        </p>
        <a
          href={asset.url}
          // `noopener` corta el acceso de la pagina destino a esta ventana, que
          // es como funciona el robo de pestana. `noreferrer` evita ademas
          // decirle al proveedor desde que pagina exacta viene el alumno.
          rel="noopener noreferrer"
          target="_blank"
          className="btn btn-primary mt-4"
        >
          Abrir el material
          <span className="sr-only"> (se abre en una pestaña nueva)</span>
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line-200 bg-white p-5">
      <p className="text-sm text-ink-700">
        {asset.downloadable
          ? 'Este material se descarga a tu equipo.'
          : 'Este material se abre en una pestaña nueva.'}
      </p>
      {!asset.downloadable ? (
        <a
          href={asset.url}
          rel="noopener noreferrer"
          target="_blank"
          className="btn btn-primary mt-4"
        >
          Abrir
          <span className="sr-only"> (se abre en una pestaña nueva)</span>
        </a>
      ) : null}
    </div>
  );
}
