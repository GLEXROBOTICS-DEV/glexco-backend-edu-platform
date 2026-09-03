import { redirect } from 'next/navigation';
import { getSession } from '../lib/session';
import { portalPath } from '../lib/portal';

/**
 * Raiz.
 *
 * No hay pagina de inicio publica: esta plataforma es de acceso privado y
 * cualquier cosa que se pintara aqui seria una landing que nadie ha pedido. Se
 * envia a cada usuario a su portal, y a quien no tenga sesion, a ingresar.
 */
export default async function Root() {
  const session = await getSession();
  redirect(session ? portalPath(session.portal) : '/ingresar');
}
