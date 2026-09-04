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
 *
 * **Y no se redirige cuando no se sabe.** Ver la nota del layout de Academy: el
 * portal de un alumno viene del perfil de identidad, y con ese perfil sin
 * responder la suposición es Discover. Aquí esa suposición no hacía daño -deja
 * al alumno donde ya está-, pero la regla se escribe igual en los dos sitios: si
 * un día cambia el valor por defecto, el guard no empieza a mover gente sola.
 */
export default async function DiscoverLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (session.portalKnown && session.portal !== 'discover') {
    redirect(`/${session.portal === 'teacher' ? 'docentes' : session.portal}`);
  }

  return <>{children}</>;
}
