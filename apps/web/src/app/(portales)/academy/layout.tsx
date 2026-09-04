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
 * **Y no se redirige cuando no se sabe.** El portal de un alumno viene del
 * perfil de identidad porque depende de su edad; si esa llamada falla, la sesión
 * sigue adelante sin él y `resolvePortal` supone Discover para cualquier alumno.
 * Con la suposición tratada como un hecho, este guard expulsaba a un alumno de
 * Academy de su propio portal cada vez que identidad tardaba un instante — y el
 * cliente lo vio así: «cambio a inglés y me lleva a inicio como cuenta
 * Discovery». Ante la duda, se deja donde está: el marco lateral ya es el suyo y
 * el backend comprueba el alcance de cada dato por su cuenta.
 */
export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  if (session.portalKnown && session.portal !== 'academy') {
    redirect(`/${session.portal === 'teacher' ? 'docentes' : session.portal}`);
  }

  return <>{children}</>;
}
