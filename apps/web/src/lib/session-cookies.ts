import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIES } from './session';

/**
 * Traslado de la sesion del backend a las cookies del navegador.
 *
 * Vive aparte de `auth.actions.ts` por dos razones. La primera es tecnica: un
 * modulo `'use server'` solo puede exportar funciones asincronas, asi que los
 * ayudantes sincronos no caben alli. La segunda importa mas: ingresar y
 * registrarse terminan exactamente igual -una sesion recien creada que hay que
 * dejar en cookies `httpOnly`-, y tener esa logica escrita dos veces es como se
 * consigue que una de las dos copias se quede sin el `httpOnly`.
 */

export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    userId: string;
    portal: 'discover' | 'academy' | 'teacher' | 'institution' | 'admin';
  };
}

/**
 * Guarda access y refresh tras un login correcto.
 *
 * El refresh llega en un `Set-Cookie` del backend, pero la peticion la hizo el
 * servidor de Next y no el navegador: esa cabecera muere en este proceso si no
 * se reenvia a mano.
 */
export async function establishSession(body: AuthResponse, setCookies: string[]): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === 'production';

  store.set(SESSION_COOKIES.access, body.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: body.expiresInSeconds,
  });

  const refresh = extractRefreshCookie(setCookies);
  if (refresh) {
    store.set(SESSION_COOKIES.refresh, refresh.value, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      ...(refresh.maxAge ? { maxAge: refresh.maxAge } : {}),
    });
  }
}

export function extractRefreshCookie(
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
