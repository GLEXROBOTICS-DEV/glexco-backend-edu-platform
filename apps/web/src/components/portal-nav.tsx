import {
  BadgeIcon,
  LevelIcon,
  ChallengeIcon,
  CertificateIcon,
  KitIcon,
  LibraryIcon,
  RobotIcon,
} from '@glexco/icons';
import type { SessionUser } from '../lib/session';

/**
 * Barra de navegacion del portal.
 *
 * Los destinos difieren entre Discover y Academy porque el producto difiere: un
 * nino de primaria no tiene certificaciones ni portafolio, y un estudiante de
 * instituto no tiene "zona de retos" con ese nombre. Compartir la barra y
 * cambiar solo las etiquetas seria mentir sobre lo que hay detras.
 */

interface NavItem {
  href: string;
  label: string;
  Icon: typeof RobotIcon;
}

const DISCOVER_NAV: readonly NavItem[] = [
  { href: '/discover', label: 'Inicio', Icon: RobotIcon },
  { href: '/discover/kits', label: 'Mis kits', Icon: KitIcon },
  { href: '/discover/progreso', label: 'Mi progreso', Icon: LevelIcon },
  { href: '/discover/retos', label: 'Retos', Icon: ChallengeIcon },
  { href: '/discover/biblioteca', label: 'Biblioteca', Icon: LibraryIcon },
  { href: '/discover/logros', label: 'Mis logros', Icon: BadgeIcon },
];

const ACADEMY_NAV: readonly NavItem[] = [
  { href: '/academy', label: 'Inicio', Icon: RobotIcon },
  { href: '/academy/cursos', label: 'Cursos', Icon: KitIcon },
  { href: '/academy/progreso', label: 'Mi progreso', Icon: LevelIcon },
  { href: '/academy/proyectos', label: 'Proyectos', Icon: ChallengeIcon },
  { href: '/academy/biblioteca', label: 'Biblioteca', Icon: LibraryIcon },
  { href: '/academy/certificaciones', label: 'Certificaciones', Icon: CertificateIcon },
];

export function PortalNav({
  portal,
  session,
  onLogout,
}: {
  portal: 'discover' | 'academy';
  session: SessionUser;
  onLogout: () => Promise<void>;
}) {
  const items = portal === 'academy' ? ACADEMY_NAV : DISCOVER_NAV;
  const initials = `${session.firstName.charAt(0)}${session.lastName.charAt(0)}`.toUpperCase();

  return (
    <header className="border-b border-line-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <span className="font-display text-xl font-bold text-brand-600">
          GLEXCO
          <span className="ml-1.5 font-sans text-xs font-medium uppercase tracking-wide text-ink-400">
            {portal}
          </span>
        </span>

        {/* `aria-label` distingue esta navegacion de cualquier otra de la pagina:
            un lector de pantalla lista las regiones de navegacion y sin nombre
            todas se llaman igual. */}
        <nav aria-label="Secciones del portal" className="hidden flex-1 md:block">
          <ul className="flex items-center gap-1">
            {items.map(({ href, label, Icon }) => (
              <li key={href}>
                <a
                  href={href}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-surface-200 hover:text-brand-700"
                >
                  <Icon size={18} />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {initials}
          </span>
          <span className="sr-only">Sesión de {session.firstName}</span>

          <form action={onLogout}>
            <button
              type="submit"
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 transition hover:bg-surface-200 hover:text-ink-900"
            >
              Salir
            </button>
          </form>
        </div>
      </div>

      {/* En movil la navegacion baja a una barra propia con scroll horizontal:
          meterla en un menu desplegable esconderia el destino principal detras
          de un toque extra, y aqui son cinco destinos, no veinte. */}
      <nav aria-label="Secciones del portal" className="md:hidden">
        <ul className="flex gap-1 overflow-x-auto border-t border-line-200 px-4 py-2">
          {items.map(({ href, label, Icon }) => (
            <li key={href} className="shrink-0">
              <a
                href={href}
                className="flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-ink-700"
              >
                <Icon size={20} />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
