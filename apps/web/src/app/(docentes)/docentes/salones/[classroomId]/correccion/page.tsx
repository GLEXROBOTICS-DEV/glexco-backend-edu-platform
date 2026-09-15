import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
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
  const t = await getTranslations('docente');

  return (
    <>
      <section>
        <a
          href={`/docentes/salones/${classroomId}`}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          {t('volverAComoVa')}
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          {t('porCorregir')}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{t('porCorregirSubtitulo')}</p>
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
  const t = await getTranslations('docente');
  const [pending, roster] = await Promise.all([
    fetchPendingSubmissions(classroomId),
    fetchRoster(classroomId),
  ]);

  if (pending.failed) {
    return (
      <EmptyState
        title={t('noPudimosCargarBandeja')}
        description={t('noPudimosCargarBandejaAyuda')}
      />
    );
  }

  if (pending.items.length === 0) {
    return (
      <EmptyState
        title={t('nadaPorCorregir')}
        description={t('nadaPorCorregirAyuda')}
        action={{ href: `/docentes/salones/${classroomId}`, label: t('verComoVaElSalon') }}
      />
    );
  }

  return (
    <section aria-labelledby="pendientes" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="pendientes">
        {t('cuantasEntregas', { cuantas: pending.items.length })}
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
                  {item.origin === 'glexco' ? ` · ${t('origenGlexco')}` : ` · ${t('origenTuya')}`}
                  {item.attemptNumber > 1
                    ? ` · ${t('intentoNumero', { numero: item.attemptNumber })}`
                    : ''}
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
                  {t('cuantasPreguntas', { cuantas: item.pendingQuestions })}
                </p>
                <p className="text-ink-400">
                  {item.submittedAt
                    ? t('entregoEl', { fecha: shortDate(format, item.submittedAt) })
                    : t('sinFecha')}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
