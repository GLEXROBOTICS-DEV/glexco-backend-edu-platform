import {
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import {
  isCompletable,
  viewMission,
  type Mission,
  type MissionView,
  type StudentFacts,
} from '../domain/mission';
import type { GamificationRepository, MissionRepository } from '../domain/repositories';

export interface MissionProgressItem {
  missionId: string;
  weekNumber: number;
  title: string;
  description: string;
  xpReward: number;
  state: MissionView['state'];
  /** Objetivos cumplidos de los que pide. La pantalla dice "2 de 3". */
  met: number;
  total: number;
  objectives: { kind: string; target: number; current: number; done: boolean }[];
  opensAt: string | null;
  closesAt: string | null;
  completedAt: string | null;
  onTime: boolean | null;
  /** `true` si esta ejecucion acaba de darla por completada. Permite a la
   *  pantalla celebrarlo una vez y no en cada carga. */
  justCompleted: boolean;
}

export interface MyMissionsOutput {
  items: MissionProgressItem[];
  /** Cuando empezo el alumno en el kit; `null` si todavia no ha tocado nada. */
  startedAt: string | null;
  /** XP cobrada por misiones en esta ejecucion. Cero casi siempre. */
  awardedXp: number;
}

/**
 * Mis misiones de un kit, con su avance.
 *
 * **Evalua y paga en el mismo paso, y esa es la decision del archivo.** La
 * alternativa era un consumidor que reevaluara todas las misiones del alumno
 * cada vez que completa una leccion o aprueba una evaluacion; con ocho millones
 * de alumnos, eso es reabrir N misiones por cada hecho del sistema para que
 * casi ninguna cambie. Aqui se calcula al leer -que es cuando alguien mira- y si
 * los objetivos ya estan cumplidos se anota la recompensa.
 *
 * Lo que hace que esto sea seguro y no una chapuza: `xp_awards` es idempotente
 * por (alumno, motivo, referencia), asi que abrir la pantalla cien veces paga
 * una. Y como el total se recalcula desde esa tabla, no hay contador que se
 * pueda inflar.
 *
 * La contrapartida se asume y se dice: un alumno que cumple los objetivos y
 * nunca abre sus misiones no ve su XP hasta que las abra. Su progreso -lecciones
 * y evaluaciones- ya esta contado; lo que espera es solo el premio de la mision,
 * y aparece en el mismo sitio donde se mira.
 */
export class MyMissionsUseCase implements UseCase<{ kitId: string }, MyMissionsOutput> {
  constructor(
    private readonly missions: MissionRepository,
    private readonly gamification: GamificationRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
    private readonly uuid: () => string,
  ) {}

  async execute(input: { kitId: string }, context: ExecutionContext): Promise<MyMissionsOutput> {
    // El alcance sale del token y nunca de un parametro: aceptar un `studentId`
    // convertiria esta pantalla en la de cualquier alumno de la plataforma.
    const studentId = context.actor!.userId;
    const now = this.clock.now();

    const [published, facts, completions] = await Promise.all([
      this.missions.publishedForKit(input.kitId, context.actor!.institutionId ?? null),
      this.missions.factsFor(studentId, input.kitId),
      this.missions.completionsFor(studentId),
    ]);

    const views = published.map((mission) =>
      viewMission(mission, facts, completions.get(mission.id) ?? null, now),
    );

    // Las que acaban de cumplirse se cobran. Casi siempre es una lista vacia:
    // solo entra la primera vez que se cumple cada mision.
    const pendientes = views.filter((view) => isCompletable(view, now));
    const cobradas = pendientes.length > 0 ? await this.pay(studentId, pendientes, now) : new Set<string>();

    const items = views.map((view) => this.toItem(view, cobradas, now));
    const awardedXp = views
      .filter((view) => cobradas.has(view.mission.id))
      .reduce((sum, view) => sum + view.mission.xpReward, 0);

    return {
      items,
      startedAt: facts.startedAt ? facts.startedAt.toISOString() : null,
      awardedXp,
    };
  }

  /**
   * Anota la recompensa de las misiones cumplidas.
   *
   * En UNA transaccion con el refresco del resumen: si se pagara fuera, un fallo
   * entre las dos escrituras dejaria XP concedida y un total que no la incluye,
   * y el alumno veria su nivel bajar al recargar.
   */
  private async pay(
    studentId: string,
    views: MissionView[],
    now: Date,
  ): Promise<Set<string>> {
    const cobradas = new Set<string>();

    await this.unitOfWork.run(async (tx) => {
      for (const view of views) {
        const nueva = await this.gamification.award({
          id: this.uuid(),
          studentId,
          reason: 'mission_completed',
          reference: view.mission.id,
          points: view.mission.xpReward,
          now,
          tx,
        });

        // `false` = ya estaba concedida. Pasa cuando dos pestanas abren la
        // pantalla a la vez, y no es un error: la garantia esta en la base.
        if (nueva) cobradas.add(view.mission.id);
      }

      if (cobradas.size > 0) await this.gamification.refreshSummary(studentId, tx);
    });

    if (cobradas.size > 0) {
      this.logger.info('Misiones completadas', {
        studentId,
        missions: [...cobradas],
      });
    }

    return cobradas;
  }

  private toItem(view: MissionView, cobradas: Set<string>, now: Date): MissionProgressItem {
    const justCompleted = cobradas.has(view.mission.id);

    // Si se acaba de cobrar, se devuelve ya como completada: el estado calculado
    // decia `current` porque en ese momento no habia fecha de cobro, y devolver
    // eso obligaria al alumno a recargar para ver lo que acaba de conseguir.
    const completedAt = justCompleted ? now : view.completedAt;

    return {
      missionId: view.mission.id,
      weekNumber: view.mission.weekNumber,
      title: view.mission.title,
      description: view.mission.description,
      xpReward: view.mission.xpReward,
      state: justCompleted ? 'completed' : view.state,
      met: view.met,
      total: view.mission.objectives.length,
      objectives: view.progress.map((entry) => ({
        kind: entry.objective.kind,
        target: entry.objective.target,
        current: entry.current,
        done: entry.done,
      })),
      opensAt: view.opensAt ? view.opensAt.toISOString() : null,
      closesAt: view.closesAt ? view.closesAt.toISOString() : null,
      completedAt: completedAt ? completedAt.toISOString() : null,
      onTime:
        completedAt && view.closesAt ? completedAt <= view.closesAt : completedAt ? true : null,
      justCompleted,
    };
  }
}

export type { Mission, StudentFacts };
