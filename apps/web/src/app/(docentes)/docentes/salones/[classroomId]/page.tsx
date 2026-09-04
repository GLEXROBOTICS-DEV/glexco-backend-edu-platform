import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { requireSession } from '../../../../../lib/session';
import { fetchClassroomDashboard, scoreTone, shortDate } from '../../../../../lib/analytics';
import { BarList, StatTile } from '../../../../../components/charts';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../../components/ui';
import { ClassroomRoster } from '../../../../../components/classroom-roster';

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
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
            Cómo va el salón
          </h1>
          {/*
            La bandeja se enlaza desde aquí y no desde el menú: se entra a
            corregir DE un salón, y un enlace global obligaría a elegir el salón
            otra vez en la pantalla siguiente.
          */}
          <a
            href={`/docentes/salones/${classroomId}/correccion`}
            className="btn btn-primary"
          >
            Por corregir
          </a>
        </div>
      </section>

      {/* La lista va ANTES de las cifras. La pregunta con la que un docente
          entra es "quien necesita ayuda", y la media del grupo no la responde:
          la responde una fila con un nombre. Las cifras explican al grupo, y eso
          se mira despues. */}
      <section aria-labelledby="clase">
        <SectionTitle id="clase">Tu clase</SectionTitle>
        <Suspense fallback={<CardSkeleton />}>
          <ClassroomRoster classroomId={classroomId} />
        </Suspense>
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
  const vocab = await getTranslations();
  const format = await getFormatter();
  const { data, failed } = await fetchClassroomDashboard(classroomId);

  if (failed || !data) {
    return (
      // Antes este mensaje decia "puede que no sea uno de tus salones", y
      // mezclaba tres cosas distintas: que el salon no sea tuyo, que aun no haya
      // datos, y que la llamada fallara. Al docente le decia que quiza estaba
      // donde no debia cuando lo unico que pasaba era que la analitica no habia
      // respondido. Ahora habla solo de lo que si sabemos, y la lista de arriba
      // -que se pinta igual- ya le deja trabajar.
      <EmptyState
        title="Las cifras del salón no están disponibles ahora mismo"
        description="Vuelve a intentarlo en un momento. La lista de tu clase sí es correcta y puedes seguir trabajando con ella."
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

  const level = scoreTone(vocab, data.averagePercentage);
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
              ? `Última actividad el ${shortDate(format, data.lastActivityAt)}`
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
