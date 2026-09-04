'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { submitAttempt, type SubmitState } from '../lib/assessment.actions';
import { EvidenceFileInput } from './evidence-file';
import type { StudentQuestion } from '../lib/assessments';

/**
 * El cuestionario que responde el alumno.
 *
 * Es un `<form>` normal con `<input type="radio">` y `<input type="checkbox">`,
 * y eso no es una simplificación: los controles nativos traen gratis la
 * navegación por teclado, el anuncio correcto en un lector de pantalla y el
 * agrupado por `name`. Un componente propio a base de `div` con `onClick`
 * tendría que reimplementar las tres cosas, y normalmente reimplementa mal las
 * tres.
 *
 * **Funciona sin JavaScript.** `useActionState` sobre `<form action>` degrada a
 * un envío normal del navegador: en un laboratorio con equipos viejos o una
 * conexión que corta el bundle a mitad, el alumno sigue pudiendo entregar.
 *
 * El cliente no conoce ni puede conocer las respuestas correctas: solo envía lo
 * que se marcó. La corrección ocurre en el servidor.
 */
export function QuizForm({
  submissionId,
  questions,
  timeLimitMinutes,
  expiresAt,
  attemptsLeft,
  resultHref,
}: {
  submissionId: string;
  questions: StudentQuestion[];
  timeLimitMinutes: number | null;
  /**
   * Instante ABSOLUTO en que se acaba este intento, calculado por el servidor.
   *
   * No se cuentan los minutos desde que carga la pagina: recargar regalaria el
   * tiempo entero otra vez, y es lo primero que prueba cualquier alumno.
   */
  expiresAt: string | null;
  attemptsLeft: number;
  /**
   * Adonde ir tras entregar. Se pasa entero y no se construye con una ruta
   * relativa: `../progreso` se resolvia contra la URL de la evaluacion y
   * apuntaba a una pagina que no existe, y eso solo se ve pulsandolo.
   */
  resultHref: string;
}) {
  const [state, formAction] = useActionState<SubmitState, FormData>(submitAttempt, {});
  const t = useTranslations('evaluacion');
  const formRef = useRef<HTMLFormElement>(null);

  if (state.status) {
    return <Result state={state} attemptsLeft={attemptsLeft} resultHref={resultHref} />;
  }

  return (
    <form ref={formRef} action={formAction} className="grid gap-[var(--portal-gap)]">
      <input type="hidden" name="submissionId" value={submissionId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {expiresAt ? (
        <Countdown
          expiresAt={expiresAt}
          onExpire={() => {
            // Se entrega SOLA al llegar a cero. Sin esto, quien se queda sin
            // tiempo pierde todo lo respondido y recibe un error, que es la peor
            // forma de terminar un examen. El servidor da un minuto de gracia
            // justo para que este envio llegue.
            formRef.current?.requestSubmit();
          }}
        />
      ) : timeLimitMinutes ? (
        <p className="rounded-lg border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
          {/* `t.rich` y no tres trozos: el minuto va destacado y en ingles no
              cae en el mismo sitio de la frase. */}
          {t.rich('tienesMinutos', {
            b: () => <strong>{t('minutos', { minutos: timeLimitMinutes })}</strong>,
          })}
        </p>
      ) : null}

      <ol className="grid list-none gap-[var(--portal-gap)]">
        {questions.map((question, index) => (
          <li key={question.id}>
            <QuestionCard question={question} index={index} />
          </li>
        ))}
      </ol>

      <SubmitButton />
    </form>
  );
}

function QuestionCard({ question, index }: { question: StudentQuestion; index: number }) {
  const t = useTranslations('evaluacion');
  const multiple = question.type === 'multiple_choice';
  const ordering = question.type === 'ordering';
  const evidence = question.type === 'file_upload';
  const legendId = `pregunta-${question.id}`;

  return (
    <div
      className="border border-line-200 bg-white"
      style={{ borderRadius: 'var(--portal-radius)', padding: 'var(--portal-card-padding)' }}
    >
      <input type="hidden" name="questionId" value={question.id} />

      {/* `fieldset` + `legend` es lo que agrupa las opciones para un lector de
          pantalla: sin ellos, las opciones se leen como casillas sueltas sin
          saber a qué pregunta pertenecen. */}
      <fieldset>
        <legend id={legendId} className="mb-1 font-display text-base font-semibold">
          <span className="text-ink-400">{index + 1}. </span>
          {question.prompt}
        </legend>

        <p className="mb-4 text-xs text-ink-400">
          {t('puntos', { puntos: question.points })}
          {multiple ? ` · ${t('marcaTodas')}` : ''}
          {ordering ? ` · ${t('ordenaLosPasos')}` : ''}
          {evidence ? ` · ${t('entregaEvidencia')}` : ''}
        </p>

        {ordering ? (
          <OrderingAnswer question={question} t={t} />
        ) : evidence ? (
          <EvidenceAnswer question={question} t={t} />
        ) : question.options.length > 0 ? (
          <div className="grid gap-2">
            {question.options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-200 px-4 py-3 text-sm text-ink-700 transition hover:border-brand-400 hover:bg-surface-100 has-checked:border-brand-600 has-checked:bg-brand-600/5"
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={`answer:${question.id}`}
                  value={option.id}
                  className="size-4 shrink-0 border-line-300 text-brand-600"
                />
                {option.text}
              </label>
            ))}
          </div>
        ) : (
          <textarea
            name={`text:${question.id}`}
            rows={5}
            aria-labelledby={legendId}
            placeholder={t('escribeTuRespuesta')}
            className="field"
          />
        )}
      </fieldset>
    </div>
  );
}

/**
 * Entregar evidencia: un archivo o un enlace.
 *
 * **Los dos campos a la vez y no una pestana que elija.** Son dos situaciones
 * distintas y las dos ocurren: quien tiene la foto en el movil del aula sube, y
 * quien ya tiene el video en el Drive del centro pega el enlace. Obligar a
 * elegir primero anade un paso a lo unico que el alumno tiene que poder hacer.
 *
 * `type="file"` nativo y sin JavaScript: el navegador manda el fichero como
 * `multipart/form-data` y la Server Action lo sube al almacen desde el
 * servidor. Pedir la URL prefirmada desde el navegador -que es como se hace
 * normalmente- exigiria JavaScript justo para entregar.
 */
function EvidenceAnswer({
  question,
  t,
}: {
  question: StudentQuestion;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="grid gap-4">
      {/* La foto se reduce EN EL NAVEGADOR antes de salir del dispositivo: ver
          la nota de `EvidenceFileInput`. Un movil produce fotos de 12 MB y el
          limite del servicio son 12 MB, asi que sin esto una foto normal de
          telefono se rechaza. */}
      <EvidenceFileInput
        name={`archivo:${question.id}`}
        label={t('subirArchivo')}
        hint={t('pistaArchivo')}
      />

      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink-700">{t('oComparteEnlace')}</span>
        <input
          type="url"
          name={`enlace:${question.id}`}
          placeholder="https://"
          className="field"
        />
        <span className="text-xs text-ink-400">{t('pistaEnlace')}</span>
      </label>

      {/* Que es OPCIONAL se dice aquí y no en la ayuda: lo normal es que el
          docente lo revise en clase, y un alumno que crea obligatorio subir algo
          no entrega -o sube cualquier cosa para poder pulsar el botón-. */}
      <p className="text-xs text-ink-500">{t('evidenciaOpcional')}</p>
    </div>
  );
}

/**
 * Ordenar una secuencia, con un desplegable de posicion por paso.
 *
 * **No es arrastrar y soltar, y es a proposito.** Arrastrar exige JavaScript
 * -y este formulario tiene que poder entregarse sin el, que es media razon por
 * la que existe-, es practicamente imposible con un lector de pantalla, y en una
 * tableta de laboratorio con el dedo grueso de un nino de nueve anos falla mas
 * de lo que acierta. Un `<select>` nativo por paso resuelve las tres cosas: va
 * por teclado, lo anuncia el lector, y funciona con el formulario apagado.
 *
 * Los pasos se muestran en el orden en que vienen del servidor, que ya los trae
 * desordenados respecto de la clave.
 */
function OrderingAnswer({
  question,
  t,
}: {
  question: StudentQuestion;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="grid gap-2">
      {question.options.map((option) => (
        <div
          key={option.id}
          className="flex items-center gap-3 rounded-lg border border-line-200 px-4 py-3 text-sm text-ink-700"
        >
          <label className="shrink-0">
            {/* La etiqueta nombra el PASO y no "posicion 1": un lector de
                pantalla lee "Posicion de: fijar la base", que es lo que hace
                falta para responder sin ver la pantalla. */}
            <span className="sr-only">{t('posicionDe', { paso: option.text })}</span>
            <select
              name={`orden:${question.id}:${option.id}`}
              defaultValue=""
              className="field w-20"
            >
              <option value="">{t('sinPosicion')}</option>
              {question.options.map((_, position) => (
                <option key={position} value={position + 1}>
                  {position + 1}
                </option>
              ))}
            </select>
          </label>
          <span>{option.text}</span>
        </div>
      ))}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations('evaluacion');

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {/* Texto que cambia y no solo un spinner: un cambio de texto lo anuncia
            el lector de pantalla, un icono girando no. */}
        {pending ? t('entregando') : t('entregar')}
      </button>
      <p className="text-sm text-ink-500">{t('avisoEntrega')}</p>
    </div>
  );
}

/**
 * El resultado, en la misma pantalla.
 *
 * Lo de marcar ya está corregido cuando esto se pinta, y eso es lo que hace útil
 * un cuestionario para aprender: si la nota llegara tres días después, el alumno
 * ya no la conecta con lo que estaba pensando.
 *
 * Cuando queda parte por corregir a mano, **no se dice si aprobó**. Decirle que
 * suspendió con la mitad de los puntos sin puntuar sería mentirle.
 */
function Result({
  state,
  attemptsLeft,
  resultHref,
}: {
  state: SubmitState;
  attemptsLeft: number;
  resultHref: string;
}) {
  const percentage =
    state.score !== null && state.score !== undefined && state.maxScore
      ? Math.round((state.score / state.maxScore) * 100)
      : null;

  return (
    <div
      className="border border-line-200 bg-white text-center"
      style={{ borderRadius: 'var(--portal-radius)', padding: '2.5rem 1.5rem' }}
      role="status"
    >
      {state.awaitingManualGrading ? (
        <>
          <h2 className="font-display text-xl font-semibold">Entregado</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-500">
            Tu docente tiene que revisar algunas respuestas. Cuando termine verás
            tu nota completa en tu progreso.
          </p>
          {percentage !== null ? (
            <p className="mt-4 text-sm text-ink-700">
              De lo que se corrige solo llevas{' '}
              <strong className="tabular-nums">
                {state.score} de {state.maxScore}
              </strong>{' '}
              puntos.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="font-display text-4xl font-semibold tabular-nums text-brand-700">
            {percentage}%
          </p>
          <h2
            className="mt-2 font-display text-xl font-semibold"
            style={{ color: state.passed ? '#0A7D57' : '#A61B1B' }}
          >
            <span aria-hidden="true">● </span>
            {state.passed ? 'Aprobado' : 'No aprobado'}
          </h2>
          <p className="mt-2 text-sm text-ink-500">
            {state.score} de {state.maxScore} puntos
          </p>
          {!state.passed && attemptsLeft > 0 ? (
            <p className="mt-4 text-sm text-ink-700">
              Te quedan {attemptsLeft} {attemptsLeft === 1 ? 'intento' : 'intentos'}. Repasa y
              vuelve a intentarlo.
            </p>
          ) : null}
        </>
      )}

      {/* Al resultado, que es una pagina de verdad: esta tarjeta vive en el
          estado del formulario y desaparece al recargar. */}
      <a href={resultHref} className="btn btn-primary mt-6">
        Ver el detalle
      </a>
    </div>
  );
}

/**
 * Cronometro del intento.
 *
 * **Cuenta contra un instante que da el SERVIDOR, no contra minutos desde que
 * carga la pagina.** Contando desde la carga, recargar regalaria el tiempo
 * entero otra vez, y es lo primero que prueba cualquier alumno.
 *
 * Y sigue mandando el servidor: este numero es una ayuda para el alumno, no la
 * autoridad. Quien decide si llego tarde es el reloj del servidor al entregar,
 * porque el del navegador se cambia con la consola abierta en diez segundos.
 *
 * Al llegar a cero **entrega solo**. Antes no habia cronometro -a proposito,
 * para no meterle prisa a un nino con un numero rojo- pero eso dejaba el peor
 * final posible: seguir escribiendo tan tranquilo y perderlo todo con un error
 * al pulsar entregar. Un aviso que angustia un poco es mejor que perder el
 * examen entero.
 */
function Countdown({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const t = useTranslations('evaluacion');
  const target = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, target - Date.now()));
  const fired = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      const remaining = Math.max(0, target - Date.now());
      setLeft(remaining);

      // Una sola vez: sin la marca, el intervalo volveria a enviar el formulario
      // cada segundo mientras la accion esta en vuelo.
      if (remaining === 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [target, onExpire]);

  const totalSeconds = Math.floor(left / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  // El color entra tarde y por tramos. Un numero en rojo durante media hora deja
  // de significar nada, y a un nino de ocho anos le pone nervioso desde el
  // primer minuto.
  const tone =
    totalSeconds <= 60
      ? 'border-danger/40 bg-state-late-bg text-state-late-fg'
      : totalSeconds <= 300
        ? 'border-achievement/40 bg-state-warn-bg text-state-warn-fg'
        : 'border-line-200 bg-white text-ink-700';

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--portal-radius)] border px-4 py-3 text-sm ${tone}`}
      data-countdown={totalSeconds}
    >
      <span>
        {totalSeconds === 0 ? t('seAcaboElTiempo') : t('tiempoRestante')}
      </span>

      {totalSeconds > 0 ? (
        <strong className="font-display text-lg tabular-nums" aria-hidden="true">
          {minutes}:{String(seconds).padStart(2, '0')}
        </strong>
      ) : null}

      {/* El lector de pantalla NO oye cada segundo: seria insoportable. Solo se
          anuncia al entrar en los tramos, que es cuando cambia algo que importa. */}
      <span className="sr-only" role="status" aria-live="polite">
        {totalSeconds === 60
          ? t('quedaUnMinuto')
          : totalSeconds === 300
            ? t('quedanCincoMinutos')
            : totalSeconds === 0
              ? t('seAcaboElTiempo')
              : ''}
      </span>
    </div>
  );
}
