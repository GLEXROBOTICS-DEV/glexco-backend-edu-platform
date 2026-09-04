'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  confirmPasswordReset,
  requestPasswordReset,
  type NewPasswordState,
  type RecoveryState,
} from '../../lib/account.actions';

/**
 * Formularios de recuperacion de contrasena.
 *
 * Los dos funcionan **sin JavaScript**, como el resto del portal: quien ha
 * perdido el acceso a su cuenta es justo a quien no se le puede pedir ademas que
 * su navegador cargue bien un bundle.
 */

export function RequestForm() {
  const [state, formAction] = useActionState<RecoveryState, FormData>(requestPasswordReset, {});

  // El acuse de recibo NO dice si la cuenta existe. Es deliberado: decirlo
  // convertiria este formulario en un comprobador de quien esta registrado en la
  // plataforma, y son menores de edad. El texto se redacta para que sea util
  // igualmente: dice que hacer si no llega.
  if (state.submitted) {
    return (
      <div role="status" data-recovery="sent" className="mt-8">
        <p className="rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700">
          Si ese correo tiene una cuenta, le acabamos de enviar un enlace para cambiar la
          contraseña. Revisa también la carpeta de correo no deseado.
        </p>
        <p className="mt-4 text-sm text-ink-500">
          El enlace vale una hora. Si no llega en unos minutos, comprueba que escribiste bien el
          correo y vuelve a intentarlo.
        </p>
        <a href="/ingresar" className="mt-6 inline-block text-sm font-medium text-brand-600 hover:underline">
          ← Volver a ingresar
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink-700">
          Tu correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="field mt-1.5"
        />
      </div>

      <Submit idle="Enviarme el enlace" busy="Enviando…" />

      <p className="text-center text-sm text-ink-500">
        <a href="/ingresar" className="font-medium text-brand-600 hover:underline">
          Volver a ingresar
        </a>
      </p>
    </form>
  );
}

export function NewPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<NewPasswordState, FormData>(confirmPasswordReset, {});

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      {/* El token viaja en un campo oculto y no en la URL del envio: asi no
          queda en el historial del navegador ni en el registro de accesos de
          ningun intermediario cuando se envia el formulario. */}
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink-700">
          Contraseña nueva
        </label>
        <p id="password-hint" className="mt-1 text-sm text-ink-500">
          Al menos 8 caracteres. Elige algo que recuerdes y que nadie más sepa.
        </p>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="password-hint"
          className="field mt-1.5"
        />
      </div>

      <div>
        <label htmlFor="passwordConfirm" className="block text-sm font-medium text-ink-700">
          Repite la contraseña
        </label>
        <input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          className="field mt-1.5"
        />
      </div>

      {/* Se avisa ANTES de enviar, no despues: cambiar la contrasena cierra la
          sesion en todos los equipos, y descubrirlo al volver al aula con la
          tableta desconectada se lee como un fallo de la plataforma. */}
      <p className="text-sm text-ink-500">
        Al cambiarla se cerrará tu sesión en todos los equipos.
      </p>

      <Submit idle="Guardar mi contraseña nueva" busy="Guardando…" />
    </form>
  );
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-submit="recuperar"
      className="btn btn-primary btn-block"
    >
      {pending ? busy : idle}
    </button>
  );
}
