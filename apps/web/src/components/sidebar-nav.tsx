'use client';

import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  /**
   * El icono YA CREADO (`<HomeIcon />`), no el componente.
   *
   * No es un detalle de estilo: por la frontera servidor-cliente pasan datos y
   * elementos, pero NO funciones. Pasar `Icon: HomeIcon` compila, pasa la
   * comprobacion de tipos y revienta en ejecucion con "Functions cannot be
   * passed directly to Client Components", dejando la pantalla entera en blanco.
   */
  icon: React.ReactNode;
  /** Coincidencia exacta. Para "Inicio", que si no se marca en todas. */
  exact?: boolean;
}

/**
 * Navegacion de la barra lateral.
 *
 * Es lo unico del marco que es componente de cliente, y solo por una razon:
 * marcar donde estas necesita la ruta actual, y en el App Router eso vive en
 * `usePathname`. Se renderiza igualmente en el servidor, asi que la marca de
 * seccion activa ya viene en el HTML: sin JavaScript se pierde el resaltado, no
 * la navegacion, porque debajo hay enlaces normales.
 *
 * Alternativa descartada: pasar la seccion activa desde cada pagina. Son mas de
 * veinte pantallas y la que se olvidara de pasarla se quedaria sin resaltar sin
 * que nadie lo notase.
 */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones" className="min-w-0">
      <ul className="flex gap-1 overflow-x-auto border-b border-line-200 bg-white px-3 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        {items.map(({ href, label, icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={href} className="shrink-0 lg:shrink">
              <a
                href={href}
                // `aria-current` es lo que anuncia "estas aqui" a un lector de
                // pantalla. El color y el fondo no los ve, y sin esto la barra
                // le suena a seis enlaces indistinguibles.
                aria-current={active ? 'page' : undefined}
                data-active={active ? '' : undefined}
                className={[
                  'flex items-center gap-2 rounded-[var(--nav-radius)] px-3 text-[length:var(--nav-size)] transition',
                  'h-9 lg:h-[var(--nav-height)] lg:gap-3',
                  active
                    ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-fg)] max-lg:bg-surface-200 max-lg:text-brand-700'
                    : 'text-ink-700 hover:bg-surface-200 lg:text-[var(--sidebar-idle)] lg:hover:bg-white/10 lg:hover:text-white',
                ].join(' ')}
              >
                {/* El tamano del icono lo pone la variable del portal, y se
                    aplica aqui y no en cada definicion: son cuatro barras y
                    veinte destinos, y uno con otra medida se ve al instante. */}
                <span
                  className="grid size-[var(--nav-icon)] shrink-0 place-items-center [&>svg]:size-full"
                  aria-hidden="true"
                >
                  {icon}
                </span>
                <span className="whitespace-nowrap">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
