import { getTranslations } from 'next-intl/server';
import { KitIcon, LibraryIcon } from '@glexco/icons';
import {
  contentTypeLabel,
  durationLabel,
  fetchLibrary,
  fetchMyKits,
  gradeLabel,
  sizeLabel,
  type LibraryItem,
} from '../lib/catalog';
import { Card, EmptyState, SectionTitle } from './ui';

/**
 * Biblioteca del kit.
 *
 * Compartida por Discover y Academy: es el mismo contenido y la misma regla -el
 * alumno solo ve el material del libro que compro-, y la densidad la fija el
 * layout con `data-portal`. Duplicarla habria significado dos listas que se
 * separan sin que nadie lo decida.
 *
 * **Aqui no se firma ninguna URL.** El listado no trae direcciones: la firma se
 * pide al abrir un recurso concreto, y dura quince minutos. Firmar los treinta
 * recursos de la pagina para que el alumno abra uno seria treinta llamadas al
 * almacen por visita, y ademas dejaria veintinueve enlaces vivos en el HTML de
 * una pagina que se puede guardar o compartir por error.
 */
export async function KitLibrary({
  portal,
  kitId,
}: {
  portal: 'discover' | 'academy';
  /** Kit elegido. Sin el, se muestra el unico del alumno o el selector. */
  kitId?: string;
}) {
  const { kits, failed } = await fetchMyKits();
  const t = await getTranslations('biblioteca');
  // Sin espacio: `gradeLabel` y `contentTypeLabel` traducen vocabulario, que
  // vive en su propia seccion y con la clave que guarda el backend.
  const vocab = await getTranslations();

  if (failed) {
    return <EmptyState title={t('falloTitulo')} description={t('falloDescripcion')} />;
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<LibraryIcon size={32} />}
        title={t('sinMaterialTitulo')}
        description={t('sinMaterialDescripcion')}
        action={{ href: `/${portal}/activar`, label: vocab('sinKit.accion') }}
      />
    );
  }

  // Un kitId que no sea suyo no se corrige en silencio: se ignora y se usa el
  // primero. El backend rechazaria la peticion igualmente -el derecho se
  // comprueba alli-, pero asi la pantalla no pide algo que ya sabe que va a
  // fallar.
  const selected = kits.find((kit) => kit.kitId === kitId) ?? kits[0]!;
  const items = await fetchLibrary(selected.kitId);

  return (
    <>
      {/* El selector solo aparece con mas de un kit. Con uno solo es una lista
          desplegable de un elemento: ruido que hace pensar que falta algo. */}
      {kits.length > 1 ? (
        <nav aria-label={t('eligeKit')} className="flex flex-wrap gap-2" data-kits={kits.length}>
          {kits.map((kit) => {
            const active = kit.kitId === selected.kitId;
            return (
              <a
                key={kit.kitId}
                href={`/${portal}/biblioteca?kit=${kit.kitId}`}
                aria-current={active ? 'true' : undefined}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  active
                    ? 'border-brand-600 bg-brand-600/5 text-brand-700 ring-1 ring-brand-600'
                    : 'border-line-300 bg-white text-ink-700 hover:border-brand-400'
                }`}
              >
                {kit.name}
                {active ? <span className="sr-only"> {t('seleccionado')}</span> : null}
              </a>
            );
          })}
        </nav>
      ) : null}

      <section aria-labelledby="biblioteca" data-library={items.length}>
        <SectionTitle id="biblioteca">
          {kits.length > 1 ? selected.name : t('materialDe', { kit: selected.name })}
        </SectionTitle>
        <p className="-mt-2 mb-4 text-sm text-ink-500">
          {gradeLabel(vocab, selected.grade)}
        </p>

        {items.length === 0 ? (
          <EmptyState
            icon={<KitIcon size={32} />}
            title={t('sinPublicarTitulo')}
            description={t('sinPublicarDescripcion')}
            // Dentro de la seccion "Material de X", que ya es un h2.
            level={3}
          />
        ) : (
          // `items-stretch` mas `h-full` en la tarjeta: las dos columnas de una
          // fila miden lo mismo. Por defecto cada tarjeta mide lo que mide su
          // texto, asi que la de descripcion larga estiraba su celda y la de al
          // lado se quedaba corta.
          <ul className="grid items-stretch gap-[var(--portal-gap)] sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="h-full">
                <LibraryCard portal={portal} item={item} vocab={vocab} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * Una tarjeta de la biblioteca.
 *
 * Recibe el traductor por PROPS y no lo pide dentro. Podria ser `async` -es un
 * componente de servidor-, pero entonces cada una de las treinta tarjetas de la
 * pagina abriria su propio punto de suspension y la lista se pintaria a trozos.
 * El traductor ya lo tiene el padre.
 */
function LibraryCard({
  portal,
  item,
  vocab,
}: {
  portal: 'discover' | 'academy';
  item: LibraryItem;
  vocab: (key: string) => string;
}) {
  const duration = durationLabel(item.durationSeconds);
  const size = sizeLabel(item.sizeBytes);

  return (
    <Card className="flex h-full flex-col">
      <a
        href={`/${portal}/biblioteca/${item.id}`}
        className="group flex h-full flex-col focus:outline-none"
        data-delivery={item.delivery}
      >
        <div className="flex items-start gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600"
            aria-hidden="true"
          >
            <DeliveryIcon delivery={item.delivery} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold group-hover:text-brand-700">
              {item.title}
            </h3>
            {/* El tipo va en texto y no solo en el icono: los iconos de
                documento y de presentacion se distinguen mal a tamano pequeno, y
                un lector de pantalla no lee ninguno de los dos. */}
            <p className="mt-0.5 text-sm text-ink-500">
              {[contentTypeLabel(vocab, item.type), duration, size]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {/* Dos lineas SIEMPRE, tenga descripcion o no. Igualar el alto de la
                tarjeta no basta: sin reservar el hueco, una sin descripcion deja
                el texto de arriba flotando y las dos columnas se ven
                desalineadas por dentro aunque midan lo mismo por fuera. */}
            <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-ink-700">
              {item.description}
            </p>
          </div>
        </div>
      </a>
    </Card>
  );
}

/**
 * Icono segun como se entrega el recurso, no segun su tipo.
 *
 * Es lo que le importa al alumno antes de pulsar: si va a ver algo, a bajarse
 * un archivo, o a salir de la plataforma. El tipo exacto ya va escrito al lado.
 */
function DeliveryIcon({ delivery }: { delivery: LibraryItem['delivery'] }) {
  if (delivery === 'stream' || delivery === 'embed') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 7.5v9l7-4.5-7-4.5Z" fill="currentColor" />
        <rect x="2.5" y="4" width="19" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  if (delivery === 'external') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M14 4h6v6M20 4l-8.5 8.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
