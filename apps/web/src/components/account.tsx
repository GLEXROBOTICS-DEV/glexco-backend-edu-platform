'use client';

import { useActionState } from 'react';
import {
  changePassword,
  revokeSessions,
  type PasswordState,
  type SessionsState,
} from '../lib/profile.actions';
import type { ActiveSession } from '../lib/profile';

/**
 * Cambio de contrasena.
 *
 * Cliente por el mensaje de error, que tiene que aparecer sin recargar. El
 * formulario es un `<form action>` normal, asi que **funciona sin JavaScript**:
 * sin el se pierde el mensaje en linea, no la capacidad de cambiarla.
 */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState<PasswordState, FormData>(
    changePassword,
    {},
  );

  return (
    <form action={formAction} className="grid max-w-md gap-4">
      {state.done ? (
        <p
          role="status"
          data-password-changed="1"
          className="rounded-[var(--portal-radius)] border border-state-done-fg/25 bg-state-done-bg px-4 py-3 text-sm text-state-done-fg"
        >
          Listo. Tu contraseña ya está cambiada y se cerraron tus otras sesiones.
        </p>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-[var(--portal-radius)] border border-danger/25 bg-state-late-bg px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Contraseña actual</span>
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          className="field mt-1.5"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Contraseña nueva</span>
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          className="field mt-1.5"
        />
        <span className="mt-1.5 block text-xs text-ink-500">
          Al menos 10 caracteres. Mezcla letras y números.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink-700">Repite la nueva</span>
        <input
          type="password"
          name="repeatPassword"
          autoComplete="new-password"
          required
          className="field mt-1.5"
        />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary justify-self-start">
        {pending ? 'Cambiando…' : 'Cambiar contraseña'}
      </button>
    </form>
  );
}

/**
 * Sesiones abiertas.
 *
 * La sesion actual se marca y **no se puede cerrar desde aqui**: quien pulsa
 * "cerrar" en su propia fila espera echar a otro, no echarse a si mismo, y el
 * boton de salir ya esta en la barra lateral.
 */
export function SessionList({ sessions }: { sessions: readonly ActiveSession[] }) {
  const [state, formAction, pending] = useActionState<SessionsState, FormData>(
    revokeSessions,
    {},
  );

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="grid gap-4">
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.revoked !== undefined && !state.error ? (
        <p role="status" className="text-sm text-state-done-fg">
          {state.revoked === 0
            ? 'No había ninguna otra sesión abierta.'
            : `Se cerraron ${state.revoked} ${state.revoked === 1 ? 'sesión' : 'sesiones'}.`}
        </p>
      ) : null}

      <ul className="grid gap-2" data-sessions={sessions.length}>
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--portal-radius)] border border-line-200 bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {session.device}
                {session.current ? (
                  <span className="ml-2 rounded-full bg-state-doing-bg px-2 py-0.5 text-[11px] font-semibold text-state-doing-fg">
                    este dispositivo
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                Última actividad {relative(session.lastUsedAt)}
                {session.ipAddress ? ` · ${session.ipAddress}` : ''}
              </p>
            </div>

            {!session.current ? (
              <form action={formAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <button type="submit" disabled={pending} className="btn btn-sm btn-secondary">
                  Cerrar
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {others > 0 ? (
        <form action={formAction} className="justify-self-start">
          <button type="submit" disabled={pending} className="btn btn-danger">
            {pending ? 'Cerrando…' : 'Cerrar todas las demás'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * "hace 5 minutos".
 *
 * En el cliente y no en el servidor: la hora que importa es la del dispositivo
 * que esta mirando, y calcularla en el servidor mostraria "hace 5 horas" a quien
 * acaba de entrar desde otra zona horaria.
 */
function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'hace un momento';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 2) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} minutos`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;

  const days = Math.round(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}
