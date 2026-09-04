import {
  BadgeIcon,
  CertificateIcon,
  ChallengeIcon,
  CourseIcon,
  HomeIcon,
  KitIcon,
  LevelIcon,
  LibraryIcon,
} from '@glexco/icons';
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

const DISCOVER_NAV: readonly NavItem[] = [
  { href: '/discover', label: 'Inicio', icon: <HomeIcon />, exact: true },
  { href: '/discover/kits', label: 'Mis kits', icon: <KitIcon /> },
  { href: '/discover/progreso', label: 'Mi progreso', icon: <LevelIcon /> },
  { href: '/discover/evaluaciones', label: 'Actividades', icon: <ChallengeIcon /> },
  { href: '/discover/biblioteca', label: 'Biblioteca', icon: <LibraryIcon /> },
  { href: '/discover/logros', label: 'Mis logros', icon: <BadgeIcon /> },
];

const ACADEMY_NAV: readonly NavItem[] = [
  { href: '/academy', label: 'Inicio', icon: <HomeIcon />, exact: true },
  { href: '/academy/cursos', label: 'Cursos', icon: <CourseIcon /> },
  { href: '/academy/progreso', label: 'Mi progreso', icon: <LevelIcon /> },
  { href: '/academy/evaluaciones', label: 'Evaluaciones', icon: <ChallengeIcon /> },
  { href: '/academy/biblioteca', label: 'Biblioteca', icon: <LibraryIcon /> },
  { href: '/academy/certificaciones', label: 'Certificaciones', icon: <CertificateIcon /> },
];

export function portalNavItems(portal: 'discover' | 'academy'): readonly NavItem[] {
  return portal === 'academy' ? ACADEMY_NAV : DISCOVER_NAV;
}
