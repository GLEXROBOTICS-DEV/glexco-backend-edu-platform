import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERMISSIONS } from '@glexco/contracts';
import { Public, RequirePermissions, zodBody, type RequestActor } from '@glexco/nest-platform';
import { getRequestContext } from '@glexco/observability';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  CompleteLessonUseCase,
  GetClassroomProgressUseCase,
  GetMyProgressUseCase,
  StartLessonUseCase,
} from '../../application/progress.usecase';
import { MyMissionsUseCase } from '../../application/missions.usecase';
import { BADGE_RULES, EXPLORER_LEVELS } from '../../domain/gamification';
import {
  IssueCertificateUseCase,
  IssueClassroomCertificatesUseCase,
  MyCertificatesUseCase,
  VerifyCertificateUseCase,
} from '../../application/certificates.usecase';
import { CERTIFICATE_KEYS } from '../../tokens';
import type { CertificateKeyPair } from '../../certificate-keys';

function contextFrom(request: Request): UseCaseContext {
  const actor = (request as Request & { actor?: RequestActor }).actor;
  const header = request.headers['accept-language'];

  return {
    correlationId: getRequestContext()?.correlationId ?? randomUUID(),
    actor: actor
      ? {
          userId: actor.userId,
          roles: actor.roles,
          institutionId: actor.institutionId,
          permissions: actor.permissions,
          sessionId: actor.sessionId,
        }
      : undefined,
    locale: typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es',
    requestedAt: new Date(),
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

/** El curso y el kit NO se aceptan: los resuelve el servicio desde su propio
 *  directorio. Ver `StartLessonUseCase`. */
const startSchema = z.object({
  classroomId: z.string().uuid().nullish(),
});

const completeSchema = z.object({
  secondsSpent: z.coerce.number().int().min(0).max(4 * 3600).optional(),
});

@Controller({ path: 'learning', version: '1' })
export class LearningController {
  constructor(
    private readonly start: StartLessonUseCase,
    private readonly complete: CompleteLessonUseCase,
    private readonly myProgress: GetMyProgressUseCase,
    private readonly classroomProgress: GetClassroomProgressUseCase,
    private readonly myMissions: MyMissionsUseCase,
  ) {}

  /**
   * Abre una leccion.
   *
   * El `studentId` sale SIEMPRE del token y nunca del cuerpo: aceptarlo de la
   * peticion permitiria marcar lecciones -y cobrar XP- en nombre de otro.
   */
  @Post('lessons/:lessonId/start')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  @HttpCode(HttpStatus.OK)
  async startLesson(
    @Param('lessonId') lessonId: string,
    @Body(zodBody(startSchema)) input: z.infer<typeof startSchema>,
    @Req() request: Request,
  ) {
    return this.start.execute({ lessonId, ...input }, contextFrom(request));
  }

  @Post('lessons/:lessonId/complete')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  @HttpCode(HttpStatus.OK)
  async completeLesson(
    @Param('lessonId') lessonId: string,
    @Body(zodBody(completeSchema)) input: z.infer<typeof completeSchema>,
    @Req() request: Request,
  ) {
    return this.complete.execute({ lessonId, ...input }, contextFrom(request));
  }

  /**
   * Mis misiones de un kit, con su avance.
   *
   * El kit va en la ruta y el alumno NO: el alcance sale del token. Aceptar un
   * `studentId` convertiria esta pantalla en la de cualquier alumno de la
   * plataforma, y lo que hay detras es el progreso de un menor.
   *
   * **Es un `GET` que puede escribir**, y conviene saberlo: si los objetivos de
   * una mision ya estan cumplidos, esta llamada anota su XP. La alternativa era
   * un consumidor que reevaluara todas las misiones de un alumno con cada
   * leccion completada -N misiones reabiertas por cada hecho del sistema para
   * que casi ninguna cambie-. La escritura es idempotente por construccion:
   * `xp_awards` lo garantiza por (alumno, motivo, referencia).
   */
  @Get('missions/:kitId')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  async missions(@Param('kitId') kitId: string, @Req() request: Request) {
    return this.myMissions.execute({ kitId }, contextFrom(request));
  }

  /** El progreso propio. Sin parametro de alcance: lo decide el token. */
  @Get('me')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  async me(@Req() request: Request) {
    return this.myProgress.execute(undefined, contextFrom(request));
  }

  /**
   * Quien de mi salon se ha descolgado.
   *
   * NO es un ranking, y esa es la decision de producto que lo define. Devuelve
   * quien lleva tiempo sin avanzar -que es accionable- en vez de una lista
   * ordenada de mejor a peor, que solo senala. La propuesta del cliente ya lo
   * pide asi para el ranking, y entre menores vale igual: se celebran logros y
   * no se exponen rezagos.
   */
  @Get('classrooms/:classroomId')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_CLASSROOM)
  async classroom(@Param('classroomId') classroomId: string, @Req() request: Request) {
    return this.classroomProgress.execute({ classroomId }, contextFrom(request));
  }

  /**
   * El catalogo de niveles e insignias.
   *
   * Existe para que la pantalla pueda mostrar "que viene despues" sin llevar la
   * tabla copiada: si estuviera duplicada en el frontend, cambiar un umbral
   * exigiria dos despliegues coordinados y la copia del cliente quedaria mal
   * durante el hueco.
   */
  @Get('catalogue')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  catalogue() {
    return {
      levels: EXPLORER_LEVELS,
      badges: BADGE_RULES.map((badge) => ({
        code: badge.code,
        name: badge.name,
        category: badge.category,
        description: badge.description,
      })),
    };
  }
}

const issueCertificateSchema = z.object({
  courseId: z.string().uuid(),
  /** Solo lo usa quien emite para otro; un alumno lo omite. */
  studentId: z.string().uuid().optional(),
});

/**
 * Certificados de finalizacion.
 *
 * Va en su propio controlador y con su propio prefijo porque **una de sus rutas
 * es publica**: la verificacion. Mezclarla con el resto obligaria a razonar
 * ruta por ruta sobre cual exige token, y ahi es donde se abre una por
 * descuido.
 */
@Controller({ path: 'certificates', version: '1' })
export class CertificatesController {
  constructor(
    private readonly issue: IssueCertificateUseCase,
    private readonly issueClassroom: IssueClassroomCertificatesUseCase,
    private readonly verify: VerifyCertificateUseCase,
    private readonly mine: MyCertificatesUseCase,
    @Inject(CERTIFICATE_KEYS) private readonly keys: CertificateKeyPair | null,
  ) {}

  /**
   * Verificacion PUBLICA. Sin token.
   *
   * Devuelve `valid: false` con su motivo en vez de un 404: quien comprueba un
   * certificado necesita distinguir "esta serie no existe" -que huele a
   * falsificacion- de "existe pero se anulo", que es una decision del colegio.
   * Un 404 las confunde en una sola cosa.
   */
  @Public()
  @Get('verify/:serial')
  async verifySerial(@Param('serial') serial: string) {
    if (!this.keys) {
      throw new ServiceUnavailableException({
        code: 'CERTIFICATES_NOT_CONFIGURED',
        message: 'La verificacion de certificados no esta disponible en este despliegue.',
      });
    }
    return this.verify.execute({ serial });
  }

  /**
   * La clave PUBLICA de firma.
   *
   * Es lo que hace que un certificado valga fuera de aqui: con ella, cualquiera
   * comprueba la firma por su cuenta, sin preguntarnos y sin poder nosotros
   * negar despues haberlo emitido. Publicarla no debilita nada -para eso es
   * publica- y no publicarla convertiria la firma asimetrica en un HMAC caro.
   */
  @Public()
  @Get('public-key')
  publicKey() {
    if (!this.keys) {
      throw new ServiceUnavailableException({
        code: 'CERTIFICATES_NOT_CONFIGURED',
        message: 'Este despliegue no emite certificados.',
      });
    }
    return { algorithm: 'Ed25519', publicKeyPem: this.keys.publicKeyPem };
  }

  /** Mis certificados. El alcance lo decide el token, nunca un parametro. */
  @Get('me')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  async myCertificates(@Req() request: Request) {
    const items = await this.mine.execute(undefined, contextFrom(request));
    // La firma NO se devuelve aqui. En "mis certificados" no sirve para nada y
    // exponerla en un listado la deja en cualquier registro intermedio; quien
    // quiera comprobarla usa la ruta de verificacion con la serie.
    return {
      items: items.map(({ signature: _signature, ...rest }) => rest),
    };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  @HttpCode(HttpStatus.CREATED)
  async issueOne(
    @Body(zodBody(issueCertificateSchema)) body: { studentId?: string; courseId: string },
    @Req() request: Request,
  ) {
    this.assertConfigured();
    const context = contextFrom(request);
    return this.issue.execute(
      { studentId: body.studentId ?? context.actor!.userId, courseId: body.courseId },
      context,
    );
  }

  /** Emision masiva por salon. Docente o direccion. */
  @Post('classrooms/:classroomId')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_CLASSROOM)
  @HttpCode(HttpStatus.CREATED)
  async issueForClassroom(
    @Param('classroomId') classroomId: string,
    @Body(zodBody(z.object({ courseId: z.string().uuid() }))) body: { courseId: string },
    @Req() request: Request,
  ) {
    this.assertConfigured();
    return this.issueClassroom.execute(
      { classroomId, courseId: body.courseId },
      contextFrom(request),
    );
  }

  /**
   * Se corta ANTES de firmar.
   *
   * Sin esto, un despliegue sin claves produciria un error de criptografia al
   * intentar firmar con una cadena vacia, y en los registros apareceria como un
   * fallo del algoritmo en vez de "esto no esta configurado".
   */
  private assertConfigured(): void {
    if (this.keys) return;
    throw new ServiceUnavailableException({
      code: 'CERTIFICATES_NOT_CONFIGURED',
      message: 'Este despliegue no tiene configurada la firma de certificados.',
    });
  }
}
