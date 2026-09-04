import { GRADE_LEVEL, type EducationLevel } from '@glexco/contracts';
import { fetchMyKits } from '../lib/catalog';

/**
 * Ruta tecnologica GLEXCO.
 *
 * Las cinco escuelas encadenadas que define el dominio (ver la seccion de rutas
 * formativas en DOMINIO.md): Vocacional, Tecnica, Superior, Especializacion y
 * Certificacion Profesional. Es la pieza que le dice a un estudiante de
 * secundaria que lo que esta haciendo lleva a alguna parte, y sin ella Academy
 * es una lista de cursos sueltos.
 *
 * **La etapa actual se DEDUCE del nivel educativo de sus kits, no se guarda.**
 * Cuando exista `LearningPath` como dato -con sus cursos encadenados- este
 * componente leera de ahi; mientras tanto, deducirlo del grado es cierto y no
 * obliga a inventar una tabla que despues habria que migrar.
 */

interface Stage {
  key: string;
  name: string;
  /** Niveles educativos que caen en esta etapa. Vacio: aun no se alcanza. */
  levels: readonly EducationLevel[];
}

const STAGES: readonly Stage[] = [
  { key: 'vocational', name: 'Escuela Vocacional', levels: ['primary', 'secondary'] },
  { key: 'technical', name: 'Escuela Técnica', levels: ['technical'] },
  { key: 'higher', name: 'Educación Superior', levels: ['higher', 'university'] },
  { key: 'specialization', name: 'Especialización', levels: [] },
  { key: 'certification', name: 'Certificación', levels: [] },
];

export async function LearningPath() {
  const { kits, failed } = await fetchMyKits();
  if (failed || kits.length === 0) return null;

  // El nivel MAS ALTO de sus kits. Un estudiante puede tener a la vez un kit de
  // secundaria y uno tecnico; la etapa es la mas avanzada, no la primera que
  // aparece en la lista.
  const levels = kits
    .map((kit) => GRADE_LEVEL[kit.grade as keyof typeof GRADE_LEVEL])
    .filter(Boolean) as EducationLevel[];

  const currentIndex = STAGES.reduce(
    (best, stage, index) =>
      stage.levels.some((level) => levels.includes(level)) ? index : best,
    -1,
  );

  // Sin etapa reconocible no se pinta: un camino con las cinco escuelas apagadas
  // no dice nada y ocupa un tercio de la pantalla.
  if (currentIndex < 0) return null;

  return (
    <article className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] lg:col-span-2">
      <h2 className="eyebrow mb-5">Ruta tecnológica GLEXCO</h2>

      <ol className="flex gap-1 overflow-x-auto pb-1" data-path-stage={STAGES[currentIndex]!.key}>
        {STAGES.map((stage, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;

          return (
            <li
              key={stage.key}
              aria-current={current ? 'step' : undefined}
              className="relative flex min-w-[7.5rem] flex-1 flex-col items-center text-center"
            >
              {/* La linea que une con la etapa anterior. Va detras del circulo y
                  no entre elementos para que no se rompa al envolver. */}
              {index > 0 ? (
                <span
                  className={`absolute left-0 top-[0.9375rem] h-0.5 w-1/2 ${
                    done || current ? 'bg-success' : 'bg-line-200'
                  }`}
                  aria-hidden="true"
                />
              ) : null}
              {index < STAGES.length - 1 ? (
                <span
                  className={`absolute right-0 top-[0.9375rem] h-0.5 w-1/2 ${
                    done ? 'bg-success' : 'bg-line-200'
                  }`}
                  aria-hidden="true"
                />
              ) : null}

              <span
                className={`relative grid size-[1.875rem] place-items-center rounded-full border-2 ${
                  done
                    ? 'border-success bg-success text-white'
                    : current
                      ? 'border-brand-400 bg-white text-brand-600'
                      : 'border-line-200 bg-white text-ink-300'
                }`}
                aria-hidden="true"
              >
                {done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7" />
                  </svg>
                ) : (
                  <span className="size-2 rounded-full bg-current" />
                )}
              </span>

              <span className="mt-2.5 text-xs font-medium leading-tight text-ink-900">
                {stage.name}
              </span>
              {/* El estado va en texto, no solo en el color del circulo: verde y
                  ambar quedan indistinguibles con protanopia, y un lector de
                  pantalla no ve ninguno de los dos. */}
              <span className="mt-0.5 text-[11px] text-ink-500">
                {done ? 'completada' : current ? 'en curso' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
