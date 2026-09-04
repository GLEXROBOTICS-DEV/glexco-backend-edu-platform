import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERMISSIONS } from '@glexco/contracts';
import { RequirePermissions, zodBody, type RequestActor } from '@glexco/nest-platform';
import { getRequestContext } from '@glexco/observability';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  ArchiveAnnouncementUseCase,
  AskQuestionUseCase,
  ReplyToPostUseCase,
  ListMyAnnouncementsUseCase,
  PublishAnnouncementUseCase,
} from '../../application/announcements.usecase';

const askSchema = z.object({
  classroomId: z.string().uuid(),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(4000),
});

const replySchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

const publishSchema = z.object({
  classroomId: z.string().uuid(),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(1).max(4000),
  pinned: z.boolean().default(false),
});

/**
 * Contexto de ejecucion a partir de la peticion.
 *
 * El actor sale SIEMPRE del token verificado y nunca del cuerpo: si se aceptara
 * del cuerpo, cualquiera publicaria anuncios firmados por otro docente.
 */
function contextFrom(request: Request): UseCaseContext {
  const header = request.headers['accept-language'];
  const locale = typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';
  const actor = (request as Request & { actor?: RequestActor }).actor;

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
    locale,
    requestedAt: new Date(),
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

@Controller({ path: 'announcements', version: '1' })
export class AnnouncementsController {
  constructor(
    private readonly publish: PublishAnnouncementUseCase,
    private readonly listMine: ListMyAnnouncementsUseCase,
    private readonly archive: ArchiveAnnouncementUseCase,
    private readonly ask_: AskQuestionUseCase,
    private readonly reply_: ReplyToPostUseCase,
  ) {}

  /**
   * Los anuncios que le tocan a quien pregunta.
   *
   * Sin parametro de alcance: el ambito lo decide el token. Aceptar un
   * `studentId` o un `teacherId` permitiria leer los anuncios del salon de
   * cualquiera; el filtro opcional por salon se comprueba contra los salones que
   * ya son suyos.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENT_READ)
  async mine(@Query('classroomId') classroomId: string | undefined, @Req() request: Request) {
    return this.listMine.execute(
      classroomId ? { classroomId } : {},
      contextFrom(request),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENT_PUBLISH)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodBody(publishSchema)) input: z.infer<typeof publishSchema>,
    @Req() request: Request,
  ) {
    return this.publish.execute(input, contextFrom(request));
  }

  /**
   * Archiva un anuncio.
   *
   * `DELETE` en la ruta porque es lo que espera quien consume la API, pero por
   * dentro archiva: un anuncio que desaparece deja al alumno sin poder comprobar
   * lo que se le pidio y al docente sin poder demostrar que lo dijo.
   */
  @Delete(':announcementId')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENT_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('announcementId') announcementId: string, @Req() request: Request) {
    await this.archive.execute({ announcementId }, contextFrom(request));
  }

  /**
   * Un alumno pregunta a su salon.
   *
   * Va con `ANNOUNCEMENT_READ` y no con `ANNOUNCEMENT_PUBLISH`: publicar avisos
   * es del docente, y preguntar lo puede hacer cualquiera que este en el salon.
   * Es el caso de uso quien comprueba la matricula, que es la condicion real.
   */
  @Post('questions')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENT_READ)
  @HttpCode(HttpStatus.CREATED)
  async ask(
    @Body(zodBody(askSchema)) input: z.infer<typeof askSchema>,
    @Req() request: Request,
  ) {
    return this.ask_.execute(input, contextFrom(request));
  }

  /** Responder en el muro. Lo hace el docente y tambien los companeros. */
  @Post(':announcementId/replies')
  @RequirePermissions(PERMISSIONS.ANNOUNCEMENT_READ)
  @HttpCode(HttpStatus.CREATED)
  async reply(
    @Param('announcementId') announcementId: string,
    @Body(zodBody(replySchema)) input: z.infer<typeof replySchema>,
    @Req() request: Request,
  ) {
    return this.reply_.execute({ announcementId, body: input.body }, contextFrom(request));
  }
}
