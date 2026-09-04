'use client';

import { useEffect, useRef, useState } from 'react';

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
 * esta en la pagina se salta en vez de senalar al vacio: la barra lateral de un
 * docente no tiene lo mismo que la de un alumno, y mantener una lista por rol
 * garantizaria que una de ellas se quedara desincronizada.
 */
export function Tour({ steps, label = 'Cómo funciona' }: { steps: TourStep[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Solo los pasos cuyo elemento existe de verdad en esta pantalla.
  const [visible, setVisible] = useState<TourStep[]>([]);

  useEffect(() => {
    if (!open) return;
    setVisible(steps.filter((step) => document.querySelector(step.target)));
    setIndex(0);
  }, [open, steps]);

  const step = visible[index];

  useEffect(() => {
    if (!open || !step) return;

    const element = document.querySelector(step.target);
    if (!element) return;

    element.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Se remide al desplazar y al cambiar de tamano: el recuadro esta en
    // coordenadas de pantalla, y sin esto se queda clavado donde estaba.
    const measure = () => setBox(element.getBoundingClientRect());
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, step]);

  // Escape cierra, y el foco entra en el dialogo: si no, el teclado se queda
  // detras del velo pulsando cosas que no se ven.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Visita guiada">
      {/* El velo no tapa el elemento resaltado: se recorta un hueco con un
          `box-shadow` gigante. Un tutorial que oscurece tambien aquello de lo
          que habla no ensena nada. */}
      <div className="absolute inset-0 bg-ink-900/60" onClick={() => setOpen(false)} />

      {box ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-[var(--portal-accent)]"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            boxShadow: '0 0 0 9999px rgba(27,42,56,0.60)',
          }}
        />
      ) : null}

      <div
        className="absolute left-1/2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-[var(--portal-radius)] border border-line-200 bg-white p-5 shadow-xl"
        style={{
          // Debajo del elemento si cabe, encima si no. Con una posicion fija, la
          // tarjeta acaba tapando justo lo que senala en media pantalla.
          top: box && box.bottom + 200 < window.innerHeight ? box.bottom + 16 : undefined,
          bottom: box && box.bottom + 200 >= window.innerHeight ? 24 : undefined,
          ...(box ? {} : { top: '50%' }),
        }}
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
