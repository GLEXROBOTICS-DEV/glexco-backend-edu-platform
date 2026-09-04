'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { publishAnnouncement, type AnnouncementState } from '../lib/announcements.actions';
import type { ClassroomSummary } from '../lib/classrooms';

/**
 * Publicar un anuncio.
 *
 * Funciona sin JavaScript, como el resto de formularios del portal: un docente
 * escribiendo desde el ordenador del aula con la extension de turno bloqueando
 * medio bundle sigue pudiendo avisar a su clase.
 */
export function AnnouncementForm({ classrooms }: { classrooms: ClassroomSummary[] }) {
  const [state, formAction] = useActionState<AnnouncementState, FormData>(
    publishAnnouncement,
    {},
  );

  if (classrooms.length === 0) {
    return (
      <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
        Todavía no tienes salones asignados. Cuando los tengas podrás escribir anuncios.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {state.published ? (
        <p
          role="status"
          data-published="1"
          className="rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
        >
          Publicado. Tus alumnos lo verán la próxima vez que entren.
        </p>
      ) : null}

      <div>
        <label htmlFor="classroomId" className="block text-sm font-medium text-ink-700">
          Salón
        </label>
        <select
          id="classroomId"
          name="classroomId"
          required
          // Con un solo salon viene elegido: dejarlo sin marcar solo consigue
          // que alguien envie el formulario sin salon y tenga que reescribirlo.
          defaultValue={classrooms.length === 1 ? classrooms[0]!.classroomId : ''}
          className="field mt-1.5"
        >
          {classrooms.length > 1 ? <option value="">Elige el salón…</option> : null}
          {classrooms.map((classroom) => (
            <option key={classroom.classroomId} value={classroom.classroomId}>
              {classroom.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-ink-700">
          Título
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="Traigan el kit el viernes"
          className="field mt-1.5"
        />
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-ink-700">
          Mensaje
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={5}
          maxLength={4000}
          className="field mt-1.5"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          name="pinned"
          className="size-4 rounded border-line-300 text-brand-600"
        />
        Fijar arriba del todo
      </label>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-submit="anuncio"
      className="btn btn-primary"
    >
      {pending ? 'Publicando…' : 'Publicar el anuncio'}
    </button>
  );
}
