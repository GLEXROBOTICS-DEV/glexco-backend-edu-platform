import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';

/**
 * Un alumno solo entra en SU portal.
 *
 * **Sin esto, un enlace mal puesto metía a un alumno de Academy en las rutas de
 * Discover y a partir de ahí todo se rompía**: el marco se pinta con el portal
 * de la sesión y la URL decía otro, así que la barra lateral llevaba a un sitio
 * y la página estaba en otro, y cada clic acababa en un 404. Lo reportó el
 * cliente navegando desde certificados.
 *
 * El layout de arriba solo comprobaba que hubiera sesión, no que el segmento de
 * la URL fuera el suyo. Se arregla aquí, en el segmento, porque es el único
 * sitio que conoce las dos cosas a la vez.
 *
 * Se **redirige** y no se da un error: quien llega aquí no ha hecho nada mal,
 * ha pulsado un enlace que le hemos dado nosotros.
 */
export default async function DiscoverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const suyo = session.portal === 'academy' ? 'academy' : 'discover';

  if (suyo !== 'discover') redirect(`/${suyo}`);

  return <>{children}</>;
}
