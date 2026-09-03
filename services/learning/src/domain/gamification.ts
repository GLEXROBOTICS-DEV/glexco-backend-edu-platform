/**
 * Reglas de gamificacion.
 *
 * Es dominio puro: sin base de datos, sin HTTP y sin fechas del sistema. Todo lo
 * que decide "cuanto vale esto" y "que nivel es este" vive aqui, de modo que se
 * pueda probar en memoria y cambiar sin tocar infraestructura. Los valores salen
 * de la seccion 7 de DOMINIO.md.
 */

/**
 * Niveles del Explorador.
 *
 * Los umbrales estan en DOMINIO.md y son del cliente, no inventados. El primer
 * nivel empieza en 0 a proposito: un alumno que acaba de entrar YA es Explorador.
 * Empezar en "sin nivel" es la forma mas rapida de que un nino de ocho anos
 * sienta que llega tarde a algo.
 */
export interface ExplorerLevelDefinition {
  readonly level: number;
  readonly name: string;
  readonly minXp: number;
}

export const EXPLORER_LEVELS: readonly ExplorerLevelDefinition[] = [
  { level: 1, name: 'Explorador', minXp: 0 },
  { level: 2, name: 'Inventor', minXp: 500 },
  { level: 3, name: 'Constructor', minXp: 1500 },
  { level: 4, name: 'Innovador', minXp: 3500 },
  { level: 5, name: 'Maestro Robótico', minXp: 7000 },
] as const;

export interface ExplorerLevel {
  level: number;
  name: string;
  /** XP que faltan para el siguiente. `null` en el ultimo: no hay mas arriba, y
   *  mostrar "faltan 0" en el nivel maximo se lee como un error. */
  xpToNext: number | null;
  nextName: string | null;
}

export function levelFor(totalXp: number): ExplorerLevel {
  const xp = Math.max(0, totalXp);

  let current = EXPLORER_LEVELS[0]!;
  for (const candidate of EXPLORER_LEVELS) {
    if (xp >= candidate.minXp) current = candidate;
  }

  const next = EXPLORER_LEVELS.find((candidate) => candidate.minXp > xp);

  return {
    level: current.level,
    name: current.name,
    xpToNext: next ? next.minXp - xp : null,
    nextName: next ? next.name : null,
  };
}

/**
 * Cuanto vale cada cosa.
 *
 * Una leccion vale poco y una evaluacion aprobada vale mucho mas, a proposito:
 * si abrir contenido diera tanto XP como demostrar que se aprendio, el sistema
 * premiaria pasar paginas. La gamificacion tiene que empujar hacia donde esta el
 * aprendizaje, no hacia donde es facil sumar.
 */
export const XP_VALUES = {
  lesson_completed: 25,
  course_completed: 150,
  /** Solo al APROBAR, y solo la primera vez por evaluacion. Repetir un intento
   *  ya aprobado no vuelve a pagar: si lo hiciera, el camino optimo para subir
   *  de nivel seria reenviar la misma evaluacion, que no ensena nada. */
  assessment_passed: 100,
  challenge: 75,
} as const;

export type XpReason = keyof typeof XP_VALUES;

/**
 * Insignias que se pueden conceder solas, a partir de contadores.
 *
 * No se retiran nunca. Una insignia que aparece y desaparece -porque el alumno
 * bajo de una media- convierte un reconocimiento en un castigo, y a un nino de
 * ocho anos eso le ensena a no intentarlo.
 *
 * Se conceden por HITOS y no por comparacion con los demas. La propuesta del
 * cliente lo dice del ranking y vale igual aqui: se celebran logros, no se
 * senalan rezagos. Un alumno lento consigue las mismas insignias, mas tarde.
 */
export interface BadgeRule {
  code: string;
  name: string;
  category: 'participation' | 'performance' | 'creativity' | 'skill' | 'milestone';
  description: string;
  earned(stats: BadgeStats): boolean;
}

export interface BadgeStats {
  lessonsCompleted: number;
  coursesCompleted: number;
  assessmentsPassed: number;
  totalXp: number;
}

export const BADGE_RULES: readonly BadgeRule[] = [
  {
    code: 'first_steps',
    name: 'Primeros pasos',
    category: 'participation',
    description: 'Completaste tu primera lección.',
    earned: (s) => s.lessonsCompleted >= 1,
  },
  {
    code: 'builder_apprentice',
    name: 'Aprendiz constructor',
    category: 'skill',
    description: 'Completaste diez lecciones.',
    earned: (s) => s.lessonsCompleted >= 10,
  },
  {
    code: 'expert_builder',
    name: 'Constructor experto',
    category: 'skill',
    description: 'Completaste tu primer curso entero.',
    earned: (s) => s.coursesCompleted >= 1,
  },
  {
    code: 'initial_programmer',
    name: 'Programador inicial',
    category: 'performance',
    description: 'Aprobaste tres evaluaciones.',
    earned: (s) => s.assessmentsPassed >= 3,
  },
  {
    code: 'stem_master',
    name: 'Maestro STEM',
    category: 'milestone',
    description: 'Llegaste a 3500 puntos de experiencia.',
    earned: (s) => s.totalXp >= 3500,
  },
] as const;

/** Las insignias que le corresponden y todavia no tiene. */
export function newBadgesFor(stats: BadgeStats, alreadyHas: readonly string[]): BadgeRule[] {
  const owned = new Set(alreadyHas);
  return BADGE_RULES.filter((rule) => !owned.has(rule.code) && rule.earned(stats));
}

/**
 * Cuando se considera que un alumno "se descolgo".
 *
 * Catorce dias sin terminar nada. No es un numero arbitrario: por debajo de una
 * semana marca a cualquiera que se fue de viaje o estuvo enfermo, y el docente
 * deja de mirar la lista porque siempre esta llena. Por encima de tres semanas
 * el aviso llega cuando ya se perdio un mes de curso.
 *
 * Se cuenta desde la ULTIMA actividad y no desde la matricula: un alumno que
 * empezo tarde pero avanza no esta descolgado.
 */
export const STALE_AFTER_DAYS = 14;

export function isStale(lastActivity: Date | null, now: Date): boolean {
  if (!lastActivity) return true;
  const days = (now.getTime() - lastActivity.getTime()) / 86_400_000;
  return days >= STALE_AFTER_DAYS;
}
