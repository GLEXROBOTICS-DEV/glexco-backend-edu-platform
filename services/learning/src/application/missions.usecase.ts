import {
  BusinessRuleError,
  ForbiddenError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { ROLES } from '@glexco/contracts';
import {
  assertMissionIsUsable,
  isCompletable,
  viewMission,
  type Mission,
  type MissionObjective,
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

// ---------------------------------------------------------------------------
// Escribir una mision
// ---------------------------------------------------------------------------

export interface CreateMissionInput {
  kitId: string;
  weekNumber: number;
  title: string;
  description?: string | undefined;
  objectives: {
    kind: string;
    target: number;
    courseId?: string | null | undefined;
    assessmentId?: string | null | undefined;
  }[];
  xpReward: number;
}

/**
 * Crea o corrige una mision semanal.
 *
 * Era lo unico que faltaba de las misiones: el modelo estaba entero desde el
 * primer dia -incluido `origin`, porque el cliente ya dijo que institucion y
 * docentes podrian ajustarlas- y `assertMissionIsUsable` validaba sin que nadie
 * la llamara. Las misiones solo entraban por el sembrador, con acceso directo a
 * la base, asi que en un entorno donde PostgreSQL no esta expuesto -Railway- no
 * habia forma de publicar ninguna.
 *
 * **El origen se deduce de quien escribe, nunca del cuerpo.** Es la misma regla
 * que gobierna las evaluaciones: si viniera en la peticion, un administrador de
 * colegio podria publicar una mision como contenido de GLEXCO y colarla en
 * todos los colegios que tienen ese kit.
 *
 * Es idempotente por identificador para que se pueda sembrar: volver a
 * escribirla actualiza su texto y sus objetivos en vez de dejar dos misiones en
 * la misma semana.
 */
export class CreateMissionUseCase
  implements UseCase<CreateMissionInput, { missionId: string }>
{
  constructor(
    private readonly missions: MissionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly logger: LoggerPort,
    private readonly uuid: () => string,
  ) {}

  async execute(
    input: CreateMissionInput,
    context: ExecutionContext,
  ): Promise<{ missionId: string }> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
    }

    const esPlataforma = actor.roles.some(
      (role) =>
        role === ROLES.PLATFORM_OWNER ||
        role === ROLES.PLATFORM_ADMIN ||
        role === ROLES.CONTENT_MANAGER,
    );

    // Una mision de institucion sin institucion no tiene dueno, y una de GLEXCO
    // con institucion dejaria de ser comun a todos: los dos casos son datos
    // corruptos que despues nadie sabe interpretar.
    if (!esPlataforma && !actor.institutionId) {
      throw new ForbiddenError(
        'MISSION_INSTITUTION_REQUIRED',
        'Tu cuenta no pertenece a ninguna institucion.',
      );
    }

    const mission: Mission = {
      id: this.uuid(),
      kitId: input.kitId,
      origin: esPlataforma ? 'glexco' : 'institution',
      institutionId: esPlataforma ? null : (actor.institutionId ?? null),
      weekNumber: input.weekNumber,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      objectives: input.objectives.map((objective) => ({
        kind: objective.kind as MissionObjective['kind'],
        target: objective.target,
        courseId: objective.courseId ?? null,
        assessmentId: objective.assessmentId ?? null,
      })),
      xpReward: input.xpReward,
    };

    // La validacion del dominio, que hasta ahora no llamaba nadie. Cubre lo que
    // deja una mision imposible de completar: sin objetivos, con un objetivo de
    // aprobar una evaluacion que no dice cual, o sin recompensa.
    assertMissionIsUsable(mission);

    await this.unitOfWork.run(async (tx) => {
      await this.missions.save(mission, tx);
    });

    this.logger.info('Mision publicada', {
      missionId: mission.id,
      kitId: mission.kitId,
      origin: mission.origin,
      weekNumber: mission.weekNumber,
      correlationId: context.correlationId,
    });

    return { missionId: mission.id };
  }
}

export interface AuthoredMission {
  missionId: string;
  weekNumber: number;
  title: string;
  description: string;
  xpReward: number;
  origin: Mission['origin'];
  objectives: { kind: string; target: number }[];
  /** Si quien mira puede cambiarla. Una de GLEXCO se ve desde un colegio -sus
   *  alumnos la cumplen- pero no se edita, igual que el banco de evaluaciones. */
  editable: boolean;
}

/**
 * Las misiones que ya tiene un kit, para quien las escribe.
 *
 * No es la pantalla del alumno: aquella evalua objetivos y paga XP, y esta solo
 * enumera lo que hay. Existe para que la pantalla de autoria pueda **ensenar
 * las semanas ocupadas antes de crear otra**. Sin eso, la unica forma de saber
 * si la semana 3 ya tiene mision es publicar una segunda y verlas duplicadas,
 * que es exactamente lo que paso al sembrar los retos en produccion: la
 * comprobacion de "si ya existe, no lo repitas" preguntaba a un listado que
 * devolvia cero para el personal de plataforma.
 */
export class ListMissionsUseCase
  implements UseCase<{ kitId: string }, { items: AuthoredMission[] }>
{
  constructor(private readonly missions: MissionRepository) {}

  async execute(
    input: { kitId: string },
    context: ExecutionContext,
  ): Promise<{ items: AuthoredMission[] }> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
    }

    const esPlataforma = actor.roles.some(
      (role) =>
        role === ROLES.PLATFORM_OWNER ||
        role === ROLES.PLATFORM_ADMIN ||
        role === ROLES.CONTENT_MANAGER,
    );

    // El mismo alcance que ve el alumno: las de GLEXCO mas las de su colegio.
    // Reusarlo no es ahorro, es la garantia de que la pantalla de autoria no
    // ensene una mision que despues nadie va a cumplir porque cae fuera.
    const publicadas = await this.missions.publishedForKit(
      input.kitId,
      esPlataforma ? null : (actor.institutionId ?? null),
    );

    return {
      items: publicadas.map((mission) => ({
        missionId: mission.id,
        weekNumber: mission.weekNumber,
        title: mission.title,
        description: mission.description,
        xpReward: mission.xpReward,
        origin: mission.origin,
        objectives: mission.objectives.map((objective) => ({
          kind: objective.kind,
          target: objective.target,
        })),
        // Contenido de GLEXCO es el mismo para todos los colegios: cambiarlo
        // desde uno cambiaria la mision de todos, que es la invariante 8 del
        // banco de evaluaciones aplicada aqui.
        editable: esPlataforma || mission.origin === 'institution',
      })),
    };
  }
}
