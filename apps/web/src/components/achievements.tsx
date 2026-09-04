import { BadgeIcon, LevelIcon } from '@glexco/icons';
import { fetchLearningCatalogue, fetchLearningProgress } from '../lib/learning';
import { EmptyState, SectionTitle } from './ui';

/**
 * Mis logros: la escalera de niveles y todas las insignias.
 *
 * **Se muestran tambien las que aun no tiene, y con la condicion exacta para
 * conseguirlas.** Ensenar solo las ganadas convierte la pantalla en un espejo:
 * dice lo que ya sabes y no da ningun siguiente paso. Y ocultar las que faltan
 * no evita la comparacion —los ninos se ensenan la pantalla entre ellos—, solo
 * impide saber que hay que hacer.
 *
 * Lo que NO hay, y es una decision del cliente que aqui se respeta: ninguna
 * comparacion con nadie. Ni puesto en la clase, ni "vas por delante de 12
 * companeros". El progreso se mide solo contra uno mismo.
 */
export async function Achievements({ portal }: { portal: 'discover' | 'academy' }) {
  const [{ data, failed }, catalogue] = await Promise.all([
    fetchLearningProgress(),
    fetchLearningCatalogue(),
  ]);

  if (failed && catalogue.failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus logros"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  const earned = new Map(data.badges.map((badge) => [badge.code, badge]));

  // El catalogo manda el orden: es el mismo para todos, asi que la reja no se
  // reordena segun lo que cada alumno haya conseguido. Si se movieran de sitio,
  // volver a esta pantalla obligaria a buscar de nuevo la que se estaba mirando.
  //
  // Si el catalogo no responde se pintan al menos las conseguidas, sin su
  // descripcion -que solo vive alli-. Es peor ensenar la pantalla vacia a un
  // alumno que SI tiene insignias que ensenarlas sin el texto de apoyo.
  const badges: { code: string; name: string; description: string }[] =
    catalogue.badges.length > 0
      ? catalogue.badges
      : [...earned.values()].map((badge) => ({
          code: badge.code,
          name: badge.name,
          description: '',
        }));

  return (
    <>
      <Niveles
        levels={catalogue.levels}
        currentLevel={data.explorerLevel}
        totalXp={data.totalXp}
        portal={portal}
      />

      <section aria-labelledby="insignias" data-badges={earned.size}>
        <SectionTitle id="insignias">
          {portal === 'discover' ? 'Mis insignias' : 'Insignias'}
        </SectionTitle>
        <p className="-mt-2 mb-4 text-sm text-ink-500">
          {earned.size} de {badges.length} conseguidas.
        </p>

        <ul className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((badge) => {
            const mine = earned.get(badge.code);

            return (
              <li
                key={badge.code}
                data-badge={badge.code}
                data-earned={mine ? '' : undefined}
                className={`flex items-start gap-4 rounded-[var(--portal-radius)] border p-[var(--portal-card-padding)] ${
                  mine ? 'border-line-200 bg-white' : 'border-dashed border-line-300 bg-surface-50'
                }`}
              >
                <span
                  className={`grid size-12 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.75)] ${
                    mine
                      ? 'bg-[var(--portal-accent)] text-brand-700'
                      : 'bg-surface-200 text-ink-300'
                  }`}
                  aria-hidden="true"
                >
                  <BadgeIcon size={26} />
                </span>

                <div className="min-w-0">
                  <h3 className="font-display font-semibold">{badge.name}</h3>
                  {badge.description ? (
                    <p className="mt-1 text-sm text-ink-500">{badge.description}</p>
                  ) : null}

                  {/* El estado va en TEXTO y no solo en el color de la tarjeta:
                      el borde discontinuo y el icono gris no los anuncia un
                      lector de pantalla, y a distancia tampoco se distinguen. */}
                  {mine ? (
                    <p className="mt-2 text-xs font-medium text-state-done-fg">
                      Conseguida el {formatDate(mine.awardedAt)}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-ink-400">Todavía por conseguir</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/**
 * La escalera de niveles.
 *
 * Se ensena entera, con los de arriba incluidos. Saber que despues de Inventor
 * viene Constructor y a cuantos puntos esta es justo lo que convierte el XP en
 * un objetivo; sin la escalera, el numero no significa nada.
 */
function Niveles({
  levels,
  currentLevel,
  totalXp,
  portal,
}: {
  levels: readonly { level: number; name: string; minXp: number }[];
  currentLevel: number;
  totalXp: number;
  portal: 'discover' | 'academy';
}) {
  if (levels.length === 0) return null;

  return (
    <section aria-labelledby="niveles" data-level={currentLevel}>
      <SectionTitle id="niveles">
        {portal === 'discover' ? 'Niveles de Explorador' : 'Niveles'}
      </SectionTitle>

      <ol className="grid gap-2 sm:grid-cols-5">
        {levels.map((level) => {
          const reached = totalXp >= level.minXp;
          const current = level.level === currentLevel;

          return (
            <li
              key={level.level}
              aria-current={current ? 'step' : undefined}
              className={`rounded-[var(--portal-radius)] border p-4 ${
                current
                  ? 'border-[var(--portal-accent)] bg-white'
                  : reached
                    ? 'border-line-200 bg-white'
                    : 'border-dashed border-line-300 bg-surface-50'
              }`}
            >
              <span
                className={`grid size-8 place-items-center rounded-full text-sm font-semibold ${
                  reached
                    ? 'bg-[var(--portal-accent)] text-brand-700'
                    : 'bg-surface-200 text-ink-400'
                }`}
                aria-hidden="true"
              >
                {reached ? <LevelIcon size={18} /> : level.level}
              </span>
              <p className="mt-2.5 font-display text-sm font-semibold">{level.name}</p>
              <p className="mt-0.5 text-xs tabular-nums text-ink-500">
                {level.minXp === 0 ? 'Desde el inicio' : `${level.minXp} pts`}
              </p>
              {current ? (
                <p className="mt-1.5 text-xs font-medium text-state-doing-fg">Estás aquí</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Fecha corta y en español.
 *
 * `Intl` con zona horaria explicita: sin ella, el servidor formatea en UTC y una
 * insignia conseguida a las 21:00 en Lima aparece con la fecha del dia
 * siguiente, que al alumno le parece sencillamente un error.
 */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(date);
}
