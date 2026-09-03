import { BadgeIcon, LevelIcon } from '@glexco/icons';
import { fetchLearningProgress } from '../lib/learning';
import { Card, SectionTitle } from './ui';

/**
 * Nivel del Explorador, XP e insignias.
 *
 * **Solo mide lo propio y nunca compara con nadie.** No hay posicion en la
 * clase, ni "vas por delante de 12 compañeros", ni nada que se le parezca. Es la
 * regla del cliente para el ranking y aqui vale igual: a un niño de ocho años,
 * "eres el 24 de 30" no le enseña nada, y el coste emocional de la comparacion
 * publica entre menores es real.
 *
 * Lo que si se muestra es cuanto falta para el siguiente nivel, que es un
 * objetivo propio y alcanzable.
 */
export async function ExplorerProgress({ portal }: { portal: 'discover' | 'academy' }) {
  const { data, failed } = await fetchLearningProgress();

  if (failed) return null;

  const progressToNext =
    data.xpToNext === null ? 100 : Math.round((data.totalXp / (data.totalXp + data.xpToNext)) * 100);

  return (
    <section aria-labelledby="explorador" data-explorer-level={data.explorerLevel}>
      <SectionTitle id="explorador">
        {portal === 'discover' ? 'Tu nivel de Explorador' : 'Tu progreso'}
      </SectionTitle>

      <Card>
        <div className="flex items-start gap-4">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600"
            aria-hidden="true"
          >
            <LevelIcon size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold">
              Nivel {data.explorerLevel} · {data.levelName}
            </p>
            <p className="mt-0.5 text-sm text-ink-500" data-xp={data.totalXp}>
              {data.totalXp} puntos de experiencia
            </p>

            {data.xpToNext !== null ? (
              <div className="mt-3">
                {/* La barra lleva su cifra al lado y no solo la longitud: la
                    longitud sirve para ver de un vistazo cuanto queda, y el
                    numero para saber exactamente cuanto. */}
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-surface-200"
                  role="progressbar"
                  aria-valuenow={progressToNext}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progreso hacia ${data.nextLevelName}`}
                >
                  <div
                    className="h-2.5 rounded-full bg-brand-600"
                    style={{ width: `${progressToNext}%` }}
                  />
                </div>
                <p className="mt-1.5 text-sm text-ink-700">
                  Te faltan <strong className="font-semibold">{data.xpToNext}</strong> para llegar a{' '}
                  {data.nextLevelName}.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm font-medium text-brand-700">
                Llegaste al nivel más alto. Enhorabuena.
              </p>
            )}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line-200 pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-ink-500">Lecciones completadas</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {data.lessonsCompleted}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-500">Cursos terminados</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {data.coursesCompleted}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-500">Insignias</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {data.badges.length}
            </dd>
          </div>
        </dl>
      </Card>

      {data.badges.length > 0 ? (
        <ul className="mt-[var(--portal-gap)] flex flex-wrap gap-2" data-badges={data.badges.length}>
          {data.badges.map((badge) => (
            <li
              key={badge.code}
              className="flex items-center gap-2 rounded-full border border-brand-600/25 bg-brand-600/5 px-3 py-1.5 text-sm font-medium text-brand-700"
            >
              <BadgeIcon size={16} />
              {badge.name}
            </li>
          ))}
        </ul>
      ) : null}

      {data.courses.length > 0 ? (
        <ul className="mt-[var(--portal-gap)] grid gap-[var(--portal-gap)] sm:grid-cols-2">
          {data.courses.map((course) => {
            const percent =
              course.lessonCount > 0
                ? Math.round((course.lessonsCompleted / course.lessonCount) * 100)
                : 0;

            return (
              <li key={course.courseId}>
                <Card>
                  <h3 className="font-display text-base font-semibold">{course.title}</h3>
                  <p
                    className="mt-0.5 text-sm text-ink-500"
                    data-course-progress={percent}
                    // El conteo va tambien en un atributo porque React parte el
                    // texto de un JSX interpolado con separadores de comentario:
                    // buscarlo por su texto falla aunque la pantalla este bien.
                    data-lessons={`${course.lessonsCompleted}/${course.lessonCount}`}
                  >
                    {/* "3 de 12" y no solo un porcentaje: a un alumno le sirve
                        saber cuantas le quedan, que es lo que puede planificar. */}
                    {`${course.lessonsCompleted} de ${course.lessonCount} ${
                      course.lessonCount === 1 ? 'lección' : 'lecciones'
                    }`}
                  </p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-200">
                    <div className="h-2 rounded-full bg-brand-600" style={{ width: `${percent}%` }} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
