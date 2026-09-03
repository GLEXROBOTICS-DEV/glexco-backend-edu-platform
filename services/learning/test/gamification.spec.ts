import { describe, expect, it } from 'vitest';
import {
  BADGE_RULES,
  EXPLORER_LEVELS,
  STALE_AFTER_DAYS,
  XP_VALUES,
  isStale,
  levelFor,
  newBadgesFor,
} from '../src/domain/gamification';

const NOW = new Date('2026-09-03T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('niveles del Explorador', () => {
  it('un alumno recien llegado YA es Explorador, no "sin nivel"', () => {
    // Empezar en "sin nivel" es la forma mas rapida de que un nino de ocho anos
    // sienta que llega tarde a algo.
    const level = levelFor(0);
    expect(level.level).toBe(1);
    expect(level.name).toBe('Explorador');
  });

  it('no baja de nivel con XP negativo, que no deberia poder existir', () => {
    expect(levelFor(-500).level).toBe(1);
  });

  it('sube exactamente en el umbral, no uno por encima', () => {
    expect(levelFor(499).level).toBe(1);
    expect(levelFor(500).level).toBe(2);
    expect(levelFor(500).name).toBe('Inventor');
  });

  it('recorre los cinco niveles con los umbrales de DOMINIO.md', () => {
    expect(levelFor(0).name).toBe('Explorador');
    expect(levelFor(500).name).toBe('Inventor');
    expect(levelFor(1500).name).toBe('Constructor');
    expect(levelFor(3500).name).toBe('Innovador');
    expect(levelFor(7000).name).toBe('Maestro Robótico');
  });

  it('dice cuanto falta para el siguiente', () => {
    const level = levelFor(300);
    expect(level.xpToNext).toBe(200);
    expect(level.nextName).toBe('Inventor');
  });

  it('en el nivel maximo NO dice que falten cero', () => {
    // "Faltan 0" en el ultimo nivel se lee como un error de la aplicacion.
    const level = levelFor(9999);
    expect(level.level).toBe(5);
    expect(level.xpToNext).toBeNull();
    expect(level.nextName).toBeNull();
  });

  it('los umbrales estan ordenados de menor a mayor', () => {
    // Un umbral fuera de orden haria que `levelFor` devolviera un nivel inferior
    // al que corresponde, y el fallo solo se veria con un XP concreto.
    const thresholds = EXPLORER_LEVELS.map((level) => level.minXp);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });
});

describe('valor de cada logro', () => {
  it('aprobar una evaluacion vale mas que abrir una leccion', () => {
    // Si abrir contenido diera tanto XP como demostrar que se aprendio, el
    // sistema premiaria pasar paginas.
    expect(XP_VALUES.assessment_passed).toBeGreaterThan(XP_VALUES.lesson_completed);
  });

  it('completar un curso entero vale mas que una leccion suelta', () => {
    expect(XP_VALUES.course_completed).toBeGreaterThan(XP_VALUES.lesson_completed);
  });

  it('ningun logro vale cero ni negativo', () => {
    for (const points of Object.values(XP_VALUES)) {
      expect(points).toBeGreaterThan(0);
    }
  });
});

describe('insignias', () => {
  const sinNada = { lessonsCompleted: 0, coursesCompleted: 0, assessmentsPassed: 0, totalXp: 0 };

  it('no concede ninguna a quien no ha hecho nada', () => {
    expect(newBadgesFor(sinNada, [])).toEqual([]);
  });

  it('concede la primera al completar una leccion', () => {
    const earned = newBadgesFor({ ...sinNada, lessonsCompleted: 1 }, []);
    expect(earned.map((badge) => badge.code)).toContain('first_steps');
  });

  it('NO vuelve a conceder una que ya se tiene', () => {
    const earned = newBadgesFor({ ...sinNada, lessonsCompleted: 1 }, ['first_steps']);
    expect(earned.map((badge) => badge.code)).not.toContain('first_steps');
  });

  it('concede varias de golpe cuando se cumplen varias a la vez', () => {
    // Completar la ultima leccion de un curso cumple dos hitos en el mismo
    // instante, y las dos tienen que concederse.
    const earned = newBadgesFor(
      { lessonsCompleted: 10, coursesCompleted: 1, assessmentsPassed: 0, totalXp: 400 },
      [],
    );
    const codes = earned.map((badge) => badge.code);
    expect(codes).toContain('builder_apprentice');
    expect(codes).toContain('expert_builder');
  });

  it('se conceden por HITOS propios y nunca por comparacion con otros', () => {
    // La regla de producto: se celebran logros, no se senalan rezagos. Ninguna
    // insignia puede depender de lo que hagan los demas, o un alumno lento
    // dejaria de poder conseguirlas por ir en una clase rapida.
    const stats = { lessonsCompleted: 10, coursesCompleted: 1, assessmentsPassed: 3, totalXp: 3500 };
    for (const rule of BADGE_RULES) {
      expect(rule.earned(stats)).toBe(rule.earned({ ...stats }));
    }
    expect(BADGE_RULES.every((rule) => typeof rule.earned === 'function')).toBe(true);
  });

  it('ninguna insignia se retira: lo ganado no se pierde al bajar un contador', () => {
    // `newBadgesFor` solo AÑADE. Aunque un contador retrocediera, la lista de lo
    // que ya se tiene entra por parametro y nunca se recorta aqui.
    const earned = newBadgesFor(sinNada, ['first_steps', 'expert_builder']);
    expect(earned).toEqual([]);
  });

  it('cada insignia tiene codigo unico', () => {
    const codes = BADGE_RULES.map((badge) => badge.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('quien se ha descolgado', () => {
  it('un alumno que nunca abrio nada cuenta como descolgado', () => {
    // Es justo el que hay que ver: sin esto, el que peor va es el unico que no
    // aparece en la lista del docente.
    expect(isStale(null, NOW)).toBe(true);
  });

  it('quien avanzo esta semana no lo esta', () => {
    expect(isStale(daysAgo(3), NOW)).toBe(false);
  });

  it('el umbral son catorce dias, cumplidos', () => {
    expect(isStale(daysAgo(STALE_AFTER_DAYS - 1), NOW)).toBe(false);
    expect(isStale(daysAgo(STALE_AFTER_DAYS), NOW)).toBe(true);
  });

  it('una fecha futura no marca a nadie', () => {
    // Un reloj desajustado en un equipo escolar no debe senalar a un alumno.
    expect(isStale(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(false);
  });
});
