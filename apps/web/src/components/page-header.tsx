import { AnnouncementIcon, WallIcon } from '@glexco/icons';
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
 * Los dos accesos de la cabecera: anuncios y muro.
 *
 * **Dos botones y no uno.** Son dos cosas que se leen de forma distinta: un
 * aviso del docente hay que verlo hoy, y una conversación se sigue a lo largo de
 * la semana. Con un solo destino, el aviso importante quedaba enterrado entre
 * las preguntas de la clase.
 *
 * Los iconos lo dicen: la bocina anuncia -va en una direccion- y el bocadillo
 * conversa. **Nada de un sobre**, que en cualquier interfaz significa correo
 * privado, y aquí no hay nada privado: lo del muro lo ve la clase entera.
 *
 * Son ENLACES y no desplegables: un desplegable exige JavaScript para algo que
 * aquí tiene que funcionar sin él, y obliga a leer en una caja de 300 px lo que
 * a veces trae adjuntos.
 */
export async function ClassroomActions({
  portal,
  onBrand = false,
}: {
  portal: 'discover' | 'academy';
  /** Sobre la banda azul de Discover. */
  onBrand?: boolean;
}) {
  const items = await fetchAnnouncements();
  const avisos = items.filter((post) => post.kind !== 'question').length;
  const preguntas = items.filter((post) => post.kind === 'question').length;

  return (
    <>
      <HeaderAction
        href={`/${portal}/anuncios`}
        count={avisos}
        onBrand={onBrand}
        label={avisos === 0 ? 'Anuncios: no hay ninguno' : `Anuncios: ${avisos}`}
      >
        <AnnouncementIcon size={17} />
      </HeaderAction>

      <HeaderAction
        href={`/${portal}/muro`}
        count={preguntas}
        onBrand={onBrand}
        label={
          preguntas === 0
            ? 'El muro de tu clase: no hay preguntas'
            : `El muro de tu clase: ${preguntas} preguntas`
        }
      >
        <WallIcon size={17} />
      </HeaderAction>
    </>
  );
}

function HeaderAction({
  href,
  count,
  onBrand,
  label,
  children,
}: {
  href: string;
  count: number;
  onBrand: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`relative grid size-9 place-items-center rounded-[var(--nav-radius)] border transition ${
        onBrand
          ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
          : 'border-line-200 bg-white text-ink-500 hover:border-brand-400 hover:text-brand-700'
      }`}
      data-count={count}
    >
      {children}
      {count > 0 ? (
        <span
          className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-[var(--portal-accent)] px-1 text-[11px] font-semibold text-brand-700"
          aria-hidden="true"
        >
          {count}
        </span>
      ) : null}
      {/* El nombre accesible lleva la cifra: un lector de pantalla no ve la
          pastilla, y "anuncios" a secas no dice si hay algo nuevo. */}
      <span className="sr-only">{label}</span>
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
