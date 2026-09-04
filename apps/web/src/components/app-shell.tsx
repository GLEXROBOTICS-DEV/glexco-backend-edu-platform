import type { SessionUser } from '../lib/session';
import { SidebarNav, type NavItem } from './sidebar-nav';

export type { NavItem };

/**
 * Marco de aplicacion de los cuatro portales.
 *
 * Es la pieza del canvas que estaba sin construir: barra lateral de marca a la
 * izquierda y contenido a la derecha. No es una preferencia estetica. Con la
 * navegacion arriba, los destinos compiten por el ancho y hay que recortarlos o
 * esconderlos en un menu en cuanto pasan de cinco; en vertical caben los ocho
 * del panel de administracion sin abreviar ninguno, que es exactamente el caso
 * que la barra superior no aguantaba.
 *
 * El azul de marca ocupando una columna entera tambien hace un trabajo que el
 * texto no puede: quien tiene varios accesos sabe de un vistazo, por el color
 * del lateral, si esta mirando su colegio o toda la plataforma.
 *
 * En movil se pliega a una cabecera con la navegacion en horizontal. No es un
 * menu desplegable a proposito: esconder el destino principal detras de un toque
 * extra penaliza a quien entra desde el movil, que aqui son casi todas las
 * familias.
 */
export function AppShell({
  portal,
  label,
  homeHref,
  accountHref,
  items,
  session,
  subtitle,
  onLogout,
  children,
}: {
  /** Fija densidad, acento y color de la barra. Ver `globals.css`. */
  portal: 'discover' | 'academy' | 'teacher' | 'admin';
  /** Nombre del portal bajo la marca: Discover, Academy, Teacher Center, Admin. */
  label: string;
  homeHref: string;
  /** Ficha de usuario -> "Mi cuenta". Sin esto la ficha es decorativa. */
  accountHref: string;
  items: readonly NavItem[];
  session: SessionUser;
  /** Segunda linea de la ficha de usuario. Su rol, no un dato inventado. */
  subtitle: string;
  onLogout: () => Promise<void>;
  children: React.ReactNode;
}) {
  const initials =
    `${session.firstName.charAt(0)}${session.lastName.charAt(0)}`.toUpperCase() || 'GX';

  return (
    <div data-portal={portal} className="min-h-dvh bg-surface-100 lg:flex">
      <aside
        data-sidebar=""
        className="bg-[var(--sidebar-bg)] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[var(--sidebar-width)] lg:shrink-0 lg:flex-col lg:px-3.5 lg:py-5"
      >
        {/* Marca. El SVG del logo real, no la palabra escrita con la fuente de
            titulares: el trazo del logotipo no es Outfit y la diferencia se ve
            al lado de cualquier material impreso del kit. */}
        <div className="flex items-center gap-4 px-4 py-3 lg:block lg:px-2 lg:py-0 lg:pb-5">
          <a href={homeHref} className="block shrink-0" aria-label={`GLEXCO ${label}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG estatico
                del propio origen: `next/image` no optimiza SVG y solo anadiria
                un componente cliente para nada. */}
            <img
              src="/glexco-marca-blanco.svg"
              alt="GLEXCO"
              width={132}
              height={27}
              className="h-5 w-auto lg:h-auto lg:w-[8.25rem]"
            />
          </a>

          <div className="mt-3 mb-2.5 hidden h-px bg-white/15 lg:block" />

          <p className="text-[11px] font-medium uppercase tracking-[0.17em] text-[var(--sidebar-label)]">
            {label}
          </p>
        </div>

        <SidebarNav items={items} />

        {/* Empuja la ficha de usuario al fondo en escritorio. En movil no existe:
            la ficha viaja con el resto y no hay altura que rellenar. */}
        <div className="hidden lg:block lg:flex-1" />

        {/* La ficha es un ENLACE a "Mi cuenta". En el canvas parece decorativa,
            pero es el sitio donde todo el mundo busca su perfil, y dejarla
            muerta obliga a inventar otro destino para lo mismo. */}
        <a
          href={accountHref}
          className="hidden items-center gap-2.5 rounded-[var(--nav-radius)] bg-white/[0.09] p-2.5 transition hover:bg-white/[0.16] lg:flex"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-[var(--nav-radius)] bg-[var(--portal-accent)] font-display text-sm font-semibold text-brand-700"
            aria-hidden="true"
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">
              {session.firstName} {session.lastName}
            </span>
            <span className="block truncate text-[11px] text-onbrand-300">{subtitle}</span>
          </span>
        </a>

        {/* Salir vive dentro de la barra, no en una esquina de la cabecera: es
            donde esta el resto de lo que trata de "mi cuenta". */}
        <form action={onLogout} className="hidden lg:mt-1.5 lg:block">
          <button
            type="submit"
            className="w-full rounded-[var(--nav-radius)] px-3 py-2 text-left text-[13px] font-medium text-onbrand-300 transition hover:bg-white/10 hover:text-white"
          >
            Cerrar sesión
          </button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera solo de movil: la barra lateral se pliega y el nombre y la
            salida no caben en ella. */}
        <div className="flex items-center gap-3 border-b border-line-200 bg-white px-4 py-2 lg:hidden">
          <a href={accountHref} className="min-w-0 flex-1 truncate text-sm text-ink-500 hover:text-brand-700">
            {session.firstName} {session.lastName}
          </a>
          <form action={onLogout}>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-500 transition hover:bg-surface-200 hover:text-ink-900"
            >
              Salir
            </button>
          </form>
        </div>

        <main
          id="contenido"
          className="mx-auto w-full max-w-[var(--portal-max-width)] flex-1 px-4 pb-16 pt-5 sm:px-6 lg:px-8 lg:pt-7"
          style={{ display: 'grid', alignContent: 'start', gap: 'var(--portal-gap)' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
