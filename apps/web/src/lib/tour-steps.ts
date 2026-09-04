import type { TranslationValues } from 'next-intl';
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
 *
 * **El selector vive aqui y el texto en `messages/*.json`.** Antes el texto
 * estaba en este archivo, asi que al cambiar a ingles el tutorial de la
 * plataforma seguia entero en espanol -y es la pantalla que lee quien no sabe
 * usarla todavia, o sea justo quien menos margen tiene-. El selector no se
 * traduce nunca: es una ruta del DOM, no contenido.
 */

interface TourSpec {
  /** Clave en `tour` de los mensajes. Le cuelgan `titulo` y `cuerpo`. */
  key: string;
  target: string;
}

const COMMON: TourSpec[] = [{ key: 'cuenta', target: '[data-sidebar] [href$="/cuenta"]' }];

const DISCOVER: TourSpec[] = [
  { key: 'portadaDiscover', target: '[data-sidebar] [href="/discover"]' },
  { key: 'laboratorio', target: '[data-sidebar] [href="/discover/laboratorio"]' },
  { key: 'biblioteca', target: '[data-sidebar] [href="/discover/biblioteca"]' },
  { key: 'actividades', target: '[data-sidebar] [href="/discover/evaluaciones"]' },
  { key: 'logros', target: '[data-sidebar] [href="/discover/logros"]' },
  ...COMMON,
];

const ACADEMY: TourSpec[] = [
  { key: 'portadaAcademy', target: '[data-sidebar] [href="/academy"]' },
  { key: 'cursos', target: '[data-sidebar] [href="/academy/cursos"]' },
  { key: 'evaluacionesAlumno', target: '[data-sidebar] [href="/academy/evaluaciones"]' },
  { key: 'progreso', target: '[data-sidebar] [href="/academy/progreso"]' },
  ...COMMON,
];

const TEACHER: TourSpec[] = [
  { key: 'panelDocente', target: '[data-sidebar] [href="/docentes"]' },
  { key: 'crearSalon', target: '[href="/docentes/salones/nuevo"]' },
  { key: 'evaluacionesDocente', target: '[data-sidebar] [href="/docentes/evaluaciones"]' },
  { key: 'anunciosDocente', target: '[data-sidebar] [href="/docentes/anuncios"]' },
  { key: 'clase', target: '[data-roster]' },
  ...COMMON,
];

/**
 * Los pasos ya traducidos, listos para el componente.
 *
 * Recibe el traductor del espacio `tour` en vez de pedirlo: quien lo llama es un
 * layout -que ya es asincrono y ya lo tiene-, y asi esta funcion sigue siendo
 * pura y se puede usar igual desde un componente de cliente.
 */
export function tourFor(
  portal: 'discover' | 'academy' | 'teacher' | 'admin',
  t: (key: string, values?: TranslationValues) => string,
): TourStep[] {
  const specs = portal === 'discover' ? DISCOVER : portal === 'academy' ? ACADEMY : TEACHER;

  return specs.map((spec) => ({
    target: spec.target,
    title: t(`${spec.key}.titulo`),
    body: t(`${spec.key}.cuerpo`),
  }));
}
