import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { requireSession } from '../../../../../../../lib/session';
import { fetchStudentInClassroom, scoreTone, shortDate } from '../../../../../../../lib/analytics';
import { fetchRoster } from '../../../../../../../lib/grading';
import { DonutChart, StatTile, TimelineChart } from '../../../../../../../components/charts';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../../../../components/ui';

export const metadata: Metadata = { title: 'Alumno' };

/**
 * Un alumno, visto por su docente o por la dirección del colegio.
 *
 * **El backend ya servía estos datos y no había pantalla.** El endpoint existe
 * desde que existe la analítica, con su doble comprobación —que el salón sea del
 * actor, o de su institución si es dirección, y que el alumno esté en ESE
 * salón—, y ningún sitio del portal llegaba hasta aquí.
 *
 * Va colgando del salón y no de una lista global de alumnos, y eso no es un
 * detalle de rutas: el permiso es de SALÓN. Una pantalla `/alumnos/{id}` suelta
 * obligaría a inventar a qué salón pertenece la consulta, y ahí es donde un
 * permiso de salón se convierte por accidente en uno de institución.
 */
export default async function StudentDetail({
  params,
}: {
  params: Promise<{ classroomId: string; studentId: string }>;
}) {
  await requireSession();
  const { classroomId, studentId } = await params;

  return (
    <>
      <section>
        <a
          href={`/docentes/salones/${classroomId}`}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Volver al salón
        </a>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Detail classroomId={classroomId} studentId={studentId} />
      </Suspense>
    </>
  );
}

async function Detail({ classroomId, studentId }: { classroomId: string; studentId: string }) {
  const vocab = await getTranslations();
  const format = await getFormatter();
  // El nombre viene de la matrícula y no del dashboard: la analítica es una
  // proyección de resultados y no tiene por qué saber cómo se llama nadie.
  const [{ data, failed }, roster] = await Promise.all([
    fetchStudentInClassroom(classroomId, studentId),
    fetchRoster(classroomId),
  ]);

  const name = roster.byId.get(studentId) ?? 'Este alumno';

  if (failed || !data) {
    return (
      <EmptyState
        title="No pudimos cargar a este alumno"
        description="Puede que ya no esté en este salón. Vuelve al salón y ábrelo desde la lista."
        action={{ href: `/docentes/salones/${classroomId}`, label: 'Volver al salón' }}
      />
    );
  }

  const glexco = scoreTone(vocab, data.averageGlexco);
  const institution = scoreTone(vocab, data.averageInstitution);

  return (
    <>
      <section>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-display font-semibold">
          {name}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {data.assessmentsTaken === 0
            ? 'Todavía no ha entregado ninguna evaluación.'
            : `${data.assessmentsTaken} ${data.assessmentsTaken === 1 ? 'evaluación entregada' : 'evaluaciones entregadas'}`}
        </p>
      </section>

      {data.assessmentsTaken === 0 ? (
        <EmptyState
          title="Sin resultados todavía"
          description="Cuando entregue su primera evaluación verás aquí sus notas y su evolución. Mientras tanto, en la lista del salón puedes ver si ha activado su kit y si está avanzando en las lecciones."
        />
      ) : (
        <>
          <section
            aria-labelledby="notas"
            className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4"
          >
            <h2 id="notas" className="sr-only">
              Sus notas
            </h2>

            {/*
              Las dos medias van SEPARADAS, igual que en la pantalla del alumno.
              Promediarlas juntas haría que su nota subiera porque su profesor
              puso un examen fácil, y eso convierte el número en algo que no
              significa nada.
            */}
            <DonutChart
              value={data.averageGlexco}
              label="Media GLEXCO"
              caption="Las evaluaciones del kit"
              tone={glexco.tone}
              toneLabel={glexco.label}
            />
            <DonutChart
              value={data.averageInstitution}
              label="Media de tus evaluaciones"
              caption="Las que preparaste tú"
              tone={institution.tone}
              toneLabel={institution.label}
            />
            {/*
              La mejora es el número que de verdad dice si está aprendiendo: no
              es la nota, es cuánto subió desde su primer intento. Un alumno que
              empieza en 40 y llega a 60 aprendió más que uno que se quedó en 80.
            */}
            <StatTile
              label="Cuánto ha mejorado"
              value={
                data.averageGain === null
                  ? null
                  : data.averageGain > 0
                    ? `+${data.averageGain}`
                    : data.averageGain
              }
              unit="pts"
              tone={data.averageGain !== null && data.averageGain > 0 ? 'good' : 'neutral'}
              toneLabel={
                data.averageGain !== null && data.averageGain > 0 ? 'Va mejorando' : undefined
              }
              hint="Desde su primer intento"
            />
            <StatTile
              label="Aprobadas"
              value={data.passRate}
              unit="%"
              hint={`${data.assessmentsTaken} en total`}
            />
          </section>

          <section aria-labelledby="evolucion">
            <SectionTitle id="evolucion">Su evolución</SectionTitle>
            <TimelineChart
              title="Resultados en orden"
              passingScore={60}
              points={data.timeline.map((entry) => ({
                label: `${entry.origin === 'glexco' ? 'GLEXCO' : 'Tuya'} · ${shortDate(format, entry.gradedAt)}`,
                value: Math.round(entry.percentage),
                passed: entry.passed,
              }))}
            />
          </section>

          {/* No hay "lo que mas le cuesta" por alumno: el dashboard individual
              no trae fallos por pregunta, y el del SALON si. Es correcto que sea
              asi -tres respuestas de un alumno no son una senal, treinta del
              salon si-, y por eso ese bloque vive en la pantalla del salon. */}
        </>
      )}
    </>
  );
}
