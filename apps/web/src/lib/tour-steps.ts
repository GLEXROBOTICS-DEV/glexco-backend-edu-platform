import type { TourStep } from '../components/tour';

/**
 * Los pasos de la visita guiada, por portal.
 *
 * Apuntan a elementos reales por selector y el componente salta los que no
 * existen en la pantalla actual, asi que aqui se puede describir la barra
 * entera sin comprobar en cual de las veinte pantallas esta el alumno.
 *
 * Se describe QUE responde cada sitio, no que hay. "Mis kits" no dice nada;
 * "aqui esta todo lo que has desbloqueado con el codigo de tu libro" si.
 */

const COMMON: TourStep[] = [
  {
    target: '[data-sidebar] [href$="/cuenta"]',
    title: 'Tu cuenta',
    body: 'Aquí cambias tu contraseña y ves desde qué dispositivos tienes la sesión abierta. Si ves uno que no reconoces, ciérralo.',
  },
];

export const DISCOVER_TOUR: TourStep[] = [
  {
    target: '[data-sidebar] [href="/discover"]',
    title: 'Tu portada',
    body: 'Lo primero que ves al entrar: el curso que dejaste a medias, tus puntos y lo que tienes pendiente.',
  },
  {
    target: '[data-sidebar] [href="/discover/laboratorio"]',
    title: 'Laboratorio',
    body: 'Los robots que puedes construir con tus kits, con la ficha de cada uno.',
  },
  {
    target: '[data-sidebar] [href="/discover/biblioteca"]',
    title: 'Biblioteca',
    body: 'Los tutoriales y las fichas de trabajo de tu kit. Es de donde sale casi todo lo que vas a hacer.',
  },
  {
    target: '[data-sidebar] [href="/discover/evaluaciones"]',
    title: 'Actividades',
    body: 'Tus retos y evaluaciones. Entrar a mirar cómo te fue no te gasta ningún intento: solo se gasta cuando pulsas para responder.',
  },
  {
    target: '[data-sidebar] [href="/discover/logros"]',
    title: 'Mis logros',
    body: 'Tus insignias y tu nivel de Explorador, con lo que falta para el siguiente. Solo te comparas contigo mismo.',
  },
  ...COMMON,
];

export const ACADEMY_TOUR: TourStep[] = [
  {
    target: '[data-sidebar] [href="/academy"]',
    title: 'Mi formación',
    body: 'Tus cifras, tu ruta tecnológica y lo que tienes por delante.',
  },
  {
    target: '[data-sidebar] [href="/academy/cursos"]',
    title: 'Cursos',
    body: 'El contenido que has activado, con el avance de cada curso lección a lección.',
  },
  {
    target: '[data-sidebar] [href="/academy/evaluaciones"]',
    title: 'Evaluaciones',
    body: 'Abrir una para ver tu nota no consume intentos: solo se consume al pulsar para responder.',
  },
  {
    target: '[data-sidebar] [href="/academy/progreso"]',
    title: 'Mi progreso',
    body: 'Tu media en las evaluaciones del kit y en las de tu docente, por separado, y cuánto has mejorado desde tu primer intento.',
  },
  ...COMMON,
];

export const TEACHER_TOUR: TourStep[] = [
  {
    target: '[data-sidebar] [href="/docentes"]',
    title: 'Panel principal',
    body: 'Tus salones, cuántas plazas quedan y cuántas entregas tienes por corregir.',
  },
  {
    target: '[href="/docentes/salones/nuevo"]',
    title: 'Crear un salón',
    body: 'El grado que elijas decide qué kit pueden activar sus alumnos, así que conviene acertar a la primera.',
  },
  {
    target: '[data-sidebar] [href="/docentes/evaluaciones"]',
    title: 'Evaluaciones',
    body: 'El banco de GLEXCO viene con el kit y es igual en todos los colegios: no se edita, pero se duplica para adaptarlo.',
  },
  {
    target: '[data-sidebar] [href="/docentes/anuncios"]',
    title: 'Anuncios',
    body: 'Lo que publiques aquí lo ven tus alumnos en su portada.',
  },
  {
    target: '[data-roster]',
    title: 'Tu clase',
    body: 'Quién ha activado su kit y quién se ha descolgado. Son las dos señales que llegan antes del primer examen, cuando todavía se puede hacer algo.',
  },
  ...COMMON,
];

export function tourFor(portal: 'discover' | 'academy' | 'teacher' | 'admin'): TourStep[] {
  if (portal === 'discover') return DISCOVER_TOUR;
  if (portal === 'academy') return ACADEMY_TOUR;
  return TEACHER_TOUR;
}
