import { BadgeIcon, ChallengeIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { fetchUpcomingActivities } from '../lib/assessments';
import { fetchLearningProgress } from '../lib/learning';
import { StatePill } from './ui';

/**
 * Proximas actividades.
 *
 * El canvas dibuja aqui "Proximos retos" en Discover y "Proximas actividades" en
 * Academy. Los retos de construccion son de la fase de gamificacion y todavia no
 * existen, asi que lo que se lista son las EVALUACIONES publicadas de sus kits,
 * que es lo que el alumno tiene de verdad por delante. Rellenar el bloque con
 * tarjetas de reto inventadas dejaria la portada llena de cosas que no se
 * pueden abrir.
 */
export async function UpcomingActivities({
  portal,
  className = 'lg:col-span-2',
}: {
  portal: 'discover' | 'academy';
  /** Lo decide la pagina: cada portada lo coloca en una fila distinta. */
  className?: string;
}) {
  const { kits } = await fetchMyKits();
  const { items } = await fetchUpcomingActivities(kits);

  const title = portal === 'discover' ? 'Próximos retos' : 'Próximas actividades';

  return (
    <article
      className={`rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] ${className}`}
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="eyebrow">{title}</h2>
        {items.length > 0 ? (
          <a
            href={`/${portal}/evaluaciones`}
            className="text-sm font-medium text-brand-600 hover:text-brand-400"
          >
            Ver todas
          </a>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="py-2 text-sm text-ink-500">
          {portal === 'discover'
            ? 'Ahora mismo no tienes nada pendiente. Tu docente publicará el próximo reto pronto.'
            : 'No tienes actividades pendientes. Cuando tu docente publique una, aparecerá aquí.'}
        </p>
      ) : (
        <ul className="grid gap-2.5" data-upcoming={items.length}>
          {items.slice(0, 4).map((item) => (
            <li
              key={item.assessmentId}
              className="flex flex-wrap items-center gap-3 rounded-[calc(var(--portal-radius)*0.75)] bg-surface-100 px-3.5 py-3"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.6)] bg-white text-brand-600"
                aria-hidden="true"
              >
                <ChallengeIcon size={18} />
              </span>

              <div className="min-w-0 flex-1">
                <a
                  href={`/${portal}/evaluaciones/${item.assessmentId}`}
                  className="font-medium text-ink-900 hover:text-brand-700"
                >
                  {item.title}
                </a>
                <p className="mt-0.5 text-xs text-ink-500">
                  {item.kitName} · {item.questionCount}{' '}
                  {item.questionCount === 1 ? 'pregunta' : 'preguntas'}
                  {item.dueAt ? ` · ${dueLabel(item.dueAt)}` : ''}
                </p>
              </div>

              <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-500">
                {item.totalPoints} pts
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * Logros recientes.
 *
 * Los tres ultimos y nada mas: el listado completo vive en "Mis logros". Aqui la
 * pregunta es "que he conseguido ultimamente", que se responde con tres lineas.
 */
export async function RecentBadges({ portal }: { portal: 'discover' | 'academy' }) {
  const { data } = await fetchLearningProgress();

  const recent = [...data.badges]
    .sort((a, b) => Date.parse(b.awardedAt) - Date.parse(a.awardedAt))
    .slice(0, 3);

  return (
    <article className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="eyebrow">Logros recientes</h2>
        {/* La ruta sale del portal. Estaba escrita a mano apuntando a Discover:
            en cuanto Academy tuvo logros, el enlace habria sacado al alumno de su
            portal, que es justo el fallo que se acaba de corregir. */}
        <a
          href={`/${portal}/logros`}
          className="text-sm font-medium text-brand-600 hover:text-brand-400"
        >
          Ver todos
        </a>
      </div>

      {recent.length === 0 ? (
        <p className="text-sm text-ink-500">
          Tu primera insignia llega al terminar una lección. Ya casi.
        </p>
      ) : (
        <ul className="grid gap-3" data-recent-badges={recent.length}>
          {recent.map((badge) => (
            <li key={badge.code} className="flex items-center gap-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.6)] bg-[var(--portal-accent)] text-brand-700"
                aria-hidden="true"
              >
                <BadgeIcon size={18} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{badge.name}</span>
                <span className="block text-xs text-ink-500">{agoLabel(badge.awardedAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/**
 * "Vence el viernes", "vence mañana".
 *
 * Relativo y no absoluto: a un alumno le importa si es para hoy o para dentro de
 * dos semanas, y "18 de septiembre" le obliga a calcularlo. Se pasa a la fecha
 * completa mas alla de una semana, donde lo relativo deja de decir nada.
 */
function dueLabel(iso: string): string {
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return '';

  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);

  if (days < 0) return 'fuera de plazo';
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  if (days <= 7) return `vence en ${days} días`;

  return `vence el ${new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Lima',
  }).format(due)}`;
}

function agoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  if (days < 14) return 'hace 1 semana';
  if (days < 30) return `hace ${Math.floor(days / 7)} semanas`;
  return `hace ${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? 'mes' : 'meses'}`;
}

export { StatePill };
