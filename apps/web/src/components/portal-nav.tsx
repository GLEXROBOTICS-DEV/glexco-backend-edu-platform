import {
  BadgeIcon,
  CertificateIcon,
  ChallengeIcon,
  CourseIcon,
  HomeIcon,
  KitIcon,
  LevelIcon,
  LibraryIcon,
  RobotIcon,
} from '@glexco/icons';
import { getTranslations } from 'next-intl/server';
import type { NavItem } from './sidebar-nav';

/**
 * Destinos de los portales de alumno.
 *
 * Difieren entre Discover y Academy porque el producto difiere: un nino de
 * primaria no tiene certificaciones ni portafolio, y un estudiante de instituto
 * no tiene "zona de retos" con ese nombre. Compartir la barra y cambiar solo las
 * etiquetas seria mentir sobre lo que hay detras.
 *
 * Las etiquetas y las rutas son las que ya habia; lo que cambio al adoptar el
 * canvas fue la FORMA de pintarlas y el icono de inicio, que era el del robot y
 * ahora es la casa que usa el diseno en los cuatro portales.
 *
 * Los iconos van creados, no como componente: la barra es un componente de
 * cliente y por esa frontera no pasan funciones. Ver `NavItem`.
 */

/**
 * Los destinos, ya traducidos.
 *
 * Pasa a ser `async` y a pedir las traducciones porque las etiquetas de la barra
 * son lo unico que un usuario ve en TODAS las pantallas: dejarlas en espanol
 * mientras el resto cambia de idioma es peor que no traducir nada, porque hace
 * dudar de si el cambio funciono.
 *
 * Las RUTAS no se traducen y no es un descuido: son las mismas para todos, van
 * en correos y enlaces ya repartidos, y traducirlas duplicaria cada pantalla.
 */
export async function portalNavItems(
  portal: 'discover' | 'academy',
): Promise<readonly NavItem[]> {
  const t = await getTranslations('nav');

  if (portal === 'academy') {
    return [
      { href: '/academy', label: t('inicio'), icon: <HomeIcon />, exact: true },
      { href: '/academy/laboratorio', label: t('laboratorioRobots'), icon: <RobotIcon /> },
      { href: '/academy/cursos', label: t('cursos'), icon: <CourseIcon /> },
      { href: '/academy/progreso', label: t('miProgreso'), icon: <LevelIcon /> },
      { href: '/academy/evaluaciones', label: t('evaluaciones'), icon: <ChallengeIcon /> },
      { href: '/academy/biblioteca', label: t('biblioteca'), icon: <LibraryIcon /> },
      { href: '/academy/logros', label: t('misLogros'), icon: <BadgeIcon /> },
      { href: '/academy/certificaciones', label: t('certificaciones'), icon: <CertificateIcon /> },
    ];
  }

  return [
    { href: '/discover', label: t('inicio'), icon: <HomeIcon />, exact: true },
    { href: '/discover/laboratorio', label: t('laboratorio'), icon: <RobotIcon /> },
    { href: '/discover/kits', label: t('misKits'), icon: <KitIcon /> },
    { href: '/discover/progreso', label: t('miProgreso'), icon: <LevelIcon /> },
    { href: '/discover/evaluaciones', label: t('actividades'), icon: <ChallengeIcon /> },
    { href: '/discover/biblioteca', label: t('biblioteca'), icon: <LibraryIcon /> },
    { href: '/discover/logros', label: t('misLogros'), icon: <BadgeIcon /> },
    { href: '/discover/certificados', label: t('misCertificados'), icon: <CertificateIcon /> },
  ];
}
