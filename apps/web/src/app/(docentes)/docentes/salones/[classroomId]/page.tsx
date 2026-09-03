import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '../../../../../lib/session';
import { fetchClassroomDashboard, scoreTone, shortDate } from '../../../../../lib/analytics';
import { BarList, StatTile } from '../../../../../components/charts';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../../components/ui';

export const metadata: Metadata = { title: 'Salón' };

export default async function ClassroomDashboardPage({
  params,
}: {
  params: Promise<{ classroomId: string }>;
}) {
  await requireSession();
  const { classroomId } = await params;

  return (
    <>
      <section>
        <a href="/docentes" className="text-sm font-medium text-brand-600 hover:underline">
          ← Mis salones
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          Cómo va el salón
        </h1>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Dashboard classroomId={classroomId} />
      </Suspense>
    </>
  );
}

/**
 * "¿Quién necesita ayuda y en qué?" — el dashboard del salón.
 *
 * Las dos piezas responden a las dos mitades de esa pregunta, y por eso están
 * las dos:
 *
 * - **Media y dispersión juntas.** Una media de 70 con todos en 70 y una media
 *   de 70 con la mitad en 100 y la mitad en 40 son dos clases distintas y piden
 *   dos cosas distintas. Mostrar solo la media las presenta como iguales, que es
 *   el error más común de un panel de aula.
 *
 * - **Las preguntas que más falla el salón.** Es el dato más accionable que
 *   existe para un docente: no le dice "tu clase va mal", le dice qué volver a
 *   explicar el lunes.
 */
async function Dashboard({ classroomId }: { classroomId: string }) {
  const { data, failed } = await fetchClassroomDashboard(classroomId);

  if (failed || !data) {
    return (
      <EmptyState
        title="No pudimos cargar este salón"
        description="Puede que no sea uno de tus salones, o que la analítica esté al día en unos segundos. Vuelve a intentarlo."
      />
    );
  }

  if (data.studentsMeasured === 0) {
    return (
      <EmptyState
        title="Aún no hay resultados en este salón"
        description="Cuando tus alumnos entreguen su primera evaluación verás aquí cómo va la clase y qué preguntas les cuestan más."
      />
    );
  }

  const level = scoreTone(data.averagePercentage);
  const spread = data.stddevPercentage;

  return (
    <section aria-labelledby="salon" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="salon">Resumen</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Nota media"
          value={data.averagePercentage}
          unit="%"
          tone={level.tone}
          toneLabel={level.label}
          hint="Solo evaluaciones GLEXCO, que son comparables"
        />

        {/*
          La dispersión con su lectura escrita al lado. Un número como "18,4"
          no le dice nada a nadie sin la frase que lo interpreta: el docente no
          necesita saber qué es una desviación típica, necesita saber si su clase
          va junta o partida en dos.
        */}
        <StatTile
          label="Qué tan parejo va el salón"
          value={spread}
          unit=" pts"
          tone={spread === null ? 'neutral' : spread > 20 ? 'warning' : 'good'}
          toneLabel={
            spread === null
              ? undefined
              : spread > 20
                ? 'Muy desigual: hay dos grupos'
                : 'Bastante parejo'
          }
          hint="Cuánto se separan entre sí"
        />

        <StatTile
          label="Cuánto ha mejorado la clase"
          value={data.averageGain === null ? null : data.averageGain > 0 ? `+${data.averageGain}` : data.averageGain}
          unit=" pts"
          hint="Desde el primer intento de cada alumno"
        />

        <StatTile
          label="Alumnos con resultados"
          value={data.studentsMeasured}
          hint={
            data.lastActivityAt
              ? `Última actividad el ${shortDate(data.lastActivityAt)}`
              : 'Sin actividad reciente'
          }
        />
      </div>

      <BarList
        title="Lo que más falla tu salón"
        unit="%"
        emptyMessage="Todavía no hay suficientes respuestas. Hacen falta al menos tres por pregunta para que el dato signifique algo."
        data={data.hardestQuestions.map((question, index) => ({
          // Sin el enunciado -que vive en el servicio de evaluación y no en la
          // analítica- se numeran. Es honesto: inventar un título sería peor.
          label: `Pregunta ${index + 1}`,
          value: Math.round(question.missRate),
          meta: `${question.missed} de ${question.answered}`,
          tone: question.missRate >= 60 ? 'critical' : question.missRate >= 40 ? 'warning' : 'neutral',
          toneLabel:
            question.missRate >= 60
              ? 'Conviene volver a explicarla'
              : question.missRate >= 40
                ? 'La mitad de la clase falla'
                : undefined,
        }))}
      />
    </section>
  );
}
