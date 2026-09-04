/**
 * Panel de marca de las pantallas de acceso.
 *
 * Es la mitad izquierda del canvas de ingreso. La reticula de circuito evoca
 * robotica sin caer en el cliche del robot dibujado, que es justo lo que un
 * alumno de secundaria lee como infantil.
 *
 * Antes habia aqui un degradado de tres paradas. Se cambia por el azul plano
 * de marca porque el degradado no sale del logo: el logo tiene DOS paradas
 * (#2C53A0 y #86C9BD) y solo en el propio logotipo. Extenderlo al fondo de la
 * pagina competia con la marca en vez de sostenerla.
 *
 * Se oculta en movil: en una pantalla pequena, media altura de decoracion
 * empuja el formulario fuera de la vista.
 */
export function BrandPanel({
  headline,
  description,
}: {
  headline: string;
  description: string;
}) {
  return (
    <section
      className="relative hidden overflow-hidden bg-brand-700 p-12 lg:flex lg:w-[41%] lg:shrink-0 lg:flex-col lg:justify-between lg:p-14"
      // Decorativo entero: el titular es marketing, no informacion que quien usa
      // un lector de pantalla necesite antes de llegar al formulario.
      aria-hidden="true"
    >
      <CircuitGrid />

      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estatico del
            propio origen; `next/image` no optimiza SVG. */}
        <img
          src="/glexco-marca-blanco.svg"
          alt=""
          width={240}
          height={48}
          className="block w-[15rem]"
        />
        <p className="mt-3 text-xs uppercase tracking-[0.25em] text-brand-200">
          Robotics &amp; Automation
        </p>
      </div>

      <div className="relative max-w-[27rem]">
        <p className="text-balance font-display text-[2.875rem] font-semibold leading-[1.12] text-white">
          {headline}
        </p>
        <p className="mt-5 text-[17px] leading-relaxed text-onbrand-100">{description}</p>
      </div>

      <dl className="relative flex gap-10">
        <Figure value="12" label="plataformas robóticas" />
        <Figure value="4" label="niveles formativos" />
        <Figure value="2" label="idiomas" />
      </dl>
    </section>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd className="font-display text-[26px] font-semibold text-white">{value}</dd>
      <dt className="mt-0.5 text-xs text-onbrand-300">{label}</dt>
    </div>
  );
}

/**
 * Reticula de circuito.
 *
 * Va en linea y no como archivo: son ocho trazos y un pu&ntilde;ado de nodos, menos
 * bytes que la peticion que haria falta para pedirlo, y en la pantalla de
 * ingreso -la primera que carga cualquiera- una peticion menos se nota.
 */
function CircuitGrid() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]"
      viewBox="0 0 592 900"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="#86C9BD" strokeWidth="1.25">
        <path d="M-20 190 H150 V90 H330" />
        <path d="M-20 300 H90 V420 H260 V330 H430" />
        <path d="M592 250 H470 V150 H360" />
        <path d="M592 560 H500 V660 H340 V600 H190" />
        <path d="M60 900 V760 H240 V820 H420 V700 H560" />
        <path d="M170 -20 V80" />
        <path d="M470 900 V820" />
      </g>
      <g fill="#86C9BD">
        <circle cx="150" cy="90" r="5" />
        <circle cx="330" cy="90" r="5" />
        <circle cx="90" cy="420" r="5" />
        <circle cx="430" cy="330" r="5" />
        <circle cx="470" cy="150" r="5" />
        <circle cx="500" cy="660" r="5" />
        <circle cx="240" cy="820" r="5" />
        <circle cx="560" cy="700" r="5" />
      </g>
    </svg>
  );
}
