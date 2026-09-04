'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

/**
 * Acciones de la pantalla "Mi cuenta".
 *
 * Todas exigen sesion y el alcance lo decide el token en el backend: ninguna
 * acepta un `userId`. Aceptarlo convertiria "cerrar sesion" en una forma de
 * expulsar a cualquier alumno de la plataforma conociendo su identificador.
 */

export interface PasswordState {
  error?: string;
  done?: boolean;
}

/**
 * Cambia la contrasena estando dentro.
 *
 * Exige la ACTUAL aunque ya haya sesion iniciada. Sin ese requisito, un
 * portatil escolar que alguien dejo abierto basta para quedarse con la cuenta:
 * el atacante la cambia, y el dueno pierde el acceso sin saber por que.
 */
export async function changePassword(
  _previous: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  // SIN recortar. `trim()` sobre una contrasena la altera en silencio: se
  // guardaria "abc" cuando el usuario escribio " abc ", y al ingresar -donde no
  // se recorta nada- no coincidiria nunca.
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const repeat = String(formData.get('repeatPassword') ?? '');

  if (!currentPassword || !newPassword) {
    return { error: 'Escribe tu contraseña actual y la nueva.' };
  }

  // Se comprueba aqui ANTES de llamar: el backend no puede detectarlo -solo
  // recibe una contrasena- y sin esto un error de tecleo se guarda como
  // contrasena buena y deja al usuario fuera de su cuenta.
  if (newPassword !== repeat) {
    return { error: 'Las dos contraseñas nuevas no coinciden.' };
  }

  if (newPassword === currentPassword) {
    return { error: 'La contraseña nueva tiene que ser distinta de la actual.' };
  }

  const result = await api('/account/password', {
    method: 'POST',
    body: {
      currentPassword,
      newPassword,
      // Se mantiene la sesion desde la que se cambia y se cierran las demas.
      // Es lo que espera quien cambia la contrasena porque sospecha de alguien:
      // echar al intruso sin echarse a si mismo.
      keepCurrentSession: true,
    },
  });

  if (!result.ok) {
    if (result.error.code === 'INVALID_CREDENTIALS' || result.status === 401) {
      return { error: 'Tu contraseña actual no es correcta.' };
    }
    if (result.error.code === 'WEAK_PASSWORD' || result.status === 422) {
      return {
        error:
          'La contraseña nueva es demasiado débil. Usa al menos 10 caracteres, con letras y números.',
      };
    }
    return { error: 'No pudimos cambiar tu contraseña. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath('/');
  return { done: true };
}

export interface SessionsState {
  error?: string;
  revoked?: number;
}

/**
 * Cierra las demas sesiones, o una concreta.
 *
 * Ahora surte efecto de inmediato tambien para docentes: su sesion pasa a ser
 * critica y por tanto consulta la lista de revocacion en cada peticion. Antes
 * podia tardar hasta quince minutos, que es lo que dura el token de acceso.
 */
export async function revokeSessions(
  _previous: SessionsState,
  formData: FormData,
): Promise<SessionsState> {
  const sessionId = String(formData.get('sessionId') ?? '').trim();

  const result = await api<{ revoked: number }>('/account/sessions', {
    method: 'DELETE',
    body: sessionId ? { sessionId } : {},
  });

  if (!result.ok) {
    return { error: 'No pudimos cerrar la sesión. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath('/');
  return { revoked: result.data?.revoked ?? 0 };
}

export interface LanguageState {
  error?: string;
  done?: boolean;
}

/**
 * Cambia el idioma de la CUENTA.
 *
 * Escribe en el perfil y no en una cookie, al reves que el selector de la
 * pantalla de ingreso. La diferencia importa: el idioma del perfil es el que
 * deciden los correos -verificacion, recuperacion, avisos-, asi que con cookie
 * un alumno lo pondria en ingles y seguiria recibiendolos en espanol sin
 * entender por que.
 */
export async function changeLanguage(
  _previous: LanguageState,
  formData: FormData,
): Promise<LanguageState> {
  const locale = String(formData.get('locale') ?? '');
  if (locale !== 'es' && locale !== 'en') {
    return { error: 'Ese idioma no está disponible.' };
  }

  const result = await api('/account/locale', { method: 'POST', body: { locale } });

  if (!result.ok) {
    return { error: 'No pudimos cambiar tu idioma. Vuelve a intentarlo en un momento.' };
  }

  // El idioma sale de la sesion, que se relee en cada peticion: hay que
  // revalidar el layout entero o la barra lateral se queda en el idioma viejo
  // hasta la siguiente navegacion completa.
  revalidatePath('/', 'layout');
  return { done: true };
}
