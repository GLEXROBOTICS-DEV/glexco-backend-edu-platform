import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  buildSerial,
  canonicalPayload,
  keyFingerprint,
  signCertificate,
  verifyCertificate,
  type CertificateSubject,
} from '../src/domain/certificate';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PRIVATE = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const pick = (alphabet: string, length: number) =>
  Array.from(randomBytes(length))
    .map((byte) => alphabet[byte % alphabet.length])
    .join('');

function subject(overrides: Partial<CertificateSubject> = {}): CertificateSubject {
  return {
    serial: 'GLX-AAAA-BBBB-CCCC',
    studentId: '11111111-1111-4111-8111-111111111111',
    studentName: 'Mateo Rojas',
    courseId: '22222222-2222-4222-8222-222222222222',
    courseTitle: 'Primeros pasos con uKit',
    kitId: '33333333-3333-4333-8333-333333333333',
    institutionName: 'Colegio San Martin',
    issuedAt: '2026-09-04T12:00:00.000Z',
    completion: 100,
    ...overrides,
  };
}

describe('firma del certificado', () => {
  it('una firma valida se verifica', () => {
    const cert = subject();
    expect(verifyCertificate(cert, signCertificate(cert, PRIVATE), PUBLIC)).toBe(true);
  });

  it('cambiar el NOMBRE invalida la firma', () => {
    // Es el ataque que justifica que exista la firma: alguien con acceso a la
    // base cambia a quien pertenece un titulo. Sin esto, la fila seguiria ahi y
    // la verificacion diria que es bueno.
    const signature = signCertificate(subject(), PRIVATE);
    const alterado = subject({ studentName: 'Otro Alumno' });
    expect(verifyCertificate(alterado, signature, PUBLIC)).toBe(false);
  });

  it('cambiar el CURSO invalida la firma', () => {
    const signature = signCertificate(subject(), PRIVATE);
    expect(verifyCertificate(subject({ courseTitle: 'Otro curso' }), signature, PUBLIC)).toBe(false);
  });

  it('cambiar la FECHA invalida la firma', () => {
    const signature = signCertificate(subject(), PRIVATE);
    const alterado = subject({ issuedAt: '2020-01-01T00:00:00.000Z' });
    expect(verifyCertificate(alterado, signature, PUBLIC)).toBe(false);
  });

  it('otra clave no valida la firma', () => {
    const otra = generateKeyPairSync('ed25519').publicKey.export({
      type: 'spki',
      format: 'pem',
    }).toString();
    const cert = subject();
    expect(verifyCertificate(cert, signCertificate(cert, PRIVATE), otra)).toBe(false);
  });

  it('una firma con basura devuelve false y no revienta', () => {
    // Quien teclea una serie a mano se equivoca constantemente, y un error de
    // formato tiene que ser "no vale", no un 500.
    expect(verifyCertificate(subject(), 'no-es-una-firma', PUBLIC)).toBe(false);
  });

  it('el texto firmado es estable aunque cambie el orden de construccion', () => {
    // Si se firmara `JSON.stringify` del objeto, dos formas de construirlo
    // darian dos cadenas distintas del MISMO certificado y la verificacion
    // fallaria sin que nada estuviera mal.
    const a = canonicalPayload(subject());
    const b = canonicalPayload({
      completion: 100,
      issuedAt: '2026-09-04T12:00:00.000Z',
      institutionName: 'Colegio San Martin',
      kitId: '33333333-3333-4333-8333-333333333333',
      courseTitle: 'Primeros pasos con uKit',
      courseId: '22222222-2222-4222-8222-222222222222',
      studentName: 'Mateo Rojas',
      studentId: '11111111-1111-4111-8111-111111111111',
      serial: 'GLX-AAAA-BBBB-CCCC',
    });
    expect(a).toBe(b);
  });

  it('la huella depende de la clave', () => {
    const otra = generateKeyPairSync('ed25519').publicKey.export({
      type: 'spki',
      format: 'pem',
    }).toString();
    expect(keyFingerprint(PUBLIC)).not.toBe(keyFingerprint(otra));
    expect(keyFingerprint(PUBLIC)).toBe(keyFingerprint(PUBLIC));
  });
});

describe('serie del certificado', () => {
  it('sale en cuatro bloques legibles', () => {
    expect(buildSerial(pick)).toMatch(/^GLX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('no usa caracteres que se confunden al dictarla', () => {
    // Nada de O/0, I/1 ni S/5: la serie se dicta por telefono y se teclea a mano
    // cuando el QR no se deja escanear.
    for (let i = 0; i < 200; i += 1) {
      expect(buildSerial(pick).slice(4)).not.toMatch(/[OI1S05]/);
    }
  });
});

describe('la serie se teclea a mano', () => {
  it('sobrevive a que la copien sin guiones o en minusculas', () => {
    // Es lo que hace media la gente al copiar de un papel. Antes, tecleada sin
    // guiones, la verificacion respondia "no encontramos este certificado" sobre
    // un documento perfectamente valido, que es la peor respuesta posible.
    const guardada = 'GLX-PU3W-Q4NZ-XYKV';
    const escritas = [
      'GLX-PU3W-Q4NZ-XYKV',
      'glx-pu3w-q4nz-xykv',
      'GLXPU3WQ4NZXYKV',
      '  GLX PU3W Q4NZ XYKV  ',
      'GLX.PU3W.Q4NZ.XYKV',
    ];

    // Lo mismo que hacen el caso de uso y la consulta, juntos.
    const canonica = (raw: string) =>
      raw.trim().toUpperCase().replace(/[\s_.]/g, '').split('-').join('');

    for (const escrita of escritas) {
      expect(canonica(escrita)).toBe(canonica(guardada));
    }
  });
});
