'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

type Theme = 'light' | 'dark' | 'system';

const KEY = 'glexco:theme';

/**
 * Interruptor de tema.
 *
 * Tres estados y no dos: **"como el sistema" es el valor por defecto y tiene que
 * poder recuperarse.** Con solo claro/oscuro, quien pulsa una vez queda anclado
 * para siempre a esa eleccion y su portatil deja de cambiar solo al anochecer.
 *
 * La preferencia se guarda en `localStorage` y no en el servidor a proposito: es
 * de este dispositivo. Un alumno que usa el ordenador del laboratorio por la
 * manana y el movil por la tarde no quiere que su eleccion viaje entre los dos,
 * porque las condiciones de luz no son las mismas.
 *
 * El estado inicial se lee en un efecto y no al construir: en el servidor no hay
 * `localStorage`, y leerlo durante el renderizado produce una discrepancia de
 * hidratacion. El destello lo evita el guion en linea del layout, que corre
 * antes de pintar.
 */
export function ThemeToggle() {
  const t = useTranslations('tema');
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // Navegador con el almacenamiento bloqueado -pasa en algunos equipos de
      // colegio-. Se queda en "sistema", que es un valor perfectamente valido.
    }
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    const root = document.documentElement;

    if (next === 'system') {
      root.removeAttribute('data-theme');
      root.style.colorScheme = '';
    } else {
      root.setAttribute('data-theme', next);
      // `color-scheme` es lo que hace que los controles nativos y la barra de
      // desplazamiento del navegador cambien tambien. Sin esto queda una barra
      // blanca al lado de una pagina oscura.
      root.style.colorScheme = next;
    }

    try {
      if (next === 'system') window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // Sin persistencia el tema vale para esta pagina y se pierde al recargar.
      // Es peor que guardarlo, pero mucho mejor que no poder cambiarlo.
    }
  }

  const options: Array<{ value: Theme; label: string }> = [
    { value: 'light', label: t('claro') },
    { value: 'dark', label: t('oscuro') },
    { value: 'system', label: t('sistema') },
  ];

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Tema de la interfaz</legend>
      <div className="flex gap-1 rounded-[var(--nav-radius)] bg-white/[0.09] p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => apply(option.value)}
            aria-pressed={theme === option.value}
            className={`flex-1 rounded-[calc(var(--nav-radius)*0.75)] px-2 py-1.5 text-[11px] font-medium transition ${
              theme === option.value
                ? 'bg-white/[0.18] text-white'
                : 'text-onbrand-300 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
