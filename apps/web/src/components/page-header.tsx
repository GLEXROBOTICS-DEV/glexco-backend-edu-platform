import { AnnouncementIcon } from '@glexco/icons';
import { fetchAnnouncements } from '../lib/announcements';

/**
 * Cabecera de pantalla: titulo, contexto y acciones.
 *
 * El canvas coloca las acciones ARRIBA A LA DERECHA, a la altura del titulo, y
 * no dentro del contenido. La diferencia importa: lo de la derecha son avisos
 * que llegan solos y hay que poder ignorar, y lo del cuerpo es aquello a lo que
 * el alumno ha venido. Mezclarlos hace que un anuncio de ayer empuje hacia abajo
 * el curso que estaba a medias.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          {title}
        </h1>
        {subtitle ? <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Acceso a los anuncios del salon, con su contador.
 *
 * **Vive en la cabecera y no en el cuerpo de la portada.** Antes la portada
 * terminaba con la lista entera de anuncios, y eso invierte la prioridad de la
 * pantalla: lo que el docente publico -que se lee una vez- ocupaba mas espacio
 * que el curso a medias, que se abre cada dia.
 *
 * Es un ENLACE y no un desplegable: un desplegable exige JavaScript para algo
 * que aqui tiene que funcionar sin el, y ademas obliga a leer los anuncios en
 * una caja de 300 px cuando algunos traen adjuntos.
 *
 * El contador no distingue leidos de no leidos porque todavia no se guarda esa
 * marca. Decir "3 anuncios" es cierto; poner un punto rojo de "no leido" sobre
 * un dato que no existe seria inventarselo, y ademas no se apagaria nunca.
 */
export async function AnnouncementsAction({
  portal,
  onBrand = false,
}: {
  portal: 'discover' | 'academy';
  /** Sobre la banda azul de Discover. El boton blanco sobre #25478A da un
   *  contraste tan alto que se lleva la mirada antes que el saludo. */
  onBrand?: boolean;
}) {
  const items = await fetchAnnouncements();

  return (
    <a
      href={`/${portal}/anuncios`}
      className={`relative grid size-9 place-items-center rounded-[var(--nav-radius)] border transition ${
        onBrand
          ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
          : 'border-line-200 bg-white text-ink-500 hover:border-brand-400 hover:text-brand-700'
      }`}
      data-announcement-count={items.length}
    >
      <AnnouncementIcon size={17} />
      {items.length > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-[var(--portal-accent)] px-1 text-[11px] font-semibold text-brand-700"
          aria-hidden="true"
        >
          {items.length}
        </span>
      ) : null}
      {/* El nombre accesible lleva la cifra: un lector de pantalla no ve la
          pastilla naranja, y "anuncios" a secas no dice si hay algo nuevo. */}
      <span className="sr-only">
        {items.length === 0
          ? 'El muro de tu clase: no hay nada nuevo'
          : `El muro de tu clase: ${items.length} publicaciones`}
      </span>
    </a>
  );
}

/** Hueco del mismo tamano mientras llega el contador, para que no salte. */
export function ActionSkeleton({ onBrand = false }: { onBrand?: boolean }) {
  return (
    <span
      className={`size-9 animate-pulse rounded-[var(--nav-radius)] border ${
        onBrand ? 'border-white/25 bg-white/10' : 'border-line-200 bg-white'
      }`}
      aria-hidden="true"
    />
  );
}
