'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface TourStep {
  /** Selector del elemento que se resalta. Si no aparece, el paso se salta. */
  target: string;
  title: string;
  body: string;
}

/**
 * Visita guiada de la plataforma.
 *
 * **No arranca sola.** Un tutorial que salta al entrar interrumpe a quien venia
 * a hacer algo, y en la segunda visita ya es una molestia; el patron de
 * "descartar para siempre" acaba siendo la unica interaccion que tiene. Aqui se
 * abre desde un boton y se puede volver a abrir cuantas veces haga falta, que es
 * lo que de verdad se necesita: nadie recuerda el tutorial que vio una vez el
 * primer dia.
 *
 * Los pasos apuntan a elementos REALES por selector, y un paso cuyo elemento no
 * esta en la pantalla se salta en vez de senalar al vacio: la barra de un
 * docente no tiene lo mismo que la de un alumno, y mantener una lista por rol
 * garantizaria que una de ellas se quedara desincronizada.
 */
export function Tour({ steps, label = 'Cómo funciona' }: { steps: TourStep[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [visible, setVisible] = useState<TourStep[]>([]);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setVisible(steps.filter((step) => document.querySelector(step.target)));
    setIndex(0);
  }, [open, steps]);

  const step = visible[index];

  const measure = useCallback(() => {
    if (!step) return;
    const element = document.querySelector(step.target);
    setBox(element ? element.getBoundingClientRect() : null);
  }, [step]);

  useEffect(() => {
    if (!open || !step) return;

    const element = document.querySelector(step.target);
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Se remide al desplazar y al cambiar de tamano: el recuadro va en
    // coordenadas de pantalla y sin esto se queda clavado donde estaba.
    measure();
    const id = window.setTimeout(measure, 350); // tras el desplazamiento suave
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, visible.length - 1));
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, visible.length]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--nav-radius)] px-3 py-2 text-left text-[13px] font-medium text-onbrand-300 transition hover:bg-white/10 hover:text-white"
      >
        {label}
      </button>
    );
  }

  const last = index >= visible.length - 1;
  const place = placement(box);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="Visita guiada">
      {/* Un SOLO velo, con el hueco recortado por el `box-shadow` del recuadro.
          Antes habia tambien un `<div>` oscuro a pantalla completa debajo, asi
          que todo salia al doble de oscuro y el elemento resaltado tampoco se
          libraba: se veia tan apagado como el resto. */}
      <button
        type="button"
        aria-label="Cerrar la visita guiada"
        onClick={() => setOpen(false)}
        className={`absolute inset-0 h-full w-full cursor-default ${box ? '' : 'bg-ink-900/70'}`}
      />

      {box ? (
        <div
          className="pointer-events-none absolute rounded-xl"
          style={{
            top: box.top - 8,
            left: box.left - 8,
            width: box.width + 16,
            height: box.height + 16,
            // El hueco: la sombra gigante pinta todo MENOS este rectangulo, asi
            // que lo de dentro se ve a plena luz. Un tutorial que oscurece
            // tambien aquello de lo que habla no ensena nada.
            boxShadow: '0 0 0 9999px rgba(12,24,36,0.72)',
            // Doble aro: el interior claro despega el elemento del velo y el
            // exterior en color de acento dice "es esto". Con un solo aro fino
            // sobre un fondo oscuro no se distingue de un borde cualquiera.
            outline: '3px solid var(--portal-accent, #F0A93B)',
            outlineOffset: '0px',
            border: '2px solid rgba(255,255,255,0.9)',
          }}
        />
      ) : null}

      <div
        // Por encima del recuadro y de su sombra. Sin un apilado explicito, la
        // sombra de 9999px del recuadro se pintaba sobre la tarjeta y el texto
        // de la pagina se colaba por encima.
        className="absolute z-10 w-[min(23rem,calc(100vw-2rem))] rounded-[var(--portal-radius)] border border-line-200 bg-white p-5 shadow-2xl"
        style={place}
      >
        {step ? (
          <>
            <p className="eyebrow mb-2">
              Paso {index + 1} de {visible.length}
            </p>
            <h2 className="font-display text-lg font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm text-ink-500">{step.body}</p>
          </>
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold">Nada que enseñar aquí</h2>
            <p className="mt-2 text-sm text-ink-500">
              Vuelve a abrirlo desde tu portada y te enseño las partes principales.
            </p>
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm font-medium text-ink-500 hover:text-ink-900"
          >
            Cerrar
          </button>

          <div className="flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="btn btn-sm btn-secondary"
              >
                Atrás
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => (last ? setOpen(false) : setIndex((i) => i + 1))}
              className="btn btn-sm btn-primary"
            >
              {last ? 'Entendido' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Donde poner la tarjeta.
 *
 * **Al lado del elemento, no en el centro de la pantalla.** Antes iba siempre
 * centrada en horizontal, asi que al senalar un destino de la barra lateral la
 * explicacion aparecia en mitad del contenido, encima de otras cosas y a medio
 * metro de la flecha: habia que buscar a que se referia.
 *
 * El orden de preferencia es: a la derecha si cabe -que es el caso de la barra
 * lateral, el mas frecuente-, luego debajo, luego encima. Y siempre dentro de la
 * pantalla, porque un panel que se sale por abajo no se puede leer ni cerrar.
 */
function placement(box: DOMRect | null): React.CSSProperties {
  if (!box) {
    return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  const CARD = { width: 368, height: 230 };
  const GAP = 16;
  const margin = 12;
  const { innerWidth: vw, innerHeight: vh } = window;

  const clampTop = (value: number) =>
    Math.max(margin, Math.min(value, vh - CARD.height - margin));
  const clampLeft = (value: number) => Math.max(margin, Math.min(value, vw - CARD.width - margin));

  // A la derecha: es donde cae la barra lateral, que es lo que mas se senala.
  if (box.right + GAP + CARD.width + margin <= vw) {
    return { top: clampTop(box.top - 8), left: box.right + GAP };
  }

  // A la izquierda.
  if (box.left - GAP - CARD.width - margin >= 0) {
    return { top: clampTop(box.top - 8), left: box.left - GAP - CARD.width };
  }

  // Debajo, y si no cabe, encima.
  const below = box.bottom + GAP + CARD.height + margin <= vh;
  return {
    top: below ? box.bottom + GAP : clampTop(box.top - GAP - CARD.height),
    left: clampLeft(box.left),
  };
}
