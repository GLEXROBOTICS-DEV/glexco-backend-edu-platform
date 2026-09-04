import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import {
  KIND_LABEL,
  STATUS_LABEL,
  fetchAssessmentDetail,
  type AuthoredQuestion,
} from '../../../../../lib/teacher-assessments';
import {
  cloneAssessment,
  publishAssessment,
} from '../../../../../lib/teacher-assessments.actions';
import { AssessmentEditor } from '../../../../../components/assessment-editor';
import { EmptyState, SectionTitle } from '../../../../../components/ui';

export const metadata: Metadata = { title: 'Editar evaluación' };

export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  await requireSession();
  const { assessmentId } = await params;

  const { data, failed } = await fetchAssessmentDetail(assessmentId);

  if (failed || !data) {
    return (
      <EmptyState
        title="No pudimos abrir esta evaluación"
        description="Puede que pertenezca a otra institución."
        action={{ href: '/docentes/evaluaciones', label: 'Ver evaluaciones' }}
      />
    );
  }

  const frozen = data.submissionCount > 0;

  return (
    <>
      <section>
        <a
          href="/docentes/evaluaciones"
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Evaluaciones
        </a>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
            {data.title}
          </h1>
          <p
            data-status={data.status}
            className="text-sm font-medium"
            style={{ color: data.status === 'published' ? '#0A7D57' : '#B26A00' }}
          >
            <span aria-hidden="true">● </span>
            {STATUS_LABEL[data.status] ?? data.status}
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {KIND_LABEL[data.kind] ?? data.kind} · {data.questions.length}{' '}
          {data.questions.length === 1 ? 'pregunta' : 'preguntas'} · {data.totalPoints} puntos ·
          aprueba con {data.passingScore}%
          {data.timeLimitMinutes ? ` · ${data.timeLimitMinutes} min por intento` : ''}
        </p>
      </section>

      {!data.editable ? (
        <section
          className="border border-line-200 bg-white"
          style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
        >
          <h2 className="font-display text-base font-semibold">Esta evaluación es de GLEXCO</h2>
          <p className="mt-2 text-sm text-ink-700">
            Viene con el kit y es la misma para todos los colegios, así que no se
            puede editar: editarla cambiaría el examen de todo el país. Duplícala
            y adapta tu copia.
          </p>
          <form action={cloneAssessment} className="mt-4">
            <input type="hidden" name="assessmentId" value={data.assessmentId} />
            <button
              type="submit"
              className="btn btn-primary"
            >
              Duplicar para mi salón
            </button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="preguntas" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="preguntas">Preguntas</SectionTitle>

        {data.questions.length === 0 ? (
          <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
            Todavía no tiene ninguna. Una evaluación sin preguntas no se puede
            publicar.
          </p>
        ) : (
          <ol className="grid list-none gap-3">
            {data.questions.map((question, index) => (
              <li key={question.id}>
                <QuestionCard question={question} index={index} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {data.editable && frozen ? (
        <p className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700">
          {/*
            Se dice el motivo y la salida, no solo la prohibición: el docente
            necesita saber qué hacer, y "archívala y crea una versión nueva" es
            una instrucción, mientras que "no se puede" es un muro.
          */}
          Ya hay {data.submissionCount}{' '}
          {data.submissionCount === 1 ? 'entrega' : 'entregas'}, así que las
          preguntas quedaron congeladas: cambiarlas invalidaría en silencio las
          notas ya puestas, porque esos alumnos respondieron a otra cosa. Puedes
          duplicarla y adaptar la copia.
        </p>
      ) : null}

      {data.editable && !frozen ? <AssessmentEditor assessmentId={data.assessmentId} /> : null}

      {data.editable && data.status !== 'published' && data.questions.length > 0 ? (
        <form action={publishAssessment}>
          <input type="hidden" name="assessmentId" value={data.assessmentId} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="btn btn-primary"
            >
              Publicar
            </button>
            <p className="text-sm text-ink-500">
              Al publicarla, tus alumnos la verán en su portal.
            </p>
          </div>
        </form>
      ) : null}
    </>
  );
}

/**
 * Una pregunta, ya guardada.
 *
 * La respuesta correcta se marca **solo si el backend la envió**, y en este tipo
 * es opcional justamente por eso: en el banco de GLEXCO no llega. Comprobarlo
 * aquí no es defensivo por gusto, es lo que hace que la pantalla no invente una
 * clave que no tiene.
 */
function QuestionCard({ question, index }: { question: AuthoredQuestion; index: number }) {
  const correct = new Set(question.correctOptionIds ?? []);
  const hasKey = correct.size > 0;

  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <p className="font-display text-base font-semibold">
        <span className="text-ink-400">{index + 1}. </span>
        {question.prompt}
      </p>
      <p className="mt-1 text-xs text-ink-400">
        {question.points} {question.points === 1 ? 'punto' : 'puntos'}
        {question.options.length === 0 ? ' · la corriges tú' : ''}
      </p>

      {question.options.length > 0 ? (
        <ul className="mt-3 grid list-none gap-1 text-sm">
          {question.options.map((option) => {
            const isCorrect = correct.has(option.id);

            return (
              <li key={option.id} className={isCorrect ? 'font-medium text-ink-900' : 'text-ink-500'}>
                {hasKey ? (isCorrect ? '◉ ' : '○ ') : '· '}
                {option.text}
                {isCorrect ? <span className="text-ink-400"> — correcta</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {question.explanation ? (
        <p className="mt-3 rounded-lg bg-surface-100 px-3 py-2 text-xs text-ink-700">
          Se muestra tras corregir: {question.explanation}
        </p>
      ) : null}
    </div>
  );
}
