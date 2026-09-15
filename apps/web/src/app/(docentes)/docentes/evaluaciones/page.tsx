import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '../../../../lib/session';
import {
  assessmentKindLabel,
  assessmentStatusLabel,
  fetchAssessmentBank,
} from '../../../../lib/teacher-assessments';
import { cloneAssessment } from '../../../../lib/teacher-assessments.actions';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../components/ui';
import type { AssessmentSummary } from '../../../../lib/assessments';

export const metadata: Metadata = { title: 'Evaluaciones' };

export default async function TeacherAssessmentsPage() {
  await requireSession();
  const t = await getTranslations('docente');

  return (
    <>
      <section className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
            {t('evaluacionesTitulo')}
          </h1>
          <p className="mt-1 text-sm text-ink-500">{t('evaluacionesSubtitulo')}</p>
        </div>
        <a
          href="/docentes/evaluaciones/nueva"
          className="btn btn-primary"
        >
          {t('crearEvaluacion')}
        </a>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Bank />
      </Suspense>
    </>
  );
}

/**
 * El banco, en dos bloques.
 *
 * La separación no es estética: son dos cosas distintas y se operan distinto.
 * Las de GLEXCO son las mismas para todos los colegios y solo se pueden
 * **duplicar**; las propias se editan y se publican. Mezclarlas en una tabla con
 * una columna "origen" obligaría al docente a leer la fila para saber qué botón
 * espera, que es exactamente el trabajo que una pantalla debería ahorrarle.
 */
async function Bank() {
  const { glexco, own, failed } = await fetchAssessmentBank();
  const t = await getTranslations('docente');
  const comun = await getTranslations('comun');
  const vocab = await getTranslations();

  if (failed) {
    return (
      <EmptyState
        title={t('noPudimosCargarEvaluaciones')}
        description={comun('reintentar')}
      />
    );
  }

  return (
    <>
      <section aria-labelledby="mias" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="mias">{t('tuyasConCuenta', { cuantas: own.length })}</SectionTitle>

        {own.length === 0 ? (
          <EmptyState
            level={3}
            title={t('ningunaPropia')}
            description={t('ningunaPropiaAyuda')}
            action={{ href: '/docentes/evaluaciones/nueva', label: t('crearEvaluacion') }}
          />
        ) : (
          <ul className="grid list-none gap-3">
            {own.map((item) => (
              <li key={item.assessmentId}>
                <Row
                  item={item}
                  href={`/docentes/evaluaciones/${item.assessmentId}`}
                  t={t}
                  vocab={vocab}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="glexco" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="glexco">
          {t('incluidasEnKits', { cuantas: glexco.length })}
        </SectionTitle>
        <p className="-mt-2 text-sm text-ink-500">
          {/*
            Se explica POR QUÉ no se pueden editar, no solo que no se puede. Un
            botón deshabilitado sin motivo se lee como un error de la aplicación.
          */}
          {t('porQueNoSeEditan')}
        </p>

        {glexco.length === 0 ? (
          <EmptyState
            level={3}
            title={t('kitSinEvaluaciones')}
            description={t('kitSinEvaluacionesAyuda')}
          />
        ) : (
          <ul className="grid list-none gap-3">
            {glexco.map((item) => (
              <li key={item.assessmentId}>
                <Row item={item} clone t={t} vocab={vocab} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Row({
  item,
  href,
  clone = false,
  t,
  vocab,
}: {
  item: AssessmentSummary;
  href?: string;
  clone?: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
  vocab: (key: string) => string;
}) {
  const body = (
    <>
      <div>
        <p className="font-display font-semibold">{item.title}</p>
        <p className="mt-0.5 text-sm text-ink-500">
          {assessmentKindLabel(vocab, item.kind)} ·{' '}
          {t('resumenPreguntas', { cuantas: item.questionCount })} ·{' '}
          {t('resumenPuntos', { cuantos: item.totalPoints })}
        </p>
      </div>

      <p
        data-status={item.status}
        className="text-sm font-medium"
        style={{ color: item.status === 'published' ? '#0A7D57' : '#B26A00' }}
      >
        <span aria-hidden="true">● </span>
        {assessmentStatusLabel(vocab, item.status)}
      </p>
    </>
  );

  const shell =
    'flex flex-wrap items-center justify-between gap-3 border border-line-200 bg-white px-5 py-4';

  if (clone) {
    return (
      <div className={shell} style={{ borderRadius: 'var(--portal-radius)' }}>
        {body}
        <form action={cloneAssessment}>
          <input type="hidden" name="assessmentId" value={item.assessmentId} />
          <button
            type="submit"
            className="btn btn-secondary"
          >
            {t('duplicar')}
          </button>
        </form>
      </div>
    );
  }

  return (
    <a
      href={href}
      className={`${shell} transition hover:border-brand-400`}
      style={{ borderRadius: 'var(--portal-radius)' }}
    >
      {body}
    </a>
  );
}
