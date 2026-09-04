import { AnnouncementIcon } from '@glexco/icons';
import { fetchAnnouncements, relativeDate, type Announcement } from '../lib/announcements';
import { fetchMyClassroom } from '../lib/classrooms';
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
  only,
}: {
  /** El docente publica avisos desde su panel, no preguntas desde aquí. */
  canAsk?: boolean;
  title?: string;
  /**
   * Filtra por tipo de publicación.
   *
   * **Anuncios y muro son dos pantallas distintas y no dos pestañas de la
   * misma.** Son dos cosas que se leen de forma distinta: un aviso del docente
   * hay que verlo hoy, y una conversación se sigue a lo largo de la semana.
   * Mezclarlas hacía que un aviso importante quedara enterrado entre preguntas.
   */
  only?: 'announcement' | 'question';
}) {
  const all = await fetchAnnouncements();
  const items = only ? all.filter((post) => post.kind === only) : all;

  // El salón solo hace falta para PREGUNTAR: el docente ve el muro de todos los
  // suyos y no pregunta desde aquí, así que no se le pide.
  const classroomId = canAsk ? await fetchMyClassroom() : null;

  // Los nombres **vienen ya en la respuesta**. La primera versión los resolvía
  // llamando al listado de matrícula, que es un endpoint de DOCENTES: cualquier
  // alumno recibía «permisos insuficientes» y veía el muro entero firmado por
  // «un compañero», que es justo lo contrario de lo que busca esta pantalla.

  return (
    <section aria-labelledby="muro" className="grid gap-[var(--portal-gap)]">
      <h2 id="muro" className="sr-only">
        {title}
      </h2>

      {canAsk && classroomId ? <AskForm classroomId={classroomId} /> : null}

      {items.length === 0 ? (
        <EmptyState
          // Dentro de la seccion del muro, que ya tiene su h2.
          level={3}
          icon={<AnnouncementIcon size={32} />}
          title={
            only === 'announcement'
              ? 'No hay anuncios todavía'
              : 'Todavía no hay preguntas'
          }
          description={
            only === 'announcement'
              ? 'Cuando tu docente publique un aviso, aparecerá aquí.'
              : canAsk
                ? 'Sé el primero en preguntar. Tu docente y tus compañeros lo verán.'
                : 'Cuando alguien de tus salones pregunte, aparecerá aquí.'
          }
        />
      ) : (
        <ul className="grid gap-[var(--portal-gap)]" data-wall={items.length}>
          {items.map((post) => (
            <li key={post.announcementId}>
              <Post post={post} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Post({ post }: { post: Announcement }) {
  const question = post.kind === 'question';
  const replies = post.replies ?? [];

  return (
    <article
      data-post={post.kind}
      // La marca de fijado se perdio al sustituir la lista de anuncios por el
      // muro: el aviso seguia fijandose en el backend -y ordenandose primero-
      // pero en pantalla no se distinguia de los demas, asi que el docente no
      // podia saber cual habia dejado arriba. Lo delato una comprobacion del
      // portal, que es justo para lo que existe.
      data-pinned={post.pinned ? '1' : undefined}
      className={`rounded-[var(--portal-radius)] border bg-white p-[var(--portal-card-padding)] ${
        post.pinned ? 'border-brand-400' : 'border-line-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold">{post.title}</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {/* La PALABRA junto al borde de color. Un estado nunca se comunica
                solo con color: el par que distingue el borde fijado del normal
                queda muy por debajo del umbral para una vision con deficiencia
                de rojo, y ahi el aviso importante deja de destacar. */}
            {post.pinned ? <span className="font-medium text-brand-700">Fijado · </span> : null}
            {post.authorName ?? (question ? 'Un compañero' : 'Tu docente')} ·{' '}
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
                {reply.authorName ?? 'Alguien de tu clase'} ·{' '}
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
