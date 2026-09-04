'use client';

import { useId, useState } from 'react';

/**
 * Primitivas de gráfico, en SVG puro.
 *
 * **Sin librería de charts, y no por minimalismo.** Recharts o Chart.js añaden
 * entre 100 y 200 KB de JavaScript a la primera carga, y estas pantallas las
 * abren equipos de laboratorio escolar. Lo que aquí se dibuja son barras,
 * una línea y unos números: el SVG que hace falta cabe en este archivo y pesa
 * cero.
 *
 * Decisiones de color:
 *
 * - **El color SIGNIFICA algo, y solo por eso está.** Una barra al 88 % va en
 *   verde de logro y una al 30 % en rojo, porque el estado del dato es una
 *   pregunta que el lector se hace igualmente y traducirla cuesta un paso. Lo
 *   que no hay es color decorativo: dos barras del mismo valor nunca salen de
 *   colores distintos.
 *
 *   Esto sustituye a la regla anterior de "una sola hue", que dejaba las
 *   pantallas de datos en un azul plano de arriba abajo. La razón de aquella
 *   —evitar una paleta categórica inventada para series que no lo son— sigue en
 *   pie: aquí no hay categorías, hay una escala de resultado.
 *
 * - **La serie sin estado usa el acento del portal**, así que en Discover es
 *   ámbar y en Academy azul. Es la misma señal que la barra lateral: el portal
 *   de primaria no puede verse igual de gris que el panel ejecutivo.
 *
 * - **Los estados llevan SIEMPRE etiqueta de texto**, nunca solo color. El par
 *   verde/ámbar queda en ΔE 6.9 para protanopía: distinguible solo con esa
 *   segunda codificación. Esta regla no se toca por mucho color que se añada.
 *
 * - **El texto va con tokens de texto**, nunca con el color de la serie: un
 *   párrafo en ámbar sobre blanco no llega a 4.5:1.
 */

export type StatusTone = 'neutral' | 'good' | 'warning' | 'critical';

/** Serie sin estado: el acento del portal. Ámbar en Discover, azul en Academy. */
const DATA = 'var(--portal-accent, var(--color-brand-600))';

/** Relleno de cada estado. Va emparejado con `STATUS_INK`, que es su version
 *  legible como TEXTO: el mismo verde no sirve para las dos cosas. */
const STATUS_FILL: Record<StatusTone, string> = {
  neutral: DATA,
  good: '#0A7D57',
  warning: '#F0A93B',
  critical: '#DC2626',
};
const GRID = 'var(--color-line-200)';
const AXIS_INK = 'var(--color-ink-400)';

const STATUS_INK: Record<StatusTone, string> = {
  neutral: 'var(--color-ink-500)',
  good: '#0A7D57',
  warning: '#B26A00',
  critical: '#A61B1B',
};

/**
 * Un número que es la respuesta entera.
 *
 * Cuando el dato es UN número, un gráfico lo empeora: el lector tiene que
 * traducir una longitud a una cifra que ya podíamos haberle dado. La media de
 * un alumno es un número, no una barra de una sola barra.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  toneLabel,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  hint?: string;
  tone?: StatusTone;
  /** Obligatoria si `tone` no es neutro: el estado nunca se comunica solo con
   *  color. */
  toneLabel?: string;
}) {
  const empty = value === null || value === undefined;

  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      {/* Misma etiqueta que el resto de tarjetas de cifra: eran dos
          implementaciones distintas de lo mismo y en el panel de plataforma se
          veian las dos juntas, con tamanos y colores diferentes. */}
      <p className="mb-2 text-xs text-ink-500">{label}</p>

      <p className="flex items-baseline gap-1">
        <span
          className="font-display text-[1.875rem] font-semibold leading-none tabular-nums"
          style={{ color: empty ? 'var(--color-ink-400)' : 'var(--color-ink-900)' }}
        >
          {/* Un guión, no un cero. Cero es un dato; "todavía no hay dato" es
              otra cosa, y confundirlos hace que un alumno sin evaluaciones crea
              que sacó cero. */}
          {empty ? '—' : value}
        </span>
        {!empty && unit ? <span className="text-lg text-ink-500">{unit}</span> : null}
      </p>

      {tone !== 'neutral' && toneLabel ? (
        <p className="mt-2 text-sm font-medium" style={{ color: STATUS_INK[tone] }}>
          {/* El punto es decorativo; la palabra es la que informa. */}
          <span aria-hidden="true">● </span>
          {toneLabel}
        </p>
      ) : null}

      {hint ? <p className="mt-2 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface TimelinePoint {
  label: string;
  value: number;
  passed: boolean;
}

/**
 * Evolución en el tiempo, una sola serie.
 *
 * Sin leyenda: el título ya nombra la serie, y una caja de leyenda para una
 * línea es ruido. La línea de aprobación es una REGLA de referencia dibujada en
 * tinta apagada, no una segunda serie: no representa datos, marca un umbral.
 *
 * El eje Y va de 0 a 100 fijo y no al rango de los datos. Una escala que empieza
 * en el mínimo exagera cualquier variación: subir de 88 a 91 parece un salto
 * enorme. Aquí la unidad es un porcentaje y su escala natural es la completa.
 */
export function TimelineChart({
  points,
  passingScore,
  title,
}: {
  points: TimelinePoint[];
  passingScore: number;
  title: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  if (points.length === 0) {
    return <ChartEmpty title={title} message="Todavía no hay evaluaciones corregidas." />;
  }

  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 32, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  // Con un solo punto no hay línea que trazar: se centra el marcador en vez de
  // dividir por cero.
  const x = (index: number) =>
    points.length === 1 ? pad.left + plotW / 2 : pad.left + (index / (points.length - 1)) * plotW;
  const y = (value: number) => pad.top + plotH - (Math.max(0, Math.min(100, value)) / 100) * plotH;

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ');
  const active = hovered === null ? null : points[hovered];

  return (
    <figure
      // Anclaje estable para las comprobaciones automaticas. El texto de dentro
      // no sirve: React lo parte con separadores al renderizar en servidor
      // ("aprobado <!-- -->60<!-- -->%") y cualquier asercion sobre la cadena
      // falla aunque el grafico este perfecto.
      data-chart="timeline"
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <span className="flex items-center gap-1">
          <TableToggle
            expanded={showTable}
            onToggle={() => setShowTable((v) => !v)}
            controls={tableId}
          />
          <ExportButtons
            title={title}
            headers={['Evaluación', 'Resultado', 'Estado']}
            rows={points.map((point) => [
              point.label,
              `${point.value}%`,
              point.passed ? 'Aprobado' : 'No aprobado',
            ])}
          />
        </span>
      </figcaption>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          style={{ minWidth: 420 }}
          role="img"
          aria-label={`${title}. ${points.length} evaluaciones, de ${points[0]!.value}% a ${
            points[points.length - 1]!.value
          }%.`}
        >
          {/* Rejilla recesiva: orienta sin competir con los datos. */}
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
              <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill={AXIS_INK}>
                {tick}
              </text>
            </g>
          ))}

          {/* Umbral de aprobación: regla, no serie. Discontinua y en tinta
              apagada para que no se lea como un dato más. */}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(passingScore)}
            y2={y(passingScore)}
            stroke={AXIS_INK}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
          <text x={width - pad.right} y={y(passingScore) - 6} textAnchor="end" fontSize={11} fill={AXIS_INK}>
            aprobado {passingScore}%
          </text>

          {points.length > 1 ? (
            <path d={path} fill="none" stroke={DATA} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}

          {points.map((point, index) => (
            <g key={index}>
              {/* El anillo del color de la superficie separa marcadores que se
                  solapan cuando dos evaluaciones caen casi en el mismo valor. */}
              <circle cx={x(index)} cy={y(point.value)} r={5.5} fill={DATA} stroke="var(--color-raised)" strokeWidth={2} />
              {/* Zona de contacto mucho mayor que el marcador: 5px de radio es
                  imposible de acertar con el dedo en una tableta. */}
              <circle
                cx={x(index)}
                cy={y(point.value)}
                r={16}
                fill="transparent"
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                role="button"
                aria-label={`${point.label}: ${point.value}%`}
                style={{ cursor: 'pointer' }}
              />
            </g>
          ))}

          {active ? (
            <line
              x1={x(hovered!)}
              x2={x(hovered!)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke={AXIS_INK}
              strokeWidth={1}
            />
          ) : null}
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute top-2 rounded-lg border border-line-200 bg-white px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(x(hovered!) / width) * 100}%`, transform: 'translateX(-50%)' }}
            role="status"
          >
            <p className="font-medium text-ink-900">{active.label}</p>
            <p className="tabular-nums text-ink-700">{active.value}%</p>
            <p className="font-medium" style={{ color: STATUS_INK[active.passed ? 'good' : 'critical'] }}>
              {active.passed ? 'Aprobado' : 'No aprobado'}
            </p>
          </div>
        ) : null}
      </div>

      {/* Se renderiza SIEMPRE y se oculta con CSS cuando esta plegada.
          Renderizarla solo al desplegar la deja fuera del DOM, y entonces la
          hoja de impresion no puede ensenarla: el PDF saldria con los graficos y
          sin las cifras, que es justo lo que alguien quiere de un PDF. */}
      <DataTable
        id={tableId}
        hidden={!showTable}
        headers={['Evaluación', 'Resultado', 'Estado']}
        rows={points.map((point) => [point.label, `${point.value}%`, point.passed ? 'Aprobado' : 'No aprobado'])}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  /** Texto que acompaña al valor: tamaño de muestra, recuento, lo que aplique. */
  meta?: string;
  tone?: StatusTone;
  toneLabel?: string;
}

/**
 * Magnitud comparada, barras horizontales.
 *
 * Horizontales y no verticales porque las etiquetas son frases -"¿cuál de estas
 * piezas es un servomotor?"- y en vertical habría que girarlas, que es la forma
 * más rápida de hacer un gráfico ilegible.
 *
 * Cada barra lleva su valor escrito al lado. No es redundante con la longitud:
 * la longitud sirve para comparar de un vistazo y el número para citarlo.
 */
export function BarList({
  data,
  title,
  unit = '%',
  max = 100,
  emptyMessage = 'Todavía no hay datos.',
}: {
  data: BarDatum[];
  title: string;
  unit?: string;
  max?: number;
  emptyMessage?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  if (data.length === 0) {
    return <ChartEmpty title={title} message={emptyMessage} />;
  }

  const scale = Math.max(max, ...data.map((d) => d.value)) || 1;

  return (
    <figure
      data-chart="bars"
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        <span className="flex items-center gap-1">
          <TableToggle
            expanded={showTable}
            onToggle={() => setShowTable((v) => !v)}
            controls={tableId}
          />
          <ExportButtons
            title={title}
            headers={['Concepto', `Valor (${unit})`, 'Detalle']}
            rows={data.map((datum) => [datum.label, String(datum.value), datum.meta ?? '—'])}
          />
        </span>
      </figcaption>

      <ul className="space-y-3">
        {data.map((datum, index) => (
          <li key={`${datum.label}-${index}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-700" title={datum.label}>
                {datum.label}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">
                {datum.value}
                {unit}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-3">
              {/* Carril de fondo del color de la superficie: da la referencia
                  del 100 % sin dibujar un eje. */}
              <div className="h-2.5 flex-1 rounded-full bg-surface-200">
                <div
                  className="h-2.5 rounded-full"
                  style={{
                    width: `${Math.max((datum.value / scale) * 100, 1.5)}%`,
                    // El color dice EN QUE estado esta el dato. La cifra de al
                    // lado sigue siendo la fuente de verdad; el color solo
                    // ahorra el paso de interpretarla.
                    background: STATUS_FILL[datum.tone ?? 'neutral'],
                  }}
                />
              </div>

              {datum.meta ? (
                <span className="shrink-0 text-xs tabular-nums text-ink-400">{datum.meta}</span>
              ) : null}
            </div>

            {datum.tone && datum.tone !== 'neutral' && datum.toneLabel ? (
              <p className="mt-1 text-xs font-medium" style={{ color: STATUS_INK[datum.tone] }}>
                <span aria-hidden="true">● </span>
                {datum.toneLabel}
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      <DataTable
        id={tableId}
        hidden={!showTable}
        headers={['Concepto', `Valor (${unit})`, 'Detalle']}
        rows={data.map((datum) => [datum.label, String(datum.value), datum.meta ?? '—'])}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------

function ChartEmpty({ title, message }: { title: string; message: string }) {
  return (
    <figure
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <figcaption className="font-display text-base font-semibold">{title}</figcaption>
      <p className="mt-3 text-sm text-ink-500">{message}</p>
    </figure>
  );
}

/**
 * Alterna la tabla de datos.
 *
 * No es un extra de accesibilidad: es la vía por la que un lector de pantalla
 * accede a las cifras, y también la que permite copiarlas. Un gráfico sin tabla
 * es un gráfico que solo existe para quien puede verlo.
 */
function TableToggle({
  expanded,
  onToggle,
  controls,
}: {
  expanded: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls}
      className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-surface-100"
    >
      {expanded ? 'Ocultar datos' : 'Ver datos'}
    </button>
  );
}

/**
 * Descargar los datos de un gráfico.
 *
 * **CSV y "imprimir o guardar en PDF", y NO un .xlsx ni un PDF generado.** Es
 * una decisión, no una simplificación:
 *
 * - Un CSV con BOM lo abre Excel directamente, con los acentos bien y en la
 *   columna correcta. Generar un `.xlsx` de verdad exige una librería de un
 *   megabyte en el servidor para producir algo que el usuario abre igual.
 * - El PDF lo hace el navegador con la hoja de estilos de impresión, y sale
 *   MEJOR que uno generado: conserva los gráficos —son SVG— y la maquetación de
 *   la pantalla. Un PDF hecho a mano en el servidor pediría un motor de
 *   renderizado headless de decenas de megabytes en la imagen y produciría una
 *   versión más pobre de lo que ya se ve.
 *
 * Se arma en el NAVEGADOR con lo que ya está en la página: no hay petición, no
 * hay endpoint nuevo y no hay una segunda ocasión de que estos datos salgan del
 * servidor —que en un dashboard de salón son notas de menores—.
 *
 * Sin JavaScript no aparece el botón, y la tabla de datos sigue ahí para
 * copiarla. Se pierde la comodidad, no el acceso al dato.
 */
function ExportButtons({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  function descargarCsv(): void {
    const escapar = (celda: string): string =>
      // Comillas dobles y separador dentro de una celda: sin escaparlos, un
      // nombre como `Perez, Ana` parte la fila en dos columnas.
      /[",\n;]/.test(celda) ? `"${celda.replace(/"/g, '""')}"` : celda;

    // `;` como separador y no `,`: es lo que espera Excel en la configuración
    // regional de España y de Latinoamérica, y con coma abre todo en una sola
    // columna. El BOM va delante para que los acentos no salgan roto.
    const cuerpo = [headers, ...rows]
      .map((fila) => fila.map(escapar).join(';'))
      .join('\r\n');

    const url = URL.createObjectURL(
      new Blob([`\ufeff${cuerpo}\r\n`], { type: 'text/csv;charset=utf-8' }),
    );

    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `${nombreDeArchivo(title)}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  return (
    <span className="flex gap-1" data-export="1">
      <button
        type="button"
        onClick={descargarCsv}
        className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-surface-100"
      >
        CSV
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded px-2 py-1 text-xs font-medium text-brand-600 hover:bg-surface-100"
      >
        PDF
      </button>
    </span>
  );
}

/** Un nombre de archivo que sobreviva a Windows, a macOS y a un correo. */
function nombreDeArchivo(title: string): string {
  const limpio = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return `glexco-${limpio || 'datos'}-${new Date().toISOString().slice(0, 10)}`;
}

function DataTable({
  id,
  headers,
  rows,
  hidden = false,
}: {
  id: string;
  headers: string[];
  rows: string[][];
  /**
   * Plegada.
   *
   * `display: none` y no `visibility`: un lector de pantalla no debe anunciar
   * una tabla que el usuario tiene cerrada, y eso es lo que `aria-expanded` del
   * boton esta diciendo. En impresion la hoja de estilos lo revierte.
   */
  hidden?: boolean;
}) {
  return (
    <div
      id={id}
      className={`mt-4 overflow-x-auto ${hidden ? 'hidden print:block' : ''}`}
      data-datos="1"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-200 text-left">
            {headers.map((header) => (
              <th key={header} scope="col" className="py-2 pr-4 font-medium text-ink-500">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-line-200 last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-4 tabular-nums text-ink-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Anillo de porcentaje.
 *
 * Para UNA proporcion sobre cien: la nota media, el porcentaje de aprobadas, la
 * activacion de un colegio. El arco se lee de un vistazo -medio anillo es medio
 * dato- y la cifra grande del centro es la que se cita.
 *
 * **No es un grafico de tarta.** Una tarta reparte un total entre categorias y
 * exige comparar angulos, que es justo lo que la gente hace mal. Aqui hay un
 * solo valor contra su maximo, y el hueco del centro es lo que permite poner la
 * cifra dentro en vez de en una leyenda aparte.
 *
 * El color viene del estado y NUNCA va solo: debajo del anillo va siempre la
 * etiqueta en texto.
 */
export function DonutChart({
  value,
  label,
  caption,
  tone = 'neutral',
  toneLabel,
  unit = '%',
  size = 128,
}: {
  /** 0-100. `null` cuando todavia no hay dato: se dibuja el carril vacio. */
  value: number | null;
  label: string;
  caption?: string;
  tone?: StatusTone;
  /** Obligatoria si `tone` no es neutro: el estado nunca se comunica solo con color. */
  toneLabel?: string;
  unit?: string;
  size?: number;
}) {
  const empty = value === null || value === undefined;
  const pct = empty ? 0 : Math.min(Math.max(value, 0), 100);

  // El radio se deriva del tamano para que cambiarlo no descuadre el trazo.
  const stroke = Math.round(size * 0.1);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <figure
      data-chart="donut"
      data-value={empty ? '' : pct}
      className="flex flex-col items-center border border-line-200 bg-white text-center"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-surface-200)"
            strokeWidth={stroke}
          />
          {!empty ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={STATUS_FILL[tone]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
              // Empieza arriba y no a la derecha, que es donde el ojo espera el
              // origen de un medidor.
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null}
        </svg>

        <div className="absolute inset-0 grid place-content-center">
          <span className="font-display text-2xl font-semibold tabular-nums text-ink-900">
            {empty ? '—' : Math.round(pct)}
            {empty ? '' : <span className="text-base font-medium text-ink-500">{unit}</span>}
          </span>
        </div>
      </div>

      <figcaption className="mt-3">
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {caption ? <span className="mt-0.5 block text-xs text-ink-500">{caption}</span> : null}
        {tone !== 'neutral' && toneLabel ? (
          <span
            className="mt-1.5 block text-xs font-semibold"
            style={{ color: STATUS_INK[tone] }}
          >
            {toneLabel}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
