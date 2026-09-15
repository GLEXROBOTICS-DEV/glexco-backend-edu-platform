import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '../../../../../lib/session';
import {
  assessmentKindLabel,
  assessmentStatusLabel,
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
  const t = await getTranslations('docente');
  const vocab = await getTranslations();
  // Espacio aparte porque NO debe viajar al navegador: la palabra "correcta"
  // dentro del catalogo serializado hace chocar la comprobacion de seguridad
  // que exige que la clave de correccion no aparezca en ningun sitio del HTML,
  // ni siquiera en un `<script>`. Esta pantalla es de servidor y no lo necesita.
  const servidor = await getTranslations('docenteServidor');

  if (failed || !data) {
    return (
      <EmptyState
        title={t('noPudimosAbrirEvaluacion')}
        description={t('noPudimosAbrirEvaluacionAyuda')}
        action={{ href: '/docentes/evaluaciones', label: t('verEvaluaciones') }}
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
          {t('volverAEvaluaciones')}
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
            {assessmentStatusLabel(vocab, data.status)}
          </p>
        </div>
        <p className="mt-1 text-sm text-ink-500">
          {assessmentKindLabel(vocab, data.kind)} ·{' '}
          {t('resumenPreguntas', { cuantas: data.questions.length })} ·{' '}
          {t('resumenPuntos', { cuantos: data.totalPoints })} ·{' '}
          {t('apruebaCon', { porcentaje: data.passingScore })}
          {data.timeLimitMinutes
            ? ` · ${t('minPorIntento', { minutos: data.timeLimitMinutes })}`
            : ''}
        </p>
      </section>

      {!data.editable ? (
        <section
          className="border border-line-200 bg-white"
          style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
        >
          <h2 className="font-display text-base font-semibold">{t('esDeGlexco')}</h2>
          <p className="mt-2 text-sm text-ink-700">{t('esDeGlexcoAyuda')}</p>
          <form action={cloneAssessment} className="mt-4">
            <input type="hidden" name="assessmentId" value={data.assessmentId} />
            <button
              type="submit"
              className="btn btn-primary"
            >
              {t('duplicarParaMiSalon')}
            </button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="preguntas" className="grid gap-[var(--portal-gap)]">
        <SectionTitle id="preguntas">{t('preguntas')}</SectionTitle>

        {data.questions.length === 0 ? (
          <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
            {t('sinPreguntasTodavia')}
          </p>
        ) : (
          <ol className="grid list-none gap-3">
            {data.questions.map((question, index) => (
              <li key={question.id}>
                <QuestionCard question={question} index={index} t={t} servidor={servidor} />
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
          {t('preguntasCongeladas', { cuantas: data.submissionCount })}
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
              {t('publicar')}
            </button>
            <p className="text-sm text-ink-500">{t('alPublicarla')}</p>
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
function QuestionCard({
  question,
  index,
  t,
  servidor,
}: {
  question: AuthoredQuestion;
  index: number;
  t: (key: string, values?: Record<string, string | number>) => string;
  servidor: (key: string) => string;
}) {
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
        {t('puntosPregunta', { cuantos: question.points })}
        {question.options.length === 0 ? ` · ${t('laCorrigesTu')}` : ''}
      </p>

      {question.options.length > 0 ? (
        <ul className="mt-3 grid list-none gap-1 text-sm">
          {question.options.map((option) => {
            const isCorrect = correct.has(option.id);

            return (
              <li key={option.id} className={isCorrect ? 'font-medium text-ink-900' : 'text-ink-500'}>
                {hasKey ? (isCorrect ? '◉ ' : '○ ') : '· '}
                {option.text}
                {isCorrect ? (
                  <span className="text-ink-400"> — {servidor('opcionCorrecta')}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {question.explanation ? (
        <p className="mt-3 rounded-lg bg-surface-100 px-3 py-2 text-xs text-ink-700">
          {t('seMuestraTrasCorregir', { texto: question.explanation })}
        </p>
      ) : null}
    </div>
  );
}
