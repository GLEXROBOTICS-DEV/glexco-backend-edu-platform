import { StudentsIcon } from '@glexco/icons';
import { fetchClassroomRoster } from '../lib/grading';
import { fetchClassroomLearning } from '../lib/learning';
import { EmptyState, StatePill } from './ui';

/**
 * La clase, alumno por alumno.
 *
 * **Es lo que faltaba en la pantalla del salon.** Habia media, dispersion y
 * preguntas mas falladas —el estado del grupo—, pero ninguna forma de llegar a
 * un alumno concreto. Y la pregunta que un docente se hace despues de ver que la
 * mitad va mal es siempre "¿quien?".
 *
 * Se junta la matricula con el progreso por contenido a proposito: quien no ha
 * activado su kit y quien lleva dos semanas sin tocar nada son las dos senales
 * que llegan ANTES del primer examen, y son las unicas sobre las que todavia se
 * puede hacer algo.
 */
export async function ClassroomRoster({ classroomId }: { classroomId: string }) {
  const [roster, learning] = await Promise.all([
    fetchClassroomRoster(classroomId),
    fetchClassroomLearning(classroomId),
  ]);

  if (roster.failed) {
    return (
      <EmptyState
        title="No pudimos cargar la lista de tu salón"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, escribe a soporte."
      />
    );
  }

  const active = roster.items.filter((entry) => entry.status === 'active');

  if (active.length === 0) {
    return (
      <EmptyState
        icon={<StudentsIcon size={32} />}
        title="Todavía no hay alumnos en este salón"
        description="Tus alumnos aparecen aquí cuando se registran con el código del colegio y eligen este salón."
      />
    );
  }

  const progress = new Map(learning.items.map((row) => [row.studentId, row]));

  return (
    <div className="overflow-x-auto rounded-[var(--portal-radius)] border border-line-200 bg-white">
      <table className="w-full min-w-[42rem] text-sm">
        <caption className="sr-only">
          Alumnos del salón, con su kit y su actividad reciente
        </caption>
        <thead>
          <tr className="border-b border-line-200 text-left text-ink-500">
            <th scope="col" className="px-4 py-3 font-medium">Alumno</th>
            <th scope="col" className="px-4 py-3 font-medium">Kit</th>
            <th scope="col" className="px-4 py-3 font-medium">Lecciones</th>
            <th scope="col" className="px-4 py-3 font-medium">Última actividad</th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">Ver detalle</span>
            </th>
          </tr>
        </thead>
        <tbody data-roster={active.length}>
          {active.map((entry) => {
            const row = progress.get(entry.studentId);

            return (
              <tr key={entry.studentId} className="border-b border-line-200 last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-medium text-ink-900">
                  {/* El nombre llega por evento y la proyeccion puede ir unos
                      segundos por detras. Se dice, en vez de pintar un hueco
                      que parece un fallo. */}
                  {entry.fullName ?? <span className="text-ink-400">Sin nombre todavía</span>}
                </th>

                <td className="px-4 py-3">
                  {entry.kitId ? (
                    <StatePill state="done">Activado</StatePill>
                  ) : (
                    // Sin kit no hay contenido, ni evaluaciones, ni progreso. Es
                    // la senal mas temprana que existe y por eso va en ambar y no
                    // en gris: hay algo que hacer.
                    <StatePill state="warn">Sin activar</StatePill>
                  )}
                </td>

                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {row ? row.lessonsCompleted : <span className="text-ink-400">—</span>}
                </td>

                <td className="px-4 py-3 text-ink-700">
                  {row?.lastActivityAt ? (
                    <>
                      {shortDate(row.lastActivityAt)}
                      {row.stale ? (
                        <span className="ml-2 text-xs font-medium text-state-warn-fg">
                          se ha descolgado
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-ink-400">sin actividad</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  <a
                    href={`/docentes/salones/${classroomId}/alumnos/${entry.studentId}`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    Ver
                    <span className="sr-only"> el detalle de {entry.fullName ?? 'este alumno'}</span>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {learning.failed ? (
        <p className="border-t border-line-200 px-4 py-3 text-xs text-ink-500">
          No pudimos leer el avance por contenido ahora mismo. La lista de alumnos sí es correcta.
        </p>
      ) : (
        <p className="border-t border-line-200 px-4 py-3 text-xs text-ink-500">
          «Se ha descolgado» significa {learning.staleAfterDays} días sin terminar ninguna lección.
        </p>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Lima',
  }).format(date);
}
