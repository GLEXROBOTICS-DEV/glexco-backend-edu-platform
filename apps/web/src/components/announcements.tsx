import { getTranslations } from 'next-intl/server';
import { fetchAnnouncements, relativeDate, type Announcement } from '../lib/announcements';
import { Card, EmptyState, SectionTitle } from './ui';

/**
 * Anuncios del salon.
 *
 * Compartido por los dos portales de alumno y por el panel del docente: es la
 * misma lista y la misma regla de alcance, que decide el backend a partir del
 * token. La densidad la fija el layout.
 *
 * Los fijados van primero aunque sean mas antiguos, y el backend ya los ordena
 * asi: "traed el kit el viernes" tiene que seguir arriba el jueves, cuando ya
 * hay tres anuncios mas recientes encima.
 */
export async function AnnouncementList({
  classroomId,
  emptyMessage,
  title = 'Anuncios de tu salón',
  hideWhenEmpty = false,
}: {
  classroomId?: string;
  emptyMessage?: string;
  title?: string;
  /**
   * Desaparecer del todo si no hay nada.
   *
   * En la portada del alumno, un bloque que dice "no hay anuncios" ocupa el
   * mismo sitio que uno lleno y no ofrece ninguna accion: es ruido diario en la
   * pantalla que mas se abre. En la pantalla del docente, en cambio, el estado
   * vacio SI dice algo -todavia no has publicado nada- y ahi se muestra.
   */
  hideWhenEmpty?: boolean;
}) {
  const items = await fetchAnnouncements(classroomId);
  const t = await getTranslations('anuncios');

  if (items.length === 0) {
    if (hideWhenEmpty) return null;

    return (
      <EmptyState
        title={t('sinAnunciosTitulo')}
        description={emptyMessage ?? t('sinAnunciosDescripcion')}
      />
    );
  }

  return (
    <section aria-labelledby="anuncios" data-announcements={items.length}>
      <SectionTitle id="anuncios">{title}</SectionTitle>
      <ul className="grid gap-[var(--portal-gap)]">
        {items.map((item) => (
          <li key={item.announcementId}>
            <AnnouncementCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AnnouncementCard({
  item,
  action,
}: {
  item: Announcement;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <article data-pinned={item.pinned ? '1' : undefined}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold">{item.title}</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              {/* El estado "fijado" lleva su palabra y no solo un icono o un
                  color: un lector de pantalla no lee ninguno de los dos. */}
              {item.pinned ? <span className="font-medium text-brand-700">Fijado · </span> : null}
              <time dateTime={item.publishedAt}>{relativeDate(item.publishedAt)}</time>
            </p>
          </div>
          {action}
        </div>

        {/* `whitespace-pre-line` conserva los saltos de linea que escribio el
            docente. Sin esto, una lista de materiales escrita en lineas sueltas
            llega al alumno como un parrafo corrido. */}
        <p className="mt-3 whitespace-pre-line text-sm text-ink-700">{item.body}</p>
      </article>
    </Card>
  );
}
