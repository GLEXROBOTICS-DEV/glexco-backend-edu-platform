import { getLocale, getTranslations } from 'next-intl/server';
import { setLocale } from '../lib/locale.actions';

/**
 * Selector de idioma de las pantallas publicas.
 *
 * Es un `<form>` con acción de servidor y no un desplegable con JavaScript:
 * **funciona sin JavaScript**, como el resto de los formularios del portal, y
 * ademas deja la eleccion escrita en una cookie antes de pintar nada, sin el
 * parpadeo de cambiar de idioma despues de cargar.
 *
 * Solo aparece donde no hay sesion. Con sesion manda el idioma del PERFIL: es el
 * mismo que usan los correos, y tener dos fuentes acabaria con la interfaz en un
 * idioma y los avisos en otro.
 */
export async function LocaleSwitch() {
  const current = await getLocale();
  const t = await getTranslations('idioma');

  return (
    <form action={setLocale} className="flex items-center gap-1">
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">{t('leyenda')}</legend>

        {(['es', 'en'] as const).map((code) => (
          <button
            key={code}
            type="submit"
            name="locale"
            value={code}
            aria-current={current === code ? 'true' : undefined}
            className={`rounded-[var(--nav-radius)] px-3 py-1.5 text-[13px] font-medium transition ${
              current === code
                ? 'border border-brand-600 bg-white text-brand-600'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {t(code)}
          </button>
        ))}
      </fieldset>
    </form>
  );
}
