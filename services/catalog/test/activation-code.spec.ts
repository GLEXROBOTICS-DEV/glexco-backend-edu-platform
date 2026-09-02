import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError } from '@glexco/kernel';
import { ACTIVATION_CODE_ALPHABET } from '@glexco/contracts';
import {
  ActivationCode,
  ActivationCodeId,
  ActivationCodeValue,
} from '../src/domain/activation-code/activation-code.aggregate';
import {
  generateActivationCode,
  generateBatch,
  hashActivationCode,
  suffixOf,
} from '../src/domain/activation-code/code-generator';

const NOW = new Date('2026-09-02T12:00:00Z');
const PEPPER = 'pimienta-de-prueba';
const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';

function makeCode(overrides: { expiresAt?: Date | null } = {}): ActivationCode {
  const code = generateActivationCode();
  return ActivationCode.issue({
    id: ActivationCodeId.create(),
    codeHash: hashActivationCode(code, PEPPER),
    codeSuffix: suffixOf(code),
    batchId: 'batch-1',
    kitId: 'kit-1',
    grade: 'primary_3',
    expiresAt: overrides.expiresAt ?? null,
    now: NOW,
  });
}

describe('ActivationCodeValue — formato pensado para copiarse de papel', () => {
  it('acepta el codigo con guiones, sin ellos y en minusculas', () => {
    const canonical = generateActivationCode().value;
    const formatted = ActivationCodeValue.create(canonical).formatted;

    // Las tres formas son el mismo codigo.
    expect(ActivationCodeValue.create(formatted).value).toBe(canonical);
    expect(ActivationCodeValue.create(formatted.toLowerCase()).value).toBe(canonical);
    expect(ActivationCodeValue.create(formatted.replace(/-/g, ' ')).value).toBe(canonical);
  });

  it('presenta el codigo en grupos legibles para imprimir', () => {
    const formatted = ActivationCodeValue.create('GLX' + 'ABCD2345EFGH').formatted;
    expect(formatted).toBe('GLX-ABCD-2345-EFGH');
  });

  it('el alfabeto excluye los caracteres que se confunden al transcribir', () => {
    // O/0, I/1 y L son los pares que un nino copia mal desde un libro.
    for (const ambiguous of ['O', '0', 'I', '1', 'L']) {
      expect(ACTIVATION_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('rechaza un codigo con un caracter fuera del alfabeto', () => {
    expect(() => ActivationCodeValue.create('GLX-ABCD-2345-EFGO')).toThrow(BusinessRuleError);
  });

  it('rechaza longitud incorrecta y prefijo ajeno', () => {
    expect(() => ActivationCodeValue.create('GLX-ABCD-2345')).toThrow(BusinessRuleError);
    expect(() => ActivationCodeValue.create('XXX-ABCD-2345-EFGH')).toThrow(BusinessRuleError);
  });
});

describe('Generacion de codigos', () => {
  it('genera codigos del alfabeto permitido y la longitud esperada', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateActivationCode();
      expect(code.value.startsWith('GLX')).toBe(true);
      expect(code.value).toHaveLength(15);
      for (const char of code.value.slice(3)) {
        expect(ACTIVATION_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('no repite codigos dentro de un lote', () => {
    const batch = generateBatch(2_000, PEPPER);
    expect(new Set(batch.map((item) => item.code.value)).size).toBe(2_000);
  });

  it('reparte los simbolos sin sesgo apreciable', () => {
    // Si se hubiese usado `bytes % alfabeto.length`, los primeros simbolos
    // saldrian notablemente mas a menudo y la entropia real seria menor.
    const counts = new Map<string, number>();
    for (const item of generateBatch(1_000, PEPPER)) {
      for (const char of item.code.value.slice(3)) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }

    const frequencies = [...counts.values()];
    const expected = (1_000 * 12) / ACTIVATION_CODE_ALPHABET.length;
    // Margen amplio: se busca detectar sesgo estructural, no ruido estadistico.
    expect(Math.min(...frequencies)).toBeGreaterThan(expected * 0.7);
    expect(Math.max(...frequencies)).toBeLessThan(expected * 1.3);
  });

  it('el hash depende de la pimienta', () => {
    // Robar la base no basta para reconstruir hashes si la pimienta vive en la
    // configuracion.
    const code = generateActivationCode();
    expect(hashActivationCode(code, 'pimienta-a')).not.toBe(hashActivationCode(code, 'pimienta-b'));
  });

  it('el hash es estable para el mismo codigo y pimienta', () => {
    const code = generateActivationCode();
    expect(hashActivationCode(code, PEPPER)).toBe(hashActivationCode(code, PEPPER));
  });

  it('rechaza tamanos de lote absurdos', () => {
    expect(() => generateBatch(0, PEPPER)).toThrow(RangeError);
    expect(() => generateBatch(200_000, PEPPER)).toThrow(RangeError);
  });
});

describe('ActivationCode — un solo uso', () => {
  it('canjea un codigo disponible y emite el evento', () => {
    const code = makeCode();

    code.redeem({ studentId: STUDENT_A, now: NOW });

    expect(code.status).toBe('redeemed');
    expect(code.redeemedBy).toBe(STUDENT_A);

    const [event] = code.pullDomainEvents();
    expect(event!.metadata.eventName).toBe('catalog.activation_code.redeemed.v1');
  });

  it('el evento NO lleva el codigo en claro', () => {
    // Los eventos viven dias en la outbox y en el stream: meter ahi un secreto
    // con valor economico multiplica la superficie de exposicion.
    const code = makeCode();
    code.redeem({ studentId: STUDENT_A, now: NOW });

    const payload = JSON.stringify(code.pullDomainEvents()[0]!.payload);
    expect(payload).not.toContain('GLX');
    expect(payload).toContain(STUDENT_A);
  });

  it('RECHAZA que un segundo alumno canjee el mismo codigo', () => {
    // Es la regla que sostiene el modelo de negocio: un libro, un acceso.
    const code = makeCode();
    code.redeem({ studentId: STUDENT_A, now: NOW });

    expect(() => code.redeem({ studentId: STUDENT_B, now: NOW })).toThrow(ConflictError);
    expect(code.redeemedBy).toBe(STUDENT_A);
  });

  it('es idempotente si reintenta el MISMO alumno', () => {
    // Cubre el reintento de red y el evento entregado dos veces por JetStream.
    const code = makeCode();
    code.redeem({ studentId: STUDENT_A, now: NOW });
    code.pullDomainEvents();

    expect(() => code.redeem({ studentId: STUDENT_A, now: NOW })).not.toThrow();
    // Sin segundo evento: el alumno no debe recibir dos veces el acceso.
    expect(code.pullDomainEvents()).toHaveLength(0);
  });

  it('rechaza un codigo caducado', () => {
    const code = makeCode({ expiresAt: new Date('2026-08-01T00:00:00Z') });
    expect(() => code.redeem({ studentId: STUDENT_A, now: NOW })).toThrow(ConflictError);
  });

  it('rechaza un codigo anulado', () => {
    const code = makeCode();
    code.revoke('error de impresion', 'admin-1', NOW);

    expect(() => code.redeem({ studentId: STUDENT_A, now: NOW })).toThrow(ConflictError);
  });

  it('distingue "ya usado" de los demas rechazos', () => {
    // Solo `already_redeemed` se le comunica al usuario de forma especifica,
    // porque es el unico caso en que puede hacer algo util: reclamar el libro.
    const usado = makeCode();
    usado.redeem({ studentId: STUDENT_A, now: NOW });
    const anulado = makeCode();
    anulado.revoke('devolucion', 'admin-1', NOW);
    const caducado = makeCode({ expiresAt: new Date('2026-08-01T00:00:00Z') });

    expect(usado.redeemabilityAt(NOW)).toEqual({ ok: false, reason: 'already_redeemed' });
    expect(anulado.redeemabilityAt(NOW)).toEqual({ ok: false, reason: 'revoked' });
    expect(caducado.redeemabilityAt(NOW)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('ActivationCode — anulacion', () => {
  it('anular un codigo ya canjeado informa del alumno afectado', () => {
    // Es lo que permite retirarle el acceso al kit.
    const code = makeCode();
    code.redeem({ studentId: STUDENT_A, now: NOW });
    code.pullDomainEvents();

    code.revoke('fraude detectado', 'admin-1', NOW);

    const [event] = code.pullDomainEvents();
    expect(event!.metadata.eventName).toBe('catalog.activation_code.revoked.v1');
    expect(event!.payload).toMatchObject({
      previouslyRedeemedBy: STUDENT_A,
      reason: 'fraude detectado',
    });
  });

  it('un codigo anulado NO vuelve a estar disponible', () => {
    // Un codigo que se libera despues de haberse usado es un agujero de
    // auditoria: no habria forma de saber cuantos accesos concedio.
    const code = makeCode();
    code.redeem({ studentId: STUDENT_A, now: NOW });
    code.revoke('devolucion', 'admin-1', NOW);

    expect(code.status).toBe('revoked');
    expect(() => code.redeem({ studentId: STUDENT_B, now: NOW })).toThrow(ConflictError);
  });

  it('anular es idempotente', () => {
    const code = makeCode();
    code.revoke('error', 'admin-1', NOW);
    code.pullDomainEvents();

    code.revoke('error', 'admin-1', NOW);
    expect(code.pullDomainEvents()).toHaveLength(0);
  });

  it('exige un motivo', () => {
    expect(() => makeCode().revoke('', 'admin-1', NOW)).toThrow();
  });
});

describe('ActivationCode — caducidad', () => {
  it('no caduca un codigo ya canjeado', () => {
    // El alumno ya tiene su acceso; la fecha limite era para canjearlo.
    const code = makeCode({ expiresAt: new Date('2026-09-03T00:00:00Z') });
    code.redeem({ studentId: STUDENT_A, now: NOW });

    code.expire(new Date('2026-10-01T00:00:00Z'));

    expect(code.status).toBe('redeemed');
  });

  it('caduca uno sin canjear pasada su fecha', () => {
    const code = makeCode({ expiresAt: new Date('2026-09-01T00:00:00Z') });
    code.expire(NOW);
    expect(code.status).toBe('expired');
  });

  it('un codigo sin fecha limite no caduca nunca', () => {
    const code = makeCode({ expiresAt: null });
    code.expire(new Date('2099-01-01T00:00:00Z'));
    expect(code.status).toBe('issued');
  });
});
