'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from '../../lib/auth.actions';

/**
 * Formulario de ingreso.
 *
 * Es el unico componente de cliente de esta pantalla. Todo lo demas se renderiza
 * en el servidor: el contenido educativo es estatico por usuario y los equipos
 * escolares son modestos, asi que cuanto menos JavaScript llegue, mejor.
 *
 * Funciona **sin JavaScript**. `useActionState` sobre un `<form action>` degrada
 * a un envio normal del navegador: en un laboratorio con equipos viejos o una
 * conexion que corta el bundle a mitad, el alumno sigue pudiendo entrar.
 */
export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      {state.error ? (
        // `role="alert"` para que el lector de pantalla lo anuncie al aparecer.
        // Sin esto, un usuario ciego rellena el formulario, pulsa, y no recibe
        // ninguna senal de que algo fue mal.
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Field
        label="Correo"
        name="email"
        type="email"
        autoComplete="username"
        errors={state.fieldErrors?.['email']}
      />

      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        errors={state.fieldErrors?.['password']}
      />

      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          name="rememberMe"
          className="size-4 rounded border-line-300 text-brand-600"
        />
        Recordarme en este equipo
      </label>

      <SubmitButton />

      <p className="text-center text-sm text-ink-500">
        <a href="/recuperar" className="font-medium text-brand-600 hover:underline">
          Olvidé mi contraseña
        </a>
      </p>

      {/* El alta se ofrece aqui y no solo en una esquina: hasta ahora un alumno
          nuevo no tenia forma de entrar sin que alguien de GLEXCO le creara la
          cuenta por API, y esta es la puerta. */}
      <p className="border-t border-line-200 pt-5 text-center text-sm text-ink-500">
        ¿Primera vez?{' '}
        <a href="/registro" className="font-medium text-brand-600 hover:underline">
          Activa el código de tu libro
        </a>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  errors,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  errors?: string[];
}) {
  const errorId = `${name}-error`;

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        // `aria-describedby` enlaza el error con el campo: sin el, el lector de
        // pantalla lee el mensaje suelto y no sabe a que campo pertenece.
        aria-describedby={errors?.length ? errorId : undefined}
        aria-invalid={errors?.length ? true : undefined}
        className="field mt-1.5"
      />
      {errors?.length ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary btn-block"
    >
      {/* El texto cambia en vez de mostrar solo un spinner: un cambio de texto
          si lo anuncia el lector de pantalla, y un icono girando no. */}
      {pending ? 'Ingresando…' : 'Ingresar'}
    </button>
  );
}
