import { AnnouncementIcon } from '@glexco/icons';
import { fetchAnnouncements, relativeDate, type Announcement } from '../lib/announcements';
import { fetchMyClassroom } from '../lib/classrooms';
import { fetchRoster } from '../lib/grading';
import { AskForm, ReplyForm } from './wall-forms';
import { EmptyState, StatePill } from './ui';

/**
 * El muro del salon.
 *
 * Sustituye a la lista de anuncios de solo lectura. El cliente lo pidió así:
 * **no son mensajes privados, es un tablón donde el alumno también pregunta y lo
 * ven todos**, para que las dudas de uno sirvan al resto.
 *
 * Esa decisión, además de ser mejor pedagógicamente, es la más segura que se
 * podía tomar: **no existe ningún canal privado entre un adulto y un menor**.
 * Todo lo que se escribe aquí lo ve la clase entera, incluido su docente, que es
 * la mejor moderación que hay y no cuesta nada mantener.
 */
export async function ClassroomWall({
  canAsk = true,
  title = 'El muro de tu clase',
}: {
  /** El docente publica avisos desde su panel, no preguntas desde aquí. */
  canAsk?: boolean;
  title?: string;
}) {
  const items = await fetchAnnouncements();

  // El salón solo hace falta para PREGUNTAR: el docente ve el muro de todos los
  // suyos y no pregunta desde aquí, así que no se le pide.
  const classroomId = canAsk ? await fetchMyClassroom() : null;

  // Los nombres salen de la matrícula. Sin ellos el muro sería una conversación
  // entre identificadores, que es lo contrario de lo que se busca: que los
  // alumnos se reconozcan y se contesten.
  //
  // Se piden los de TODOS los salones que aparecen en el muro, no solo los del
  // propio: un docente con tres salones vería dos tercios de los mensajes
  // firmados por "alguien de tu clase".
  const classroomsInWall = [...new Set(items.map((post) => post.classroomId))];
  const rosters = await Promise.all(classroomsInWall.map((id) => fetchRoster(id)));
  const names = new Map<string, string>();
  for (const roster of rosters) {
    for (const [id, name] of roster.byId) names.set(id, name);
  }

  return (
    <section aria-labelledby="muro" className="grid gap-[var(--portal-gap)]">
      <h2 id="muro" className="sr-only">
        {title}
      </h2>

      {canAsk && classroomId ? <AskForm classroomId={classroomId} /> : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<AnnouncementIcon size={32} />}
          title="Todavía no hay nada en el muro"
          description={
            canAsk
              ? 'Sé el primero en preguntar. Tu docente y tus compañeros lo verán.'
              : 'Cuando tu docente publique algo, aparecerá aquí.'
          }
        />
      ) : (
        <ul className="grid gap-[var(--portal-gap)]" data-wall={items.length}>
          {items.map((post) => (
            <li key={post.announcementId}>
              <Post post={post} names={names} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Post({ post, names }: { post: Announcement; names: Map<string, string> }) {
  const question = post.kind === 'question';
  const replies = post.replies ?? [];

  return (
    <article
      data-post={post.kind}
      className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">{post.title}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {names.get(post.authorId) ?? (question ? 'Un compañero' : 'Tu docente')} ·{' '}
            {relativeDate(post.publishedAt)}
          </p>
        </div>

        {/* De quién viene, en texto. Un aviso del docente y la duda de un
            compañero se leen distinto, y el color solo no lo dice. */}
        <StatePill state={question ? 'doing' : 'warn'}>
          {question ? 'Pregunta' : 'Aviso'}
        </StatePill>
      </div>

      {/* `whitespace-pre-line`: el alumno escribe con saltos de línea y sin esto
          su pregunta sale como un párrafo corrido. */}
      <p className="mt-3 whitespace-pre-line text-sm text-ink-700">{post.body}</p>

      {replies.length > 0 ? (
        <ul className="mt-4 grid gap-3 border-t border-line-200 pt-4">
          {replies.map((reply) => (
            <li key={reply.id} className="text-sm">
              <p className="text-xs font-medium text-ink-500">
                {names.get(reply.authorId) ?? 'Alguien de tu clase'} ·{' '}
                {relativeDate(reply.createdAt)}
              </p>
              <p className="mt-0.5 whitespace-pre-line text-ink-700">{reply.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <ReplyForm announcementId={post.announcementId} />
    </article>
  );
}
