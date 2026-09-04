import { BusinessRuleError } from '@glexco/kernel';

/**
 * Rubricas de correccion.
 *
 * Hoy el docente pone un numero libre sobre cada pregunta abierta, y eso tiene
 * dos problemas que una rubrica resuelve de golpe:
 *
 * 1. **Al alumno "12 de 20" no le dice nada.** No sabe si perdio los puntos por
 *    el montaje, por el cableado o por no explicar lo que hizo, asi que no sabe
 *    que arreglar. Con criterios, la nota se lee como una lista de que salio
 *    bien y que no.
 * 2. **Dos docentes puntuan distinto lo mismo.** Y en cuanto las notas se
 *    comparan entre salones -que es lo que hacen los dashboards-, esa varianza
 *    se convierte en una diferencia que parece del alumno y es del corrector.
 *
 * **La rubrica vive DENTRO de la pregunta, en su JSONB.** No hay tabla nueva:
 * una rubrica sin su pregunta no significa nada, se lee y se escribe siempre con
 * ella, y en tabla aparte cada carga de la bandeja de correccion seria un JOIN
 * mas. Es la misma decision que ya se tomo con las opciones de las preguntas.
 *
 * **Y los puntos los calcula el DOMINIO, nunca la pantalla.** Es la garantia
 * que sostiene todo lo demas: el formulario manda que nivel eligio el docente en
 * cada criterio, y de ahi salen los puntos. Si el formulario mandara el total,
 * un `points` manipulado otorgaria mas de lo que la rubrica permite, y la
 * comprobacion de "no mas del maximo de la pregunta" no lo notaria mientras
 * cupiera.
 */

export interface RubricLevel {
  /** "Excelente", "Correcto", "Mejorable"... */
  label: string;
  points: number;
  /** Que tiene que verse para merecer este nivel. Es lo que hace consistente la
   *  correccion entre dos docentes distintos. */
  description?: string | null;
}

export interface RubricCriterion {
  id: string;
  label: string;
  levels: RubricLevel[];
}

export interface Rubric {
  criteria: RubricCriterion[];
}

/** Lo que el docente eligio: un nivel por criterio. */
export interface RubricSelection {
  criterionId: string;
  levelIndex: number;
}

/**
 * Los puntos que otorga una seleccion.
 *
 * Un criterio sin elegir vale CERO y no se ignora. Ignorarlo haria que corregir
 * la mitad de la rubrica diera la misma nota que corregirla entera bien, y el
 * docente no veria la diferencia.
 */
export function scoreRubric(rubric: Rubric, selections: readonly RubricSelection[]): number {
  const porCriterio = new Map(selections.map((s) => [s.criterionId, s.levelIndex]));

  let total = 0;

  for (const criterion of rubric.criteria) {
    const elegido = porCriterio.get(criterion.id);
    if (elegido === undefined) continue;

    const level = criterion.levels[elegido];
    // Un indice fuera de rango no suma. Llega de un formulario manipulado o de
    // una rubrica que cambio despues de empezar a corregir, y en los dos casos
    // sumar algo inventado es peor que sumar cero.
    if (!level) continue;

    total += level.points;
  }

  return total;
}

/** El maximo que puede dar una rubrica: el mejor nivel de cada criterio. */
export function rubricMaxPoints(rubric: Rubric): number {
  return rubric.criteria.reduce(
    (sum, criterion) => sum + Math.max(0, ...criterion.levels.map((level) => level.points)),
    0,
  );
}

/**
 * Comprueba una rubrica al capturarla.
 *
 * La comprobacion que importa es la ultima: **el maximo de la rubrica tiene que
 * coincidir con los puntos de la pregunta.** Si la rubrica diera menos, la
 * pregunta seria imposible de sacar entera y nadie sabria por que; si diera mas,
 * el dominio rechazaria la correccion al pasarse del maximo y el docente se
 * quedaria sin poder cerrar la nota despues de haber puntuado todo.
 */
export function assertRubricIsUsable(rubric: Rubric, questionPoints: number): void {
  if (rubric.criteria.length === 0) {
    throw new BusinessRuleError(
      'RUBRIC_NEEDS_CRITERIA',
      'Una rubrica sin criterios no sirve para corregir nada.',
    );
  }

  const ids = new Set<string>();

  for (const criterion of rubric.criteria) {
    if (ids.has(criterion.id)) {
      throw new BusinessRuleError(
        'RUBRIC_CRITERION_DUPLICATED',
        'Dos criterios de la misma rubrica no pueden tener el mismo identificador.',
      );
    }
    ids.add(criterion.id);

    if (criterion.levels.length < 2) {
      // Con un solo nivel no hay nada que elegir: es un numero fijo disfrazado
      // de rubrica.
      throw new BusinessRuleError(
        'RUBRIC_CRITERION_NEEDS_LEVELS',
        `El criterio "${criterion.label}" necesita al menos dos niveles.`,
      );
    }

    for (const level of criterion.levels) {
      if (level.points < 0) {
        throw new BusinessRuleError(
          'RUBRIC_LEVEL_NEGATIVE',
          'Un nivel de rubrica no puede quitar puntos.',
        );
      }
    }
  }

  const maximo = rubricMaxPoints(rubric);

  if (maximo !== questionPoints) {
    throw new BusinessRuleError(
      'RUBRIC_MAX_MISMATCH',
      `La rubrica suma ${maximo} puntos y la pregunta vale ${questionPoints}. Tienen que coincidir.`,
      { rubricMax: maximo, questionPoints },
    );
  }
}

/**
 * El desglose que ve el ALUMNO.
 *
 * Lleva el criterio, el nivel que le pusieron y su descripcion, que es lo que
 * convierte una nota en algo que se puede arreglar. No lleva los OTROS niveles:
 * saber que existia un "excelente" que no alcanzo no le dice nada mas que ya
 * sabe, y llena la pantalla de opciones que no eligio nadie.
 */
export function explainRubric(
  rubric: Rubric,
  selections: readonly RubricSelection[],
): { criterion: string; level: string | null; points: number; description: string | null }[] {
  const porCriterio = new Map(selections.map((s) => [s.criterionId, s.levelIndex]));

  return rubric.criteria.map((criterion) => {
    const elegido = porCriterio.get(criterion.id);
    const level = elegido === undefined ? undefined : criterion.levels[elegido];

    return {
      criterion: criterion.label,
      // `null` y no un texto: los textos visibles son claves de traduccion, y
      // este saldria en espanol en el portal en ingles.
      level: level?.label ?? null,
      points: level?.points ?? 0,
      description: level?.description ?? null,
    };
  });
}
