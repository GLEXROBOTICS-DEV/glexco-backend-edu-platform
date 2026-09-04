import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { logout } from '../../lib/auth.actions';
import { tourFor } from '../../lib/tour-steps';
import { AppShell } from '../../components/app-shell';
import { portalNavItems } from '../../components/portal-nav';

/**
 * Marco comun de los portales de alumno.
 *
 * Discover y Academy comparten estructura y componentes; lo que cambia es la
 * DENSIDAD y el ACENTO, y se declaran una sola vez con `data-portal` en vez de
 * repetir variantes en cada componente. Un nino de seis anos necesita objetivos
 * grandes y mucho aire; un estudiante de instituto necesita ver mas por pantalla
 * sin que le hablen como a un nino.
 */
export default async function PortalesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  // La comprobacion de sesion vive en el layout, no en cada pagina: si estuviera
  // en cada pagina, la que se olvidara de ponerla quedaria abierta y nadie lo
  // notaria hasta que alguien la encontrase.
  if (!session) redirect('/ingresar');

  const portal = session.portal === 'academy' ? 'academy' : 'discover';

  return (
    <AppShell
      portal={portal}
      label={portal === 'academy' ? 'Academy' : 'Discover'}
      homeHref={`/${portal}`}
      accountHref={`/${portal}/cuenta`}
      items={await portalNavItems(portal)}
      session={session}
      subtitle="Estudiante"
      onLogout={logout}
      tour={tourFor(portal)}
    >
      {children}
    </AppShell>
  );
}
