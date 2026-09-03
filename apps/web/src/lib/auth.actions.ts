'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginSchema } from '@glexco/contracts';
import { gatewayUrl } from './api';
import { portalPath } from './portal';
import { establishSession, type AuthResponse } from './session-cookies';
import { SESSION_COOKIES } from './session';

/**
 * Inicio de sesion.
 *
 * Es una Server Action y no una llamada desde el navegador por una razon
 * concreta: la respuesta trae el access token, y en el servidor puede guardarse
 * en una cookie `httpOnly` que el JavaScript de la pagina no puede leer. Hecho
 * desde el cliente, el token pasaria por `window` y cualquier script inyectado
 * podria llevarselo.
 */

export interface LoginState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    rememberMe: formData.get('rememberMe') === 'on',
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }

  const response = await fetch(`${gatewayUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    // El mensaje viene del backend, que ya se cuida de no distinguir "no existe"
    // de "contrasena incorrecta": esa diferencia permitiria enumerar cuentas.
    return { error: body?.message ?? 'No se pudo iniciar sesion.' };
  }

  const body = (await response.json()) as AuthResponse;
  await establishSession(body, response.headers.getSetCookie?.() ?? []);

  redirect(portalPath(body.user.portal));
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const refresh = store.get(SESSION_COOKIES.refresh)?.value;

  // Se avisa al backend para que revoque la sesion en Redis. Borrar solo las
  // cookies dejaria el refresh token vivo hasta su caducidad: si alguien lo
  // capturo antes, cerrar sesion no le habria quitado nada.
  if (refresh) {
    await fetch(`${gatewayUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIES.refresh}=${refresh}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }

  store.delete(SESSION_COOKIES.access);
  store.delete(SESSION_COOKIES.refresh);
  redirect('/ingresar');
}
