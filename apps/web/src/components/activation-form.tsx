'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { redeemActivationCode, type ActivationState } from '../lib/activation.actions';

/**
 * Activacion de un codigo por un alumno que ya tiene cuenta.
 *
 * Compartido por Discover y Academy: es la misma operacion y el mismo backend, y
 * la densidad la fija el layout con `data-portal`. Duplicarlo "por si el de
 * primaria necesita otra cosa" acaba en dos formularios que se separan sin que
 * nadie lo decida.
 *
 * Funciona sin JavaScript, como el resto de formularios del portal.
 */
export function ActivationForm({ portal }: { portal: 'discover' | 'academy' }) {
  const [state, formAction] = useActionState<ActivationState, FormData>(redeemActivationCode, {});

  if (state.kitName) {
    return (
      <div
        role="status"
        data-activation={state.alreadyMine ? 'repeated' : 'done'}
        className="rounded-lg border border-line-200 bg-white px-4 py-4"
      >
        <p className="font-display text-lg font-semibold">
          {state.alreadyMine ? 'Ese código ya era tuyo' : '¡Kit desbloqueado!'}
        </p>
        <p className="mt-1 text-sm text-ink-700">
          {state.alreadyMine
            ? `Ya tenías activado ${state.kitName}. No se gastó ningún código nuevo.`
            : `Ya puedes entrar a ${state.kitName}.`}
        </p>
        <a
          href={`/${portal}`}
          className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          Ver mis kits
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-md space-y-4" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="activationCode" className="block text-sm font-medium text-ink-700">
          Código de tu libro
        </label>
        <p id="codigo-ayuda" className="mt-1 text-sm text-ink-500">
          Está impreso dentro de tu libro y empieza por GLX. Puedes escribirlo con o sin guiones.
        </p>
        <input
          id="activationCode"
          name="activationCode"
          required
          autoComplete="off"
          aria-describedby={state.error ? undefined : 'codigo-ayuda'}
          aria-invalid={state.error ? true : undefined}
          placeholder="GLX-XXXX-XXXX-XXXX"
          className="mt-1.5 w-full rounded-lg border border-line-300 bg-white px-3 py-2.5 uppercase tracking-wider text-ink-900 outline-none transition focus:border-brand-400"
        />
      </div>

      {/* El aviso va ANTES del boton, no despues: un codigo de un solo uso es
          irreversible, y una advertencia que aparece bajo el boton se lee cuando
          ya se ha pulsado. */}
      <p className="text-sm text-ink-500">
        Cada código sirve una sola vez y queda unido a tu cuenta.
      </p>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      // Ancla estable para las comprobaciones del portal: el texto del boton es
      // un JSX interpolado y React lo parte con separadores de comentario en el
      // HTML servido, asi que buscarlo por su texto falla aunque la pantalla
      // este bien.
      data-submit="activar"
      className="rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? 'Activando…' : 'Activar mi código'}
    </button>
  );
}
