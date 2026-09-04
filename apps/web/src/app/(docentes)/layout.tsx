import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ActivationCodeIcon,
  AnnouncementIcon,
  ClassroomIcon,
  CourseIcon,
  DashboardIcon,
  GradingIcon,
  InstitutionIcon,
  StudentsIcon,
} from '@glexco/icons';
import { PERMISSIONS, ROLE_CREATION_MATRIX, type Role } from '@glexco/contracts';
import { getSession } from '../../lib/session';
import { logout } from '../../lib/auth.actions';
import { tourFor } from '../../lib/tour-steps';
import { AppShell, type NavItem } from '../../components/app-shell';

/**
 * Marco del Teacher Center y del portal de administración.
 *
 * Comparten layout porque un administrador de institución ve todo lo del
 * docente **más** lo suyo: darles marcos distintos obligaría a duplicar cada
 * pantalla de salón. La diferencia está en los destinos de la barra, que se
 * calculan del rol, y en el color de esa barra.
 *
 * La densidad es la compacta y no la de Discover: aquí trabajan adultos que
 * necesitan ver muchas filas por pantalla, no niños que necesitan objetivos
 * grandes.
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

  // Personal de GLEXCO sobre azul profundo, colegio sobre azul de marca. Quien
  // tiene los dos accesos -pasa con el equipo interno- distingue de un vistazo
  // si esta mirando un colegio o toda la plataforma, antes de leer una cifra.
  const portal = session.portal === 'admin' ? 'admin' : 'teacher';

  const items: NavItem[] = [
    { href: '/docentes', label: 'Mis salones', icon: <ClassroomIcon />, exact: true },
    { href: '/docentes/evaluaciones', label: 'Evaluaciones', icon: <GradingIcon /> },
    { href: '/docentes/anuncios', label: 'Anuncios', icon: <AnnouncementIcon /> },
  ];
  if (isAdmin) {
    items.push({ href: '/docentes/institucion', label: 'Mi institución', icon: <InstitutionIcon /> });
  }
  if (isPlatform) {
    items.push({ href: '/admin', label: 'Plataforma', icon: <DashboardIcon />, exact: true });
  }

  // Las pantallas de gestion se anaden POR PERMISO y una a una, no en bloque
  // con `isPlatform`. El rol `admin` incluye perfiles internos que no gestionan
  // todo: el equipo de contenidos publica kits y no da de alta colegios, y el
  // comercial genera codigos y no publica contenido. Un enlace que acaba en una
  // redireccion es peor que no darlo.
  if (session.permissions.includes(PERMISSIONS.INSTITUTION_CREATE)) {
    items.push({
      href: '/admin/instituciones',
      label: 'Instituciones',
      icon: <InstitutionIcon />,
    });
  }
  if (creaAlgunRol(session.roles)) {
    items.push({ href: '/admin/usuarios', label: 'Personal', icon: <StudentsIcon /> });
  }
  if (session.permissions.includes(PERMISSIONS.ACTIVATION_CODE_GENERATE)) {
    items.push({ href: '/admin/codigos', label: 'Codigos', icon: <ActivationCodeIcon /> });
  }
  if (session.permissions.includes(PERMISSIONS.CONTENT_PUBLISH)) {
    items.push({ href: '/admin/contenidos', label: 'Contenidos', icon: <CourseIcon /> });
  }

  return (
    <AppShell
      portal={portal}
      label={portal === 'admin' ? 'Admin' : 'Teacher Center'}
      homeHref="/docentes"
      accountHref="/docentes/cuenta"
      items={items}
      session={session}
      subtitle={portal === 'admin' ? 'GLEXCO' : isAdmin ? 'Dirección' : 'Docente'}
      onLogout={logout}
      tour={tourFor(portal, await getTranslations('tour'))}
    >
      {children}
    </AppShell>
  );
}

/**
 * Si esta persona puede crear ALGUNA cuenta de personal.
 *
 * Se pregunta a la misma tabla que el backend usa para rechazar, y no a un
 * permiso: crear cuentas no tiene uno propio -lo gobierna la matriz de roles-,
 * asi que comprobar `USER_CREATE` daria el enlace a quien despues no puede
 * crear nada.
 */
function creaAlgunRol(roles: readonly string[]): boolean {
  return roles.some((role) => (ROLE_CREATION_MATRIX[role as Role] ?? []).length > 0);
}
