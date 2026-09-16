'use server';

import { getTranslations } from 'next-intl/server';

import { redirect } from 'next/navigation';
import { gatewayUrl } from './api';

/**
 * Acciones de cuenta que se hacen SIN sesion: confirmar el correo, pedir la
 * recuperacion y elegir una contrasena nueva.
 *
 * Las tres viven aqui y no en `auth.actions.ts` porque aquel establece sesion y
 * estas no. Mezclarlas obligaria a razonar en cada funcion sobre si toca cookies
 * o no, que es como se acaba escribiendo una que las deja a medias.
 */

export interface RecoveryState {
  error?: string;
  /** `true` cuando la peticion se acepto. NO significa que el correo exista. */
  submitted?: boolean;
}

/**
 * Pide el correo de recuperacion.
 *
 * **Responde igual exista o no la cuenta.** El backend ya se cuida de eso y aqui
 * no se deshace: una pantalla que dijera "no hay ninguna cuenta con ese correo"
 * convierte este formulario en un comprobador de quien esta registrado en la
 * plataforma, y son menores de edad.
 */
export async function requestPasswordReset(
  _previous: RecoveryState,
  formData: FormData,
): Promise<RecoveryState> {
  const t = await getTranslations('errores');
  const email = String(formData.get('email') ?? '').trim();

  if (!email.includes('@')) {
    return { error: t('correoInvalido') };
  }

  const response = await fetch(`${gatewayUrl}/api/v1/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, locale: 'es' }),
    cache: 'no-store',
  });

  // El 429 SI se distingue, y es correcto: no filtra existencia porque el limite
  // se cuenta por correo solicitado, exista o no. Ocultarlo dejaria al usuario
  // pulsando un boton que no hace nada.
  if (response.status === 429) {
    return { error: t('demasiadosCorreos') };
  }

  if (!response.ok && response.status !== 202) {
    return { error: t('noPudimosProcesar') };
  }

  return { submitted: true };
}

export interface NewPasswordState {
  error?: string;
}

export async function confirmPasswordReset(
  _previous: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const t = await getTranslations('errores');
  const token = String(formData.get('token') ?? '');
  // Sin recortar: recortar una contrasena la altera en silencio y despues no
  // coincide al ingresar, donde no se recorta nada.
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('passwordConfirm') ?? '');

  if (!token) {
    return { error: t('enlaceInvalido') };
  }
  if (password !== confirmation) {
    return { error: t('clavesNoCoinciden') };
  }
  if (password.length < 8) {
    return { error: t('claveCorta') };
  }

  const response = await fetch(`${gatewayUrl}/api/v1/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return {
      error:
        body?.message ??
        t('enlaceGastado'),
    };
  }

  // NO se inicia sesion automaticamente, al contrario que en el registro. Un
  // restablecimiento suele hacerse porque alguien pudo tomar la cuenta: la
  // contrasena nueva es lo unico que demuestra quien es, y hay que teclearla.
  // Ademas el backend acaba de revocar TODAS las sesiones, incluida la del
  // atacante, y entrar aqui sin credenciales contradiria esa decision.
  redirect('/ingresar?restablecida=1');
}
