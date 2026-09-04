/**
 * Cabecera de bienvenida de los portales de alumno.
 *
 * Es la banda azul del canvas. Hace dos cosas que un titular suelto no hacia:
 * da a la pagina un punto de entrada visual -sin ella la portada empezaba en
 * gris y no se sabia donde mirar- y coloca las tres cifras que el alumno viene a
 * consultar en el mismo golpe de vista que su nombre.
 *
 * Las cifras se pasan ya resueltas y NO se piden aqui dentro: si este componente
 * hiciera su propia llamada, la cabecera -que es lo primero que se pinta- se
 * quedaria esperando al servicio de aprendizaje, y el saludo es gratis.
 */
export function PortalHero({
  greeting,
  subtitle,
  figures,
}: {
  greeting: string;
  subtitle: React.ReactNode;
  /** Tres como maximo: mas de tres cifras dejan de leerse de un vistazo. */
  figures: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[var(--portal-radius)] bg-brand-700 px-6 py-6 sm:px-8">
      <Rings />

      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h1
            className="font-display font-semibold text-white"
            style={{ fontSize: 'var(--portal-title-size)' }}
          >
            {greeting}
          </h1>
          <p className="mt-1.5 text-[15px] text-onbrand-100">{subtitle}</p>
        </div>

        <dl className="flex shrink-0 gap-6 sm:gap-7">{figures}</dl>
      </div>
    </section>
  );
}

/**
 * Una cifra de la cabecera.
 *
 * `dd` antes que `dt` a proposito: visualmente manda el numero, y el orden del
 * DOM es el orden de lectura. La lista de definicion permite el par sin inventar
 * una relacion con `aria-*` que despues nadie mantiene.
 */
export function HeroFigure({
  value,
  label,
  accent = false,
}: {
  value: string | number;
  label: string;
  /** Solo una por cabecera: si se acentuan todas, no destaca ninguna. */
  accent?: boolean;
}) {
  return (
    <div className="text-center">
      <dd
        className={`font-display text-[1.75rem] font-semibold leading-none ${
          accent ? 'text-[var(--portal-accent)]' : 'text-white'
        }`}
      >
        {value}
      </dd>
      <dt className="mt-1.5 text-[11px] text-onbrand-300">{label}</dt>
    </div>
  );
}

/** Hueco de la misma altura mientras llegan las cifras, para que no salte. */
export function HeroFigureSkeleton({ label }: { label: string }) {
  return (
    <div className="text-center" aria-hidden="true">
      <dd className="mx-auto h-7 w-9 animate-pulse rounded bg-white/20" />
      <dt className="mt-1.5 text-[11px] text-onbrand-300">{label}</dt>
    </div>
  );
}

/**
 * Circulos concentricos del canvas.
 *
 * Evocan orbitas y sensores sin dibujar un robot: a partir de los diez anos, un
 * robot de dibujos animados se lee como "esto es para pequenos" y es justo el
 * rechazo que hay que evitar en Discover, que llega hasta los doce.
 */
function Rings() {
  return (
    <svg
      className="pointer-events-none absolute -right-8 -top-10 opacity-[0.15]"
      width="300"
      height="300"
      viewBox="0 0 300 300"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="180" cy="120" r="110" stroke="#86C9BD" strokeWidth="2" />
      <circle cx="180" cy="120" r="70" stroke="#F0A93B" strokeWidth="2" />
      <circle cx="180" cy="120" r="30" stroke="#86C9BD" strokeWidth="2" />
    </svg>
  );
}
