import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireSession } from '../../../../lib/session';
import {
  KIND_LABEL,
  STATUS_LABEL,
  fetchAssessmentBank,
} from '../../../../lib/teacher-assessments';
import { cloneAssessment } from '../../../../lib/teacher-assessments.actions';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../components/ui';
import type { AssessmentSummary } from '../../../../lib/assessments';

export const metadata: Metadata = { title: 'Evaluaciones' };

export default async function TeacherAssessmentsPage() {
  await requireSession();

  return (
    <>
      <section className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
            Evaluaciones
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Las que vienen con el kit y las tuyas.
          </p>
        </div>
        <a
          href="/docentes/evaluaciones/nueva"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Crear una evaluación
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

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar las evaluaciones"
        description="Vuelve a intentarlo en un momento."
      />
    );
  }

  return (
    <>
      <section aria-labelledby="mias" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="mias">Tuyas ({own.length})</SectionTitle>

        {own.length === 0 ? (
          <EmptyState
            title="Todavía no has creado ninguna"
            description="Puedes crear una desde cero, o duplicar una de GLEXCO y adaptarla a tu salón."
            action={{ href: '/docentes/evaluaciones/nueva', label: 'Crear una evaluación' }}
          />
        ) : (
          <ul className="grid list-none gap-3">
            {own.map((item) => (
              <li key={item.assessmentId}>
                <Row item={item} href={`/docentes/evaluaciones/${item.assessmentId}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="glexco" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="glexco">Incluidas en los kits ({glexco.length})</SectionTitle>
        <p className="-mt-2 text-sm text-ink-500">
          {/*
            Se explica POR QUÉ no se pueden editar, no solo que no se puede. Un
            botón deshabilitado sin motivo se lee como un error de la aplicación.
          */}
          Son las mismas para todos los colegios, así que no se editan: editarlas
          cambiaría el examen de todo el país. Duplica la que quieras adaptar.
        </p>

        {glexco.length === 0 ? (
          <EmptyState
            title="Este kit todavía no trae evaluaciones"
            description="Cuando el equipo de GLEXCO publique las del kit aparecerán aquí."
          />
        ) : (
          <ul className="grid list-none gap-3">
            {glexco.map((item) => (
              <li key={item.assessmentId}>
                <Row item={item} clone />
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
}: {
  item: AssessmentSummary;
  href?: string;
  clone?: boolean;
}) {
  const body = (
    <>
      <div>
        <p className="font-display font-semibold">{item.title}</p>
        <p className="mt-0.5 text-sm text-ink-500">
          {KIND_LABEL[item.kind] ?? item.kind} · {item.questionCount}{' '}
          {item.questionCount === 1 ? 'pregunta' : 'preguntas'} · {item.totalPoints} puntos
        </p>
      </div>

      <p
        data-status={item.status}
        className="text-sm font-medium"
        style={{ color: item.status === 'published' ? '#0A7D57' : '#B26A00' }}
      >
        <span aria-hidden="true">● </span>
        {STATUS_LABEL[item.status] ?? item.status}
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
            className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-600/5"
          >
            Duplicar
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
