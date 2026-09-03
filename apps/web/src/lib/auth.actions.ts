'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginSchema } from '@glexco/contracts';
import { gatewayUrl } from './api';
import { portalPath } from './portal';
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

interface LoginResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    userId: string;
    portal: 'discover' | 'academy' | 'teacher' | 'institution' | 'admin';
  };
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

  const body = (await response.json()) as LoginResponse;
  const store = await cookies();

  // El refresh viene en cookie del propio backend; hay que reenviarla al
  // navegador desde aqui porque la peticion la hizo el servidor de Next, no el
  // navegador, y su `Set-Cookie` moriria en este proceso.
  const refresh = extractRefreshCookie(response.headers.getSetCookie?.() ?? []);

  const secure = process.env.NODE_ENV === 'production';

  store.set(SESSION_COOKIES.access, body.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: body.expiresInSeconds,
  });

  if (refresh) {
    store.set(SESSION_COOKIES.refresh, refresh.value, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      // Solo se envia a la ruta que la usa. Una cookie de refresco viajando en
      // cada peticion de imagen es superficie de exposicion gratuita.
      path: '/',
      ...(refresh.maxAge ? { maxAge: refresh.maxAge } : {}),
    });
  }

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

function extractRefreshCookie(
  setCookies: string[],
): { value: string; maxAge?: number } | null {
  for (const raw of setCookies) {
    if (!raw.startsWith(`${SESSION_COOKIES.refresh}=`)) continue;

    const [pair, ...attributes] = raw.split(';');
    const value = pair?.slice(SESSION_COOKIES.refresh.length + 1) ?? '';
    const maxAgeAttr = attributes
      .map((attribute) => attribute.trim().toLowerCase())
      .find((attribute) => attribute.startsWith('max-age='));

    const maxAge = maxAgeAttr ? Number.parseInt(maxAgeAttr.slice(8), 10) : undefined;
    return maxAge && Number.isFinite(maxAge) ? { value, maxAge } : { value };
  }
  return null;
}
