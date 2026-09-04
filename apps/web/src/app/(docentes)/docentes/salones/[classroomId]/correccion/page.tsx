import type { Metadata } from 'next';
import { getFormatter } from 'next-intl/server';
import { Suspense } from 'react';
import { requireSession } from '../../../../../../lib/session';
import { fetchPendingSubmissions, fetchRoster, studentLabel } from '../../../../../../lib/grading';
import { shortDate } from '../../../../../../lib/analytics';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../../../components/ui';

export const metadata: Metadata = { title: 'Por corregir' };

export default async function GradingInboxPage({
  params,
}: {
  params: Promise<{ classroomId: string }>;
}) {
  await requireSession();
  const { classroomId } = await params;

  return (
    <>
      <section>
        <a
          href={`/docentes/salones/${classroomId}`}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Cómo va el salón
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          Por corregir
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Las entregas que esperan tu puntuación. Lo de marcar ya está corregido.
        </p>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Inbox classroomId={classroomId} />
      </Suspense>
    </>
  );
}

/**
 * La bandeja.
 *
 * Las dos llamadas van **en paralelo** con `Promise.all`. En serie, abrir la
 * bandeja costaría la latencia de las dos sumadas, y la segunda no depende de
 * la primera para nada: una trae las entregas y la otra los nombres.
 */
async function Inbox({ classroomId }: { classroomId: string }) {
  const format = await getFormatter();
  const [pending, roster] = await Promise.all([
    fetchPendingSubmissions(classroomId),
    fetchRoster(classroomId),
  ]);

  if (pending.failed) {
    return (
      <EmptyState
        title="No pudimos cargar la bandeja"
        description="Puede que este salón no sea tuyo, o que el servicio esté volviendo. Vuelve a intentarlo."
      />
    );
  }

  if (pending.items.length === 0) {
    return (
      <EmptyState
        title="No tienes nada por corregir"
        description="Cuando tus alumnos entreguen algo abierto —una respuesta escrita, una foto del robot, un enlace a su vídeo— aparecerá aquí."
        action={{ href: `/docentes/salones/${classroomId}`, label: 'Ver cómo va el salón' }}
      />
    );
  }

  return (
    <section aria-labelledby="pendientes" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="pendientes">
        {pending.items.length} {pending.items.length === 1 ? 'entrega' : 'entregas'}
      </SectionTitle>

      <ul className="grid list-none gap-3">
        {pending.items.map((item) => (
          <li key={item.submissionId}>
            <a
              href={`/docentes/salones/${classroomId}/correccion/${item.submissionId}`}
              className="flex flex-wrap items-center justify-between gap-3 border border-line-200 bg-white px-5 py-4 transition hover:border-brand-400"
              style={{ borderRadius: 'var(--portal-radius)' }}
            >
              <div>
                <p className="font-display font-semibold">
                  {studentLabel(item.studentId, roster.byId)}
                </p>
                <p className="mt-0.5 text-sm text-ink-500">
                  {item.assessmentTitle}
                  {item.origin === 'glexco' ? ' · GLEXCO' : ' · tu evaluación'}
                  {item.attemptNumber > 1 ? ` · intento ${item.attemptNumber}` : ''}
                </p>
              </div>

              <div className="text-right text-sm">
                {/*
                  Lo que se destaca es cuántas preguntas quedan, no la nota
                  parcial: es lo que le dice al docente cuánto trabajo tiene esa
                  fila. La nota todavía no significa nada.

                  `data-pending` es además el ancla de las comprobaciones. React
                  parte el texto de un JSX interpolado con separadores de
                  comentario, así que buscar "1 pregunta" en el HTML servido
                  falla aunque la pantalla lo pinte bien.
                */}
                <p
                  data-pending={item.pendingQuestions}
                  className="font-medium tabular-nums text-ink-900"
                >
                  {item.pendingQuestions}{' '}
                  {item.pendingQuestions === 1 ? 'pregunta' : 'preguntas'}
                </p>
                <p className="text-ink-400">
                  {item.submittedAt ? `Entregó el ${shortDate(format, item.submittedAt)}` : 'Sin fecha'}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
