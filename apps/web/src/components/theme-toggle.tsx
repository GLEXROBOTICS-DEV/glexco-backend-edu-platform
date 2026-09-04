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
      <legend className="sr-only">{t('leyenda')}</legend>

      {/* Los MISMOS controles que el selector de idioma, que esta justo encima.
          No es solo coherencia: este selector vivia en la barra lateral de marca
          y estaba pintado para ella -`text-white` sobre un fondo oscuro-. Al
          moverlo al perfil quedo texto casi blanco sobre una tarjeta blanca, y
          en modo claro no se leia ninguna de las tres opciones. Lo reporto el
          cliente con una captura.

          Con `.btn` hereda la altura, el radio y el foco de todo el resto de la
          plataforma, y el activo se distingue por RELLENO y no solo por un
          matiz: `aria-pressed` lo dice para quien no ve el color. */}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => apply(option.value)}
            aria-pressed={theme === option.value}
            className={`btn btn-sm ${theme === option.value ? 'btn-primary' : 'btn-secondary'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
