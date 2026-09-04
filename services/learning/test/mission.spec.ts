import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@glexco/kernel';
import {
  OBJECTIVE_KINDS,
  assertMissionIsUsable,
  isCompletable,
  missionState,
  missionWindow,
  objectiveProgress,
  viewMission,
  type Mission,
  type StudentFacts,
} from '../src/domain/mission';

/**
 * Misiones semanales.
 *
 * Lo que se prueba aqui es lo que NO se puede probar mirando la pantalla: que la
 * ventana de cada mision se cuenta desde que el alumno empieza, que una vencida
 * sigue siendo hacible, y que ir por delante no permite cobrar cinco semanas de
 * golpe.
 */

const KIT = '11111111-1111-4111-8111-111111111111';
const CURSO = '22222222-2222-4222-8222-222222222222';
const EVAL = '33333333-3333-4333-8333-333333333333';

const LUNES = new Date('2026-09-07T09:00:00Z');

function mision(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-1',
    kitId: KIT,
    origin: 'glexco',
    institutionId: null,
    weekNumber: 1,
    title: 'Monta la base',
    description: 'Termina las dos primeras lecciones y aprueba su cuestionario.',
    objectives: [
      { kind: OBJECTIVE_KINDS.LESSONS_COMPLETED, target: 2, courseId: CURSO },
      { kind: OBJECTIVE_KINDS.ASSESSMENT_PASSED, target: 1, assessmentId: EVAL },
    ],
    xpReward: 120,
    ...overrides,
  };
}

function hechos(overrides: Partial<StudentFacts> = {}): StudentFacts {
  return {
    lessonsCompletedInKit: 0,
    lessonsCompletedByCourse: {},
    passedAssessmentIds: [],
    totalXp: 0,
    startedAt: LUNES,
    ...overrides,
  };
}

describe('Objetivos: se miden con lo que ya se observa', () => {
  it('cuenta las lecciones del curso indicado, no las del kit entero', () => {
    const facts = hechos({
      lessonsCompletedInKit: 9,
      lessonsCompletedByCourse: { [CURSO]: 2 },
    });

    expect(
      objectiveProgress({ kind: OBJECTIVE_KINDS.LESSONS_COMPLETED, target: 2, courseId: CURSO }, facts),
    ).toBe(2);

    // Sin curso, el kit entero: es el objetivo "avanza por donde quieras".
    expect(
      objectiveProgress({ kind: OBJECTIVE_KINDS.LESSONS_COMPLETED, target: 2 }, facts),
    ).toBe(9);
  });

  it('devuelve CUANTAS y no si o no: la pantalla dice "2 de 3"', () => {
    const facts = hechos({ lessonsCompletedByCourse: { [CURSO]: 2 } });
    const avance = objectiveProgress(
      { kind: OBJECTIVE_KINDS.LESSONS_COMPLETED, target: 3, courseId: CURSO },
      facts,
    );

    // Un alumno que lleva dos de tres necesita saber que le falta una, no que
    // ha fallado.
    expect(avance).toBe(2);
  });

  it('una evaluacion aprobada cuenta, y un reto aprobado tambien', () => {
    // Un reto corregido y aprobado deja la misma marca que un examen: por eso
    // no hace falta un tipo de objetivo aparte para los retos.
    const facts = hechos({ passedAssessmentIds: [EVAL] });
    expect(
      objectiveProgress({ kind: OBJECTIVE_KINDS.ASSESSMENT_PASSED, target: 1, assessmentId: EVAL }, facts),
    ).toBe(1);
  });

  it('un objetivo de evaluacion sin evaluacion no cumple, y NO revienta', () => {
    // Una mision mal capturada no puede tumbar la portada del alumno.
    const facts = hechos({ passedAssessmentIds: [EVAL] });
    expect(objectiveProgress({ kind: OBJECTIVE_KINDS.ASSESSMENT_PASSED, target: 1 }, facts)).toBe(0);
  });
});

describe('La ventana se cuenta desde que el alumno empieza', () => {
  it('la semana 1 abre con su primera actividad', () => {
    const { opensAt, closesAt } = missionWindow(mision({ weekNumber: 1 }), hechos());

    expect(opensAt?.toISOString()).toBe(LUNES.toISOString());
    expect(closesAt?.getTime()).toBe(LUNES.getTime() + 7 * 86_400_000);
  });

  it('la semana 3 abre dos semanas despues', () => {
    const { opensAt } = missionWindow(mision({ weekNumber: 3 }), hechos());
    expect(opensAt?.getTime()).toBe(LUNES.getTime() + 14 * 86_400_000);
  });

  it('sin actividad no hay ventana, y la primera mision esta lista', () => {
    // Quien compra el libro en mayo no puede abrir la plataforma con treinta
    // misiones vencidas y una pantalla que le dice que llega tarde a todo.
    const sinEmpezar = hechos({ startedAt: null });

    expect(missionWindow(mision(), sinEmpezar).opensAt).toBeNull();
    expect(missionState(mision({ weekNumber: 1 }), sinEmpezar, null, LUNES)).toBe('current');
    expect(missionState(mision({ weekNumber: 2 }), sinEmpezar, null, LUNES)).toBe('locked');
  });
});

describe('Estados: una mision vencida sigue siendo hacible', () => {
  const facts = hechos();

  it('la de esta semana esta en curso', () => {
    expect(missionState(mision({ weekNumber: 1 }), facts, null, LUNES)).toBe('current');
  });

  it('la de la semana que viene esta cerrada, pero se ensena', () => {
    expect(missionState(mision({ weekNumber: 2 }), facts, null, LUNES)).toBe('locked');
  });

  it('pasada su semana queda VENCIDA, no desaparece', () => {
    const dosSemanasDespues = new Date(LUNES.getTime() + 15 * 86_400_000);
    expect(missionState(mision({ weekNumber: 1 }), facts, null, dosSemanasDespues)).toBe('overdue');
  });

  it('y vencida se puede completar: no reprograma ni se cierra', () => {
    // Decision del cliente: no se toca el calendario. La mision queda pendiente
    // y se puede terminar tarde, igual que una evaluacion fuera de plazo.
    const tarde = new Date(LUNES.getTime() + 30 * 86_400_000);
    const cumplida = hechos({
      lessonsCompletedByCourse: { [CURSO]: 2 },
      passedAssessmentIds: [EVAL],
    });

    const vista = viewMission(mision({ weekNumber: 1 }), cumplida, null, tarde);

    expect(vista.state).toBe('overdue');
    expect(isCompletable(vista, tarde)).toBe(true);
  });

  it('completada manda sobre todo lo demas', () => {
    const tarde = new Date(LUNES.getTime() + 30 * 86_400_000);
    expect(missionState(mision({ weekNumber: 1 }), facts, tarde, tarde)).toBe('completed');
  });
});

describe('A tiempo se deriva, no se guarda', () => {
  const cumplida = hechos({
    lessonsCompletedByCourse: { [CURSO]: 2 },
    passedAssessmentIds: [EVAL],
  });

  it('dentro de su semana es a tiempo', () => {
    const elJueves = new Date(LUNES.getTime() + 3 * 86_400_000);
    expect(viewMission(mision(), cumplida, elJueves, elJueves).onTime).toBe(true);
  });

  it('fuera de su semana no lo es', () => {
    const tarde = new Date(LUNES.getTime() + 20 * 86_400_000);
    expect(viewMission(mision(), cumplida, tarde, tarde).onTime).toBe(false);
  });

  it('sin completar todavia no se afirma nada', () => {
    // `null` y no `false`: no haberla hecho aun no es haberla hecho tarde.
    expect(viewMission(mision(), cumplida, null, LUNES).onTime).toBeNull();
  });
});

describe('Completar: ni antes de tiempo ni a medias', () => {
  const cumplida = hechos({
    lessonsCompletedByCourse: { [CURSO]: 2 },
    passedAssessmentIds: [EVAL],
  });

  it('con los objetivos cumplidos y la semana abierta, se completa', () => {
    const vista = viewMission(mision({ weekNumber: 1 }), cumplida, null, LUNES);
    expect(vista.met).toBe(2);
    expect(isCompletable(vista, LUNES)).toBe(true);
  });

  it('un objetivo a medias NO la completa', () => {
    const aMedias = hechos({ lessonsCompletedByCourse: { [CURSO]: 2 } });
    const vista = viewMission(mision(), aMedias, null, LUNES);

    expect(vista.met).toBe(1);
    expect(isCompletable(vista, LUNES)).toBe(false);
  });

  it('ir por delante NO permite cobrar semanas futuras de golpe', () => {
    // Sin esto, un alumno que avanza rapido cobra las misiones de las cinco
    // semanas siguientes con el trabajo de esta, y una mision semanal que se
    // puede completar entera de una vez no es semanal.
    const vista = viewMission(mision({ weekNumber: 4 }), cumplida, null, LUNES);

    expect(vista.state).toBe('locked');
    expect(isCompletable(vista, LUNES)).toBe(false);
  });

  it('una ya completada no se vuelve a cobrar', () => {
    const vista = viewMission(mision(), cumplida, LUNES, LUNES);
    expect(isCompletable(vista, LUNES)).toBe(false);
  });

  it('una mision sin objetivos no se completa por vacia', () => {
    // `met >= objetivos.length` seria `0 >= 0` y la daria por hecha: se
    // comprueba aparte para que una mision mal capturada no regale XP.
    const vacia = viewMission(mision({ objectives: [] }), cumplida, null, LUNES);
    expect(isCompletable(vacia, LUNES)).toBe(false);
  });
});

describe('Validacion al capturar', () => {
  it('rechaza una mision sin objetivos', () => {
    expect(() => assertMissionIsUsable(mision({ objectives: [] }))).toThrow(BusinessRuleError);
  });

  it('rechaza la semana cero', () => {
    expect(() => assertMissionIsUsable(mision({ weekNumber: 0 }))).toThrow(/semana/i);
  });

  it('rechaza una recompensa de cero', () => {
    expect(() => assertMissionIsUsable(mision({ xpReward: 0 }))).toThrow(/puntos/i);
  });

  it('rechaza un objetivo de evaluacion que no dice cual', () => {
    // Se publica y no se puede completar nunca, y no se descubre hasta que un
    // salon entero se queda sin su XP.
    expect(() =>
      assertMissionIsUsable(
        mision({ objectives: [{ kind: OBJECTIVE_KINDS.ASSESSMENT_PASSED, target: 1 }] }),
      ),
    ).toThrow(/cual/i);
  });

  it('acepta la mision del kit tal como la escribe GLEXCO', () => {
    expect(() => assertMissionIsUsable(mision())).not.toThrow();
  });
});
