import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERMISSIONS } from '@glexco/contracts';
import { RequirePermissions, zodBody, type RequestActor } from '@glexco/nest-platform';
import { getRequestContext } from '@glexco/observability';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  CompleteLessonUseCase,
  GetClassroomProgressUseCase,
  GetMyProgressUseCase,
  StartLessonUseCase,
} from '../../application/progress.usecase';
import { BADGE_RULES, EXPLORER_LEVELS } from '../../domain/gamification';

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
