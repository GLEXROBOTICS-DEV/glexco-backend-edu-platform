import { BusinessRuleError } from '@glexco/kernel';

/**
 * Misiones semanales.
 *
 * Una mision es un objetivo de la semana -"termina las tres lecciones del modulo
 * y aprueba su cuestionario"- que se mide con lo que la plataforma YA observa.
 *
 * **No hay progreso de mision guardado en ninguna parte, y es la decision que
 * define este archivo.** El avance se calcula de `lesson_progress` y de
 * `xp_awards`, que son los hechos. Una tabla `mission_progress` seria una
 * segunda copia de algo que ya esta escrito: habria que mantenerla al dia con
 * cada leccion completada, y el dia que se despegara del original nadie sabria
 * cual de las dos dice la verdad. Es el mismo criterio por el que `total_xp` se
 * recalcula desde `xp_awards` en vez de sumar incrementos.
 *
 * Lo unico que se guarda es la CONSECUENCIA: al completarla se anota su XP en
 * `xp_awards` con `reason = 'mission_completed'` y `reference = missionId`. Esa
 * tabla ya es idempotente por `(alumno, motivo, referencia)`, asi que una mision
 * no puede pagar dos veces ni hace falta inventar otra garantia.
 *
 * **Una mision vencida no reprograma nada.** Es una decision del cliente: queda
 * visible como pendiente y se puede completar tarde, igual que una evaluacion
 * fuera de plazo. Desplazar el calendario habria hecho que "a tiempo" dejara de
 * significar nada, y con ello el docente pierde la senal de quien se descolgo,
 * que es la razon de ser de este servicio.
 */

/**
 * Lo que una mision puede pedir.
 *
 * Los tres son observables SIN preguntarle a otro servicio: los dos primeros
 * salen de tablas de aprendizaje y el tercero de su propio resumen. Un objetivo
 * que necesitara consultar a evaluacion o a catalogo convertiria la pantalla de
 * misiones en una cadena de llamadas de red, y la portada es la que mas se abre.
 */
export const OBJECTIVE_KINDS = {
  /** Completar N lecciones del kit, o de un curso concreto si se indica. */
  LESSONS_COMPLETED: 'lessons_completed',
  /** Aprobar una evaluacion concreta. Cubre tambien los retos: un reto
   *  corregido y aprobado deja su marca en `xp_awards` igual que un examen. */
  ASSESSMENT_PASSED: 'assessment_passed',
  /** Acumular N puntos en total. Sirve para la mision "sigue como vas". */
  XP_EARNED: 'xp_earned',
} as const;

export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[keyof typeof OBJECTIVE_KINDS];

export interface MissionObjective {
  kind: ObjectiveKind;
  /** Cuantas veces. `1` en los que son de si o no. */
  target: number;
  /** Curso al que se limita, en `lessons_completed`. */
  courseId?: string | null;
  /** La evaluacion, en `assessment_passed`. */
  assessmentId?: string | null;
}

export interface Mission {
  id: string;
  kitId: string;
  /**
   * Quien la escribio.
   *
   * Hoy solo GLEXCO las publica y vienen con el kit, iguales para todos los
   * colegios que lo compraron. El campo existe desde el principio porque el
   * cliente ya dijo que mas adelante la institucion y el docente podran
   * ajustarlas: anadirlo despues obligaria a migrar filas y a decidir que era
   * lo ya escrito.
   */
  origin: 'glexco' | 'institution';
  /** `null` en las de GLEXCO: son de todos. */
  institutionId: string | null;
  /** Semana dentro del kit, empezando en 1. */
  weekNumber: number;
  title: string;
  description: string;
  objectives: MissionObjective[];
  xpReward: number;
}

/** Lo que la plataforma sabe del alumno, ya medido. */
export interface StudentFacts {
  /** Lecciones completadas del kit, en total. */
  lessonsCompletedInKit: number;
  /** Lecciones completadas por curso. */
  lessonsCompletedByCourse: Record<string, number>;
  /** Evaluaciones aprobadas, por id. */
  passedAssessmentIds: readonly string[];
  totalXp: number;
  /**
   * Cuando empezo el alumno en este kit. `null` si todavia no ha tocado nada.
   *
   * **Es la primera actividad y no la matricula.** Anclar en una fecha absoluta
   * -o en el inicio del curso escolar- haria que quien compra el libro en mayo
   * abriera la plataforma con treinta misiones vencidas y una pantalla que le
   * dice que llega tarde a todo. Anclado en su primera actividad, la semana 1
   * empieza cuando el empieza.
   */
  startedAt: Date | null;
}

export type MissionState = 'locked' | 'current' | 'completed' | 'overdue';

export interface MissionView {
  mission: Mission;
  state: MissionState;
  /** Objetivos cumplidos de los que pide. */
  met: number;
  /** El avance de cada objetivo, en el orden de la mision. */
  progress: { objective: MissionObjective; current: number; done: boolean }[];
  /** Cuando se completo, si se completo. */
  completedAt: Date | null;
  /** Si se completo DENTRO de su semana. Se deriva, no se guarda. */
  onTime: boolean | null;
  /** Ventana de la mision. `null` mientras el alumno no haya empezado. */
  opensAt: Date | null;
  closesAt: Date | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cuanto ha avanzado un objetivo.
 *
 * Devuelve el numero alcanzado, no un booleano, porque la pantalla dice "2 de 3"
 * y no "sin completar": un alumno que lleva dos de tres necesita saber que le
 * falta una, no que ha fallado.
 */
export function objectiveProgress(objective: MissionObjective, facts: StudentFacts): number {
  switch (objective.kind) {
    case OBJECTIVE_KINDS.LESSONS_COMPLETED:
      return objective.courseId
        ? (facts.lessonsCompletedByCourse[objective.courseId] ?? 0)
        : facts.lessonsCompletedInKit;

    case OBJECTIVE_KINDS.ASSESSMENT_PASSED:
      // Sin evaluacion declarada no se puede cumplir. No se lanza: una mision
      // mal capturada no debe tumbar la portada del alumno, solo quedarse sin
      // completar y ser visible para quien la escribio.
      if (!objective.assessmentId) return 0;
      return facts.passedAssessmentIds.includes(objective.assessmentId) ? 1 : 0;

    case OBJECTIVE_KINDS.XP_EARNED:
      return facts.totalXp;

    default:
      return 0;
  }
}

/**
 * La ventana de una mision para ESTE alumno.
 *
 * Semanas contadas desde su primera actividad en el kit. Sin actividad no hay
 * ventana: la semana 1 esta abierta y nada esta vencido, que es lo que tiene que
 * ver quien acaba de activar su libro.
 */
export function missionWindow(
  mission: Mission,
  facts: StudentFacts,
): { opensAt: Date | null; closesAt: Date | null } {
  if (!facts.startedAt) return { opensAt: null, closesAt: null };

  const inicio = facts.startedAt.getTime() + (mission.weekNumber - 1) * WEEK_MS;
  return { opensAt: new Date(inicio), closesAt: new Date(inicio + WEEK_MS) };
}

/**
 * Como esta una mision para este alumno.
 *
 * Cuatro estados y no dos, porque responden a cuatro preguntas distintas:
 *
 * - `completed`: ya esta, y se dice si fue a tiempo.
 * - `current`: es la de esta semana, o una anterior que sigue abierta porque no
 *   se completo. **Una mision vencida sigue siendo hacible**, y aparecer como
 *   `overdue` no la cierra.
 * - `overdue`: su semana paso y no se completo. Es informacion para el alumno y
 *   una senal para el docente, no un candado.
 * - `locked`: su semana aun no ha llegado. Se ENSENA igual, porque saber lo que
 *   viene es la mitad de para que existe una mision semanal; lo que no se puede
 *   es completarla antes de tiempo.
 */
export function missionState(
  mission: Mission,
  facts: StudentFacts,
  completedAt: Date | null,
  now: Date,
): MissionState {
  if (completedAt) return 'completed';

  const { opensAt, closesAt } = missionWindow(mission, facts);

  // Sin empezar: la primera esta lista y el resto espera.
  if (!opensAt || !closesAt) return mission.weekNumber === 1 ? 'current' : 'locked';

  if (now < opensAt) return 'locked';
  if (now <= closesAt) return 'current';
  return 'overdue';
}

/**
 * La mision con su avance, lista para pintar.
 *
 * Se calcula entera aqui y no en la consulta SQL a proposito: la regla de cuando
 * una mision esta cumplida es de negocio y tiene que poder probarse sin base de
 * datos. Repartirla entre un `CASE` de SQL y un `if` de TypeScript es como se
 * acaba con dos definiciones de "completada" que no coinciden.
 */
export function viewMission(
  mission: Mission,
  facts: StudentFacts,
  completedAt: Date | null,
  now: Date,
): MissionView {
  const progress = mission.objectives.map((objective) => {
    const current = objectiveProgress(objective, facts);
    return { objective, current, done: current >= objective.target };
  });

  const { opensAt, closesAt } = missionWindow(mission, facts);

  return {
    mission,
    state: missionState(mission, facts, completedAt, now),
    met: progress.filter((entry) => entry.done).length,
    progress,
    completedAt,
    // A tiempo se DERIVA de la fecha de cobro y la ventana. Guardarlo seria un
    // segundo sitio donde vive la misma verdad.
    onTime: completedAt && closesAt ? completedAt <= closesAt : completedAt ? true : null,
    opensAt,
    closesAt,
  };
}

/**
 * Si la mision se puede dar por completada AHORA.
 *
 * Exige los objetivos cumplidos Y que su semana haya abierto. Sin lo segundo,
 * un alumno que va muy por delante cobraria de golpe las misiones de las cinco
 * semanas siguientes con el trabajo de esta, y una mision semanal que se puede
 * completar toda de una vez no es semanal.
 */
export function isCompletable(view: MissionView, now: Date): boolean {
  if (view.state === 'completed') return false;
  if (view.met < view.mission.objectives.length) return false;
  if (view.mission.objectives.length === 0) return false;

  return view.opensAt === null ? view.mission.weekNumber === 1 : now >= view.opensAt;
}

/**
 * Comprueba una mision al capturarla.
 *
 * Se valida aqui ademas del esquema HTTP porque el banco de GLEXCO se siembra
 * por otro camino: una mision sin objetivos se publica y no se puede completar
 * nunca, y eso no se descubre hasta que un salon entero se queda sin su XP.
 */
export function assertMissionIsUsable(mission: Mission): void {
  if (mission.objectives.length === 0) {
    throw new BusinessRuleError(
      'MISSION_NEEDS_OBJECTIVES',
      'Una mision sin objetivos no se puede completar nunca.',
    );
  }

  if (mission.weekNumber < 1) {
    throw new BusinessRuleError('MISSION_WEEK_INVALID', 'La semana de una mision empieza en 1.');
  }

  if (mission.xpReward <= 0) {
    throw new BusinessRuleError(
      'MISSION_REWARD_INVALID',
      'Una mision tiene que dar mas de cero puntos.',
    );
  }

  for (const objective of mission.objectives) {
    if (objective.target < 1) {
      throw new BusinessRuleError(
        'MISSION_OBJECTIVE_TARGET_INVALID',
        'Un objetivo tiene que pedir al menos uno.',
      );
    }

    if (objective.kind === OBJECTIVE_KINDS.ASSESSMENT_PASSED && !objective.assessmentId) {
      throw new BusinessRuleError(
        'MISSION_OBJECTIVE_NEEDS_ASSESSMENT',
        'Un objetivo de aprobar una evaluacion tiene que decir cual.',
      );
    }
  }
}
