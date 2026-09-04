'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { LOCALE_COOKIE, type Locale } from '../i18n/request';

/**
 * Cambia el idioma de la interfaz.
 *
 * Escribe una cookie y NO toca el perfil del usuario. La distincion importa: el
 * idioma del perfil es el que decide en que lengua se le escriben los correos, y
 * eso lo cambia el propio usuario desde su cuenta, no un selector que alguien
 * pulsa en el ordenador del laboratorio para leer una pantalla.
 *
 * Con sesion iniciada manda el perfil, asi que este selector solo tiene efecto
 * en las pantallas publicas -ingreso, alta, recuperacion y verificacion de
 * certificados-, que es justo donde no hay perfil del que tirar.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const raw = String(formData.get('locale') ?? '');
  const locale: Locale = raw === 'en' ? 'en' : 'es';

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    // No es `httpOnly`: no hay nada sensible en saber en que idioma lee alguien,
    // y dejarla legible permite que el cliente la respete sin otra peticion.
    httpOnly: false,
  });

  revalidatePath('/', 'layout');
}
