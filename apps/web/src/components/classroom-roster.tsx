import { getFormatter, getTranslations } from 'next-intl/server';
import { StudentsIcon } from '@glexco/icons';
import { fetchClassroomRoster } from '../lib/grading';
import { fetchClassroomLearning } from '../lib/learning';
import { shortDate } from '../lib/analytics';
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
  const t = await getTranslations('docente');
  const format = await getFormatter();
  const [roster, learning] = await Promise.all([
    fetchClassroomRoster(classroomId),
    fetchClassroomLearning(classroomId),
  ]);

  if (roster.failed) {
    return (
      <EmptyState
        title={t('noPudimosCargarLista')}
        description={t('noPudimosCargarListaAyuda')}
      />
    );
  }

  const active = roster.items.filter((entry) => entry.status === 'active');

  if (active.length === 0) {
    return (
      <EmptyState
        icon={<StudentsIcon size={32} />}
        title={t('sinAlumnosEnSalon')}
        description={t('sinAlumnosEnSalonAyuda')}
      />
    );
  }

  const progress = new Map(learning.items.map((row) => [row.studentId, row]));

  return (
    <div className="overflow-x-auto rounded-[var(--portal-radius)] border border-line-200 bg-white">
      <table className="w-full min-w-[42rem] text-sm">
        <caption className="sr-only">{t('tablaAlumnos')}</caption>
        <thead>
          <tr className="border-b border-line-200 text-left text-ink-500">
            <th scope="col" className="px-4 py-3 font-medium">{t('columnaAlumno')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('columnaKit')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('columnaLecciones')}</th>
            <th scope="col" className="px-4 py-3 font-medium">{t('columnaUltimaActividad')}</th>
            <th scope="col" className="px-4 py-3 font-medium">
              <span className="sr-only">{t('columnaVerDetalle')}</span>
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
                  {entry.fullName ?? <span className="text-ink-400">{t('sinNombreTodavia')}</span>}
                </th>

                <td className="px-4 py-3">
                  {entry.kitId ? (
                    <StatePill state="done">{t('kitActivado')}</StatePill>
                  ) : (
                    // Sin kit no hay contenido, ni evaluaciones, ni progreso. Es
                    // la senal mas temprana que existe y por eso va en ambar y no
                    // en gris: hay algo que hacer.
                    <StatePill state="warn">{t('kitSinActivar')}</StatePill>
                  )}
                </td>

                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {row ? row.lessonsCompleted : <span className="text-ink-400">—</span>}
                </td>

                <td className="px-4 py-3 text-ink-700">
                  {row?.lastActivityAt ? (
                    <>
                      {shortDate(format, row.lastActivityAt)}
                      {row.stale ? (
                        <span className="ml-2 text-xs font-medium text-state-warn-fg">
                          {t('seHaDescolgado')}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-ink-400">{t('sinActividad')}</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  <a
                    href={`/docentes/salones/${classroomId}/alumnos/${entry.studentId}`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    {t('ver')}
                    <span className="sr-only">
                      {t('verDetalleDe', { nombre: entry.fullName ?? t('esteAlumno') })}
                    </span>
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {learning.failed ? (
        <p className="border-t border-line-200 px-4 py-3 text-xs text-ink-500">
          {t('sinAvancePorContenido')}
        </p>
      ) : (
        <p className="border-t border-line-200 px-4 py-3 text-xs text-ink-500">
          {t('queEsDescolgarse', { dias: learning.staleAfterDays })}
        </p>
      )}
    </div>
  );
}
