/**
 * Piezas compartidas por los dos portales.
 *
 * Ninguna tiene variante "grande" o "pequena": la densidad la fija el layout con
 * `data-portal` y estas la heredan por variable CSS. Si cada componente llevara
 * su propia variante, la coherencia entre Discover y Academy dependeria de que
 * nadie se olvidara de pasarla, y alguien se olvida siempre.
 */

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  /**
   * Para que la tarjeta ocupe todo el alto de su celda (`h-full`).
   *
   * Sin esto, en una rejilla cada tarjeta mide lo que mide su texto y dos
   * columnas contiguas salen de alturas distintas: la de la izquierda con
   * descripcion larga se estira y la de la derecha se queda corta, y la rejilla
   * parece descuadrada aunque este bien alineada.
   */
  className?: string;
}) {
  return (
    <div
      className={`border border-line-200 bg-white shadow-[0_1px_2px_rgba(27,42,56,0.04)] ${className}`}
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
          className="btn btn-primary mt-6"
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
      {/* La etiqueta va ENCIMA de la cifra, como en el canvas. Debajo hay que
          leer el numero antes de saber de que es, y en una fila de cuatro
          tarjetas eso obliga a recorrerla dos veces.

          En minusculas de 12 px y NO en versalitas: las versalitas del canvas
          son para las etiquetas de SECCION ("continuar aprendiendo"), y usarlas
          tambien aqui hace que una fila de cifras pese lo mismo que los titulos
          de bloque y compita con ellos. */}
      <p className="mb-2 text-xs text-ink-500">{label}</p>
      <p className="font-display text-[1.875rem] font-semibold leading-none text-ink-900">
        {value}
      </p>
    </div>
  );
}

/**
 * Etiqueta de estado.
 *
 * Los cinco pares fondo/texto salen del canvas y van emparejados: cada texto
 * esta comprobado sobre SU fondo, y cruzarlos rompe el contraste.
 *
 * Nunca comunica solo con color. El par verde/ambar queda en 6,9 de diferencia
 * para protanopia -indistinguibles-, asi que el texto de dentro es la parte que
 * de verdad informa; el color solo acelera la lectura de quien lo distingue.
 */
export function StatePill({
  state,
  children,
}: {
  state: 'done' | 'doing' | 'warn' | 'idle' | 'late';
  children: React.ReactNode;
}) {
  const tone = {
    done: 'bg-state-done-bg text-state-done-fg',
    doing: 'bg-state-doing-bg text-state-doing-fg',
    warn: 'bg-state-warn-bg text-state-warn-fg',
    idle: 'bg-state-idle-bg text-state-idle-fg',
    late: 'bg-state-late-bg text-state-late-fg',
  }[state];

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[12.5px] font-medium ${tone}`}
    >
      {children}
    </span>
  );
}
