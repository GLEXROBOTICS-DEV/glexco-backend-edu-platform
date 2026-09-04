import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { getSession } from '../lib/session';

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Cookie del idioma elegido SIN sesion: la pantalla de ingreso y el alta. */
export const LOCALE_COOKIE = 'glexco_locale';

/**
 * De donde sale el idioma.
 *
 * **Del perfil del usuario, no de la URL.** Es la diferencia con el montaje por
 * defecto de next-intl, que antepone `/es/` y `/en/` a todas las rutas. Aqui el
 * idioma ya es un atributo del usuario en el servicio de identidad -viaja con su
 * perfil y lo usan los correos-, asi que sacarlo tambien de la ruta daria dos
 * fuentes para el mismo dato: un alumno con `en` en su perfil que abriera un
 * enlace `/es/` veria la interfaz en un idioma y sus correos en otro.
 *
 * Y duplicaria cada URL de la plataforma, rompiendo los enlaces ya repartidos en
 * los libros y en los correos ya enviados.
 *
 * Sin sesion manda la cookie, que es lo que fija el selector de la pantalla de
 * ingreso; y sin cookie, el espanol.
 */
export async function resolveLocale(): Promise<Locale> {
  const session = await getSession();
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;

  // **La cookie gana si el perfil no se pudo leer.** Con sesion degradada -
  // identidad sin responder un instante- el idioma de la sesion sale del TOKEN,
  // que es el de cuando inicio sesion y no el que el usuario acaba de elegir.
  // Sin esto, cambiar a ingles se deshacia solo en la siguiente navegacion.
  //
  // Cuando el perfil SI contesta manda el perfil, que es lo correcto: es el
  // idioma con el que se le escriben los correos, y una cookie vieja en otro
  // navegador no debe cambiarlo.
  if (session && !session.profileLoaded && (cookieLocale === 'en' || cookieLocale === 'es')) {
    return cookieLocale;
  }

  if (session?.locale === 'en' || session?.locale === 'es') return session.locale;

  return cookieLocale === 'en' ? 'en' : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Zona horaria fija y no la del servidor: en Railway el contenedor va en UTC,
    // asi que una fecha formateada en el servidor saldria cinco horas movida para
    // quien la lee en Lima. Es el mismo motivo por el que las fechas escritas a
    // mano en este portal ya llevan su `timeZone` explicito.
    timeZone: 'America/Lima',
  };
});
