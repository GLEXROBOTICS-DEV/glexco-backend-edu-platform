import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  type ExecutionContext,
  type LoggerPort,
  type UseCase,
} from '@glexco/kernel';
import { PERMISSIONS } from '@glexco/contracts';
import {
  buildSerial,
  canonicalPayload,
  keyFingerprint,
  signCertificate,
  verifyCertificate,
  type CertificateSubject,
} from '../domain/certificate';
import type { CertificateRepository, CertificateRow } from '../domain/repositories';

export interface CertificateKeys {
  privateKeyPem: string;
  publicKeyPem: string;
}

function actorOf(context: ExecutionContext) {
  const actor = context.actor;
  if (!actor) throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
  return actor;
}

// ---------------------------------------------------------------------------

export interface IssueCertificateInput {
  studentId: string;
  courseId: string;
}

export interface IssuedCertificate {
  id: string;
  serial: string;
  studentName: string;
  courseTitle: string;
  issuedAt: string;
  /** `true` si ya existia. La emision es idempotente. */
  alreadyIssued: boolean;
}

/**
 * Emite el certificado de un curso terminado.
 *
 * **Se comprueba que el curso este COMPLETO, y se comprueba aqui.** No basta con
 * que lo pida un docente: un certificado emitido a quien no termino el curso no
 * es un favor, es un documento falso con nuestra firma. La comprobacion mira el
 * progreso real, no un campo que venga en la peticion.
 *
 * Es idempotente. La emision masiva se lanza varias veces -el docente pulsa dos
 * veces, o se reintenta tras un fallo de red-, y cada pasada no puede producir
 * una tanda de duplicados con series distintas, todos validos y todos del mismo
 * curso.
 */
export class IssueCertificateUseCase
  implements UseCase<IssueCertificateInput, IssuedCertificate>
{
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly keys: CertificateKeys,
    private readonly ids: () => string,
    private readonly pick: (alphabet: string, length: number) => string,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: IssueCertificateInput,
    context: ExecutionContext,
  ): Promise<IssuedCertificate> {
    const actor = actorOf(context);

    // Un alumno puede pedir el SUYO; para el de otro hace falta permiso de
    // gestion. Sin esta rama, cualquiera con sesion emitiria certificados a
    // nombre de cualquier otro.
    const isOwn = actor.userId === input.studentId;
    if (!isOwn && !actor.permissions.includes(PERMISSIONS.PROGRESS_READ_CLASSROOM)) {
      throw new ForbiddenError(
        'CERTIFICATE_NOT_ALLOWED',
        'No puedes emitir certificados de otro alumno.',
      );
    }

    const existing = await this.certificates.findActive(input.studentId, input.courseId);
    if (existing) {
      return {
        id: existing.id,
        serial: existing.serial,
        studentName: existing.studentName,
        courseTitle: existing.courseTitle,
        issuedAt: existing.issuedAt,
        alreadyIssued: true,
      };
    }

    const completion = await this.certificates.eligibility(input.studentId, input.courseId);
    if (!completion) {
      throw new NotFoundError('COURSE_NOT_FOUND', 'No encontramos ese curso para este alumno.');
    }

    // Sin nombre NO se emite. Un certificado a nombre de nadie no sirve para lo
    // unico que sirve un certificado, que es ensenarselo a alguien; y una vez
    // firmado no se puede corregir, hay que anularlo y emitir otro. Esto ya
    // estaba escrito en un comentario y no se cumplia: el primero que se emitio
    // en produccion salio con el nombre vacio.
    if (!completion.studentName.trim()) {
      throw new BusinessRuleError(
        'STUDENT_NAME_UNKNOWN',
        'Todavia no sabemos el nombre de este alumno. Intentalo en unos minutos.',
      );
    }

    if (completion.lessonsCompleted < completion.lessonCount || completion.lessonCount === 0) {
      throw new BusinessRuleError(
        'COURSE_NOT_COMPLETED',
        'El curso todavia no esta completo. El certificado se emite al terminarlo.',
        {
          lessonsCompleted: completion.lessonsCompleted,
          lessonCount: completion.lessonCount,
        },
      );
    }

    const subject: CertificateSubject = {
      serial: buildSerial(this.pick),
      studentId: input.studentId,
      // Congelado al emitir: si se leyera al verificar, un cambio de nombre
      // posterior invalidaria la firma de un papel que ya esta impreso.
      studentName: completion.studentName,
      courseId: input.courseId,
      courseTitle: completion.courseTitle,
      kitId: completion.kitId,
      institutionName: completion.institutionName,
      issuedAt: new Date().toISOString(),
      completion: 100,
    };

    const signature = signCertificate(subject, this.keys.privateKeyPem);

    const row: CertificateRow = {
      id: this.ids(),
      ...subject,
      signature,
      keyFingerprint: keyFingerprint(this.keys.publicKeyPem),
      issuedBy: actor.userId,
      revokedAt: null,
      revokedReason: null,
    };

    await this.certificates.insert(row);

    this.logger.info('Certificado emitido', { serial: row.serial, courseId: input.courseId });

    return {
      id: row.id,
      serial: row.serial,
      studentName: row.studentName,
      courseTitle: row.courseTitle,
      issuedAt: row.issuedAt,
      alreadyIssued: false,
    };
  }
}

// ---------------------------------------------------------------------------

/**
 * Emision masiva por salon.
 *
 * Emite a **todos los que han terminado** y no falla si alguno no ha terminado:
 * devuelve el reparto. Una emision masiva que se cae entera porque un alumno de
 * treinta va por la mitad obliga al docente a mirar uno por uno, que es
 * exactamente lo que venia a evitar.
 */
export class IssueClassroomCertificatesUseCase
  implements
    UseCase<
      { classroomId: string; courseId: string },
      { issued: IssuedCertificate[]; notReady: number }
    >
{
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly issue: IssueCertificateUseCase,
  ) {}

  async execute(
    input: { classroomId: string; courseId: string },
    context: ExecutionContext,
  ): Promise<{ issued: IssuedCertificate[]; notReady: number }> {
    const actor = actorOf(context);
    if (!actor.permissions.includes(PERMISSIONS.PROGRESS_READ_CLASSROOM)) {
      throw new ForbiddenError(
        'CERTIFICATE_NOT_ALLOWED',
        'No puedes emitir certificados de este salon.',
      );
    }

    const students = await this.certificates.classroomStudents(input.classroomId);

    const issued: IssuedCertificate[] = [];
    let notReady = 0;

    // En serie y no en paralelo: son treinta como mucho, cada una escribe, y
    // lanzarlas todas a la vez contra el mismo indice unico produce conflictos
    // que habria que distinguir de los errores de verdad.
    for (const studentId of students) {
      try {
        issued.push(
          await this.issue.execute({ studentId, courseId: input.courseId }, context),
        );
      } catch (error) {
        // Solo se traga "no ha terminado": cualquier otro fallo si sube, porque
        // silenciarlo dejaria al docente creyendo que emitio treinta cuando la
        // base estaba caida.
        const code = (error as { code?: string } | null)?.code;
        if (code === 'COURSE_NOT_COMPLETED') {
          notReady += 1;
          continue;
        }
        throw error;
      }
    }

    return { issued, notReady };
  }
}

// ---------------------------------------------------------------------------

export interface VerificationResult {
  valid: boolean;
  /** Por que no vale, cuando no vale. */
  reason: 'not_found' | 'revoked' | 'tampered' | null;
  certificate: {
    serial: string;
    studentName: string;
    courseTitle: string;
    institutionName: string | null;
    issuedAt: string;
    keyFingerprint: string;
  } | null;
}

/**
 * Verificacion PUBLICA, sin sesion.
 *
 * Quien recibe un certificado no tiene cuenta en la plataforma, y exigirle una
 * convierte la verificacion en algo que nadie hace. Por eso esta ruta es
 * publica.
 *
 * **Solo devuelve lo que ya esta impreso en el papel** que esa persona tiene
 * delante: nombre, curso, colegio y fecha. Nada del alumno que no estuviera ya
 * ahi. Si devolviera su identificador, su correo o su progreso, esta ruta seria
 * una fuga de datos de menores a la que se accede probando series.
 */
export class VerifyCertificateUseCase implements UseCase<{ serial: string }, VerificationResult> {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly keys: CertificateKeys,
  ) {}

  async execute(input: { serial: string }): Promise<VerificationResult> {
    // Mayusculas y sin espacios. Los GUIONES no se tocan aqui -forman parte de
    // la serie guardada-: es el repositorio quien compara los dos lados sin
    // ellos, para que dé igual como la teclee quien la copia de un papel.
    const serial = input.serial.trim().toUpperCase().replace(/[\s_.]/g, '');
    const row = await this.certificates.findBySerial(serial);

    if (!row) return { valid: false, reason: 'not_found', certificate: null };

    const summary = {
      serial: row.serial,
      studentName: row.studentName,
      courseTitle: row.courseTitle,
      institutionName: row.institutionName,
      issuedAt: row.issuedAt,
      keyFingerprint: row.keyFingerprint,
    };

    if (row.revokedAt) return { valid: false, reason: 'revoked', certificate: summary };

    // Se recomprueba la FIRMA y no solo que la fila exista. Si alguien con
    // acceso a la base cambia el nombre del alumno de una fila, la fila sigue
    // ahi y sin esta comprobacion la verificacion diria que el documento es
    // bueno. Es justo el ataque contra el que existe la firma.
    const ok = verifyCertificate(
      {
        serial: row.serial,
        studentId: row.studentId,
        studentName: row.studentName,
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        kitId: row.kitId,
        institutionName: row.institutionName,
        issuedAt: row.issuedAt,
        completion: row.completion,
      },
      row.signature,
      this.keys.publicKeyPem,
    );

    return ok
      ? { valid: true, reason: null, certificate: summary }
      : { valid: false, reason: 'tampered', certificate: summary };
  }
}

// ---------------------------------------------------------------------------

/** Los certificados propios. El alcance lo decide el token, nunca un parametro. */
export class MyCertificatesUseCase implements UseCase<void, CertificateRow[]> {
  constructor(private readonly certificates: CertificateRepository) {}

  async execute(_input: void, context: ExecutionContext): Promise<CertificateRow[]> {
    return this.certificates.listByStudent(actorOf(context).userId);
  }
}

export { canonicalPayload };
