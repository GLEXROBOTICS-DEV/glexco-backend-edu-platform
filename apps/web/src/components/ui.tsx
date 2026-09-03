/**
 * Piezas compartidas por los dos portales.
 *
 * Ninguna tiene variante "grande" o "pequena": la densidad la fija el layout con
 * `data-portal` y estas la heredan por variable CSS. Si cada componente llevara
 * su propia variante, la coherencia entre Discover y Academy dependeria de que
 * nadie se olvidara de pasarla, y alguien se olvida siempre.
 */

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border border-line-200 bg-white shadow-[0_1px_2px_rgba(27,42,56,0.04)]"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      {children}
    </div>
  );
}

/**
 * Esqueleto con la forma del contenido real.
 *
 * No es un spinner: un spinner no dice nada y hace que la pagina salte cuando
 * llega el contenido. Un esqueleto con la misma altura reserva el hueco, asi que
 * no hay desplazamiento de maquetacion, y en una conexion lenta -que es la de
 * muchos colegios- se nota la diferencia.
 */
export function CardSkeleton() {
  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
      // El esqueleto no se anuncia: lo unico que diria el lector de pantalla es
      // "cargando" repetido por cada bloque. `aria-busy` en la region ya lo
      // comunica una sola vez.
      aria-hidden="true"
    >
      <div className="flex items-start gap-4">
        <div className="size-12 shrink-0 animate-pulse rounded-xl bg-surface-200" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-2/3 animate-pulse rounded bg-surface-200" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-surface-200" />
        </div>
      </div>
      <div className="mt-5 h-10 w-44 animate-pulse rounded-lg bg-surface-200" />
    </div>
  );
}

export function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-4 font-display text-lg font-semibold">
      {children}
    </h2>
  );
}

/**
 * Estado vacio.
 *
 * Siempre dice QUE hacer, no solo que no hay nada. "No tienes kits" deja al
 * alumno parado; "activa el codigo de tu libro" le da el siguiente paso, que en
 * esta plataforma es literalmente el que desbloquea todo lo demas.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div
      className="border border-dashed border-line-300 bg-white text-center"
      style={{ borderRadius: 'var(--portal-radius)', padding: '2.5rem 1.5rem' }}
    >
      {icon ? (
        <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-surface-200 text-ink-400">
          {icon}
        </span>
      ) : null}
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-500">{description}</p>
      {action ? (
        <a
          href={action.href}
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {action.label}
        </a>
      ) : null}
    </div>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <p className="font-display text-2xl font-semibold text-brand-700">{value}</p>
      <p className="mt-1 text-sm text-ink-500">{label}</p>
    </div>
  );
}
