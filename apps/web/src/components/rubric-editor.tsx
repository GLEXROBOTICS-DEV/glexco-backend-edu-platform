'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Editor de rúbrica del docente.
 *
 * **Tres niveles fijos por criterio —logrado, parcial, no logrado— y el docente
 * solo pone el criterio y cuánto vale.** Es una simplificación deliberada: una
 * matriz vacía de criterios por niveles es un formulario que nadie rellena, y
 * una rúbrica a medias es peor que no tenerla porque el alumno ve criterios sin
 * puntuar. Tres niveles es además lo que se usa en la práctica escolar.
 *
 * El nivel intermedio vale la mitad, redondeando hacia abajo. Redondear hacia
 * arriba haría que un criterio de 5 diera 3 por «parcial», y sumando cuatro
 * criterios la nota parcial se acercaría demasiado a la completa.
 *
 * **La suma tiene que cuadrar con los puntos de la pregunta**, y el dominio lo
 * exige: si la rúbrica diera menos, la pregunta sería imposible de sacar entera;
 * si diera más, el docente puntuaría todo y luego no podría cerrar la nota. Aquí
 * se enseña la suma en vivo para que no llegue a pasar.
 */

const MAX_CRITERIOS = 5;

export function RubricEditor({ questionPoints }: { questionPoints: number }) {
  const t = useTranslations('docente');
  const [activa, setActiva] = useState(false);
  const [criterios, setCriterios] = useState([
    { label: '', points: 0 },
    { label: '', points: 0 },
  ]);

  const suma = criterios.reduce((total, criterio) => total + (criterio.points || 0), 0);
  const usados = criterios.filter((criterio) => criterio.label.trim().length > 0);
  const cuadra = suma === questionPoints;

  function actualizar(index: number, cambio: Partial<{ label: string; points: number }>): void {
    setCriterios((previos) =>
      previos.map((criterio, i) => (i === index ? { ...criterio, ...cambio } : criterio)),
    );
  }

  if (!activa) {
    return (
      <div className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3">
        <p className="text-sm text-ink-700">{t('sinRubrica')}</p>
        <button
          type="button"
          onClick={() => setActiva(true)}
          className="btn btn-sm btn-secondary mt-3"
        >
          {t('anadirRubrica')}
        </button>
      </div>
    );
  }

  return (
    <fieldset className="grid gap-3 rounded-lg border border-line-200 p-4">
      <legend className="px-1 text-sm font-medium text-ink-700">{t('rubrica')}</legend>

      {/* Se dice para qué sirve, no qué es. Un docente que no sabe por qué
          debería molestarse no la rellena. */}
      <p className="text-xs text-ink-500">{t('rubricaParaQue')}</p>

      {criterios.map((criterio, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_7rem]">
          <label className="grid gap-1">
            <span className="sr-only">{t('criterioNumero', { numero: index + 1 })}</span>
            <input
              type="text"
              name="rubricCriterion"
              value={criterio.label}
              onChange={(event) => actualizar(index, { label: event.target.value })}
              placeholder={t('ejemploCriterio', { numero: index + 1 })}
              className="field"
            />
          </label>

          <label className="grid gap-1">
            <span className="sr-only">
              {t('puntosDelCriterio', { numero: index + 1 })}
            </span>
            <input
              type="number"
              name="rubricPoints"
              min={0}
              max={questionPoints}
              value={criterio.points || ''}
              onChange={(event) =>
                actualizar(index, { points: Number(event.target.value) || 0 })
              }
              placeholder={t('puntos')}
              className="field"
            />
          </label>
        </div>
      ))}

      {criterios.length < MAX_CRITERIOS ? (
        <button
          type="button"
          onClick={() => setCriterios((previos) => [...previos, { label: '', points: 0 }])}
          className="justify-self-start text-sm font-medium text-brand-600 hover:underline"
        >
          {t('anadirOtroCriterio')}
        </button>
      ) : null}

      {/* La suma en vivo, y el aviso ANTES de enviar. El dominio rechaza si no
          cuadra, y descubrirlo al enviar significa volver a rellenar. */}
      <p
        role="status"
        className={`text-sm font-medium ${cuadra ? 'text-state-done-fg' : 'text-state-warn-fg'}`}
      >
        {usados.length === 0
          ? t('repartePuntos', { puntos: questionPoints })
          : cuadra
            ? t('rubricaCuadra', { suma, puntos: questionPoints })
            : t('rubricaNoCuadra', { suma, puntos: questionPoints })}
      </p>

      <button
        type="button"
        onClick={() => {
          setActiva(false);
          setCriterios([
            { label: '', points: 0 },
            { label: '', points: 0 },
          ]);
        }}
        className="justify-self-start text-sm text-ink-500 hover:text-ink-900"
      >
        {t('quitarRubrica')}
      </button>
    </fieldset>
  );
}
