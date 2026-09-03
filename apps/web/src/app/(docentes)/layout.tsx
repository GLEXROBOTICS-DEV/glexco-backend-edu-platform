import { redirect } from 'next/navigation';
import { ClassroomIcon, KitIcon, LevelIcon, RobotIcon } from '@glexco/icons';
import { PERMISSIONS } from '@glexco/contracts';
import { getSession } from '../../lib/session';
import { logout } from '../../lib/auth.actions';

/**
 * Marco del Teacher Center y del portal de administración.
 *
 * Comparten layout porque un administrador de institución ve todo lo del
 * docente **más** lo suyo: darles marcos distintos obligaría a duplicar cada
 * pantalla de salón. La diferencia está en los destinos de la barra, que se
 * calculan del rol.
 *
 * La densidad es la de Academy —compacta— y no la de Discover: aquí trabajan
 * adultos que necesitan ver muchas filas por pantalla, no niños que necesitan
 * objetivos grandes.
 */
export default async function DocentesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // La comprobación vive en el layout, no en cada página: si estuviera en cada
  // página, la que se olvidara de ponerla quedaría abierta y nadie lo notaría.
  if (!session) redirect('/ingresar');

  // Un alumno que llegue aquí por una URL copiada va a SU portal, no a una
  // pantalla de error: no ha hecho nada mal.
  if (session.portal !== 'teacher' && session.portal !== 'institution' && session.portal !== 'admin') {
    redirect(session.portal === 'academy' ? '/academy' : '/discover');
  }

  const isAdmin = session.portal === 'institution' || session.portal === 'admin';
  // El panel de plataforma es de GLEXCO, no del colegio. Se decide por PERMISO
  // y no por el portal: `admin` incluye a perfiles internos que no leen la
  // plataforma entera, y darles un enlace que acaba en una redireccion es peor
  // que no darselo.
  const isPlatform = session.permissions.includes(PERMISSIONS.ANALYTICS_READ_PLATFORM);

  return (
    <div data-portal="academy" className="min-h-dvh bg-surface-100">
      <header className="border-b border-line-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
          <span className="font-display text-xl font-bold text-brand-600">
            GLEXCO
            <span className="ml-1.5 font-sans text-xs font-medium uppercase tracking-wide text-ink-400">
              {isAdmin ? 'admin' : 'docentes'}
            </span>
          </span>

          <nav aria-label="Secciones del panel" className="hidden flex-1 md:block">
            <ul className="flex items-center gap-1">
              <NavLink href="/docentes" label="Mis salones" Icon={ClassroomIcon} />
              <NavLink href="/docentes/evaluaciones" label="Evaluaciones" Icon={RobotIcon} />
              {isAdmin ? (
                <NavLink href="/docentes/institucion" label="Mi institución" Icon={LevelIcon} />
              ) : null}
              {isPlatform ? <NavLink href="/admin" label="Plataforma" Icon={KitIcon} /> : null}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-ink-500">
              {session.firstName} {session.lastName}
            </span>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-500 transition hover:bg-surface-200 hover:text-ink-900"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main
        id="contenido"
        className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6"
        style={{ display: 'grid', gap: 'var(--portal-gap)' }}
      >
        {children}
      </main>
    </div>
  );
}

function NavLink({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof ClassroomIcon;
}) {
  return (
    <li>
      <a
        href={href}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-surface-200 hover:text-brand-700"
      >
        <Icon size={18} />
        {label}
      </a>
    </li>
  );
}
