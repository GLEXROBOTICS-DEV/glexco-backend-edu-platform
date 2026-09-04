import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

/**
 * Certificado de finalizacion.
 *
 * Es el unico artefacto de esta plataforma que sale de ella: el alumno lo
 * ensena a un colegio, a un instituto o a una empresa, y quien lo recibe no
 * tiene por que confiar en nosotros. Todo lo de aqui gira alrededor de esa
 * frase.
 */

export interface CertificateSubject {
  /** Serie publica, la que va impresa y en el QR. */
  serial: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  kitId: string;
  institutionName: string | null;
  issuedAt: string;
  /** Porcentaje del curso completado al emitir. Siempre 100 hoy. */
  completion: number;
}

/**
 * Serie legible, no un UUID.
 *
 * Se dicta por telefono y se teclea a mano cuando el QR no se puede escanear
 * -papel arrugado, camara mala, certificado fotocopiado-, asi que se compone con
 * un alfabeto sin los caracteres que se confunden al leerlos: nada de O/0, I/1,
 * S/5. Es el mismo criterio que el de los codigos de activacion, y por la misma
 * razon.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';

/**
 * `pick` viene del generador CRIPTOGRAFICO del servicio, no de `Math.random`.
 *
 * La serie es lo unico que hay que conocer para consultar un certificado por su
 * ruta publica. Con un generador predecible, cualquiera podria enumerar los
 * certificados emitidos -y con ellos los nombres de menores y sus colegios-
 * probando series contiguas.
 */
export function buildSerial(pick: (alphabet: string, length: number) => string): string {
  const body = pick(ALPHABET, 12);
  return `GLX-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * El texto que se firma.
 *
 * **Canonico y explicito**, nunca `JSON.stringify` del objeto: el orden de las
 * claves de un objeto de JavaScript depende de como se construyo, asi que dos
 * ejecuciones podrian producir dos cadenas distintas del MISMO certificado y la
 * verificacion fallaria sin que nada estuviera mal.
 *
 * Cada campo va precedido de su nombre y separado por un caracter que no puede
 * aparecer dentro: sin eso, un alumno llamado "Ana|2026" podria construir dos
 * certificados distintos que producen el mismo texto firmado.
 */
export function canonicalPayload(subject: CertificateSubject): string {
  return [
    `serial=${subject.serial}`,
    `student=${subject.studentId}`,
    `name=${subject.studentName}`,
    `course=${subject.courseId}`,
    `title=${subject.courseTitle}`,
    `kit=${subject.kitId}`,
    `institution=${subject.institutionName ?? ''}`,
    `issued=${subject.issuedAt}`,
    `completion=${subject.completion}`,
  ].join('\n');
}

/**
 * Firma Ed25519, y no un HMAC.
 *
 * Con un HMAC, comprobar un certificado exige conocer el secreto, asi que el
 * unico que puede validarlo somos nosotros: el documento vale lo que valga
 * nuestra palabra y nuestro servidor encendido. Con una firma asimetrica,
 * cualquiera -una universidad, un empleador- puede verificarlo con la clave
 * PUBLICA, sin pedirnos permiso y sin que podamos negar despues haberlo emitido.
 *
 * Para un titulo que el alumno enseña fuera, esa diferencia es el producto.
 *
 * Ed25519 y no RSA: firmas de 64 bytes en vez de 256, que caben en un QR sin
 * convertirlo en una mancha ilegible al imprimirlo en un A4.
 */
export function signCertificate(subject: CertificateSubject, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  // Ed25519 firma el mensaje entero: el algoritmo va en `null` a proposito, no
  // por descuido. Pasar un digest aqui produce un error del propio Node.
  return sign(null, Buffer.from(canonicalPayload(subject), 'utf8'), key).toString('base64url');
}

export function verifyCertificate(
  subject: CertificateSubject,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(
      null,
      Buffer.from(canonicalPayload(subject), 'utf8'),
      key,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    // Una firma con formato invalido es un certificado invalido, no un error del
    // servidor: quien teclea una serie a mano se equivoca constantemente.
    return false;
  }
}

/**
 * Huella de la clave publica.
 *
 * Va impresa en el certificado para que quien lo verifique sepa CON QUE clave
 * comprobarlo. Sin ella, rotar la clave invalidaria en bloque todo lo emitido
 * antes, porque no habria forma de saber cual usar con cada documento.
 */
export function keyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}
