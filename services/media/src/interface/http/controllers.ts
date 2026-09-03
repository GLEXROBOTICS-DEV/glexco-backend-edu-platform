import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import {
  PERMISSIONS,
  requestUploadSchema,
  shareLinkSchema,
  type RequestUploadRequest,
  type ShareLinkRequest,
} from '@glexco/contracts';
import { RequirePermissions, zodBody } from '@glexco/nest-platform';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  ConfirmUploadUseCase,
  IssueDownloadUrlUseCase,
  RequestUploadUseCase,
  ShareLinkUseCase,
} from '../../application/upload.usecases';

function contextFrom(request: Request): UseCaseContext {
  const header = request.headers['accept-language'];
  const locale = typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';

  return {
    correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
    actor: request.actor
      ? {
          userId: request.actor.userId,
          roles: request.actor.roles,
          institutionId: request.actor.institutionId,
          permissions: request.actor.permissions,
          sessionId: request.actor.sessionId,
        }
      : undefined,
    locale,
    requestedAt: new Date(),
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

/**
 * Subidas y descargas de ficheros.
 *
 * El fichero nunca pasa por este servicio: el cliente sube directo al almacen
 * de objetos con una URL prefirmada, y descarga igual. Lo que hace este
 * controlador es decidir QUIEN puede subir o descargar QUE, y comprobar despues
 * que lo subido es lo que dijo ser.
 */
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(
    private readonly requestUpload: RequestUploadUseCase,
    private readonly confirmUpload: ConfirmUploadUseCase,
    private readonly issueDownload: IssueDownloadUrlUseCase,
    private readonly shareLink: ShareLinkUseCase,
  ) {}

  /**
   * Pide una URL para subir.
   *
   * La respuesta no significa que el fichero valga: hasta que no se confirma y
   * se miran sus bytes, la subida esta en `pending` y no se puede descargar.
   */
  @Post('uploads')
  @RequirePermissions(PERMISSIONS.MEDIA_UPLOAD)
  @HttpCode(HttpStatus.CREATED)
  async createUpload(
    @Body(zodBody(requestUploadSchema)) input: RequestUploadRequest,
    @Req() request: Request,
  ) {
    return this.requestUpload.execute(
      {
        scope: input.scope,
        mimeType: input.mimeType,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
      },
      contextFrom(request),
    );
  }

  /**
   * Confirma la subida y valida el tipo real.
   *
   * Devuelve 200 tanto si acepta como si rechaza: en los dos casos la operacion
   * se completo y el cliente necesita saber cual fue el resultado. Un 4xx aqui
   * invitaria a reintentar una subida que nunca va a ser aceptada.
   */
  @Post('uploads/:mediaAssetId/confirm')
  @RequirePermissions(PERMISSIONS.MEDIA_UPLOAD)
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('mediaAssetId') mediaAssetId: string, @Req() request: Request) {
    return this.confirmUpload.execute({ mediaAssetId }, contextFrom(request));
  }

  /**
   * Comparte material alojado fuera de la plataforma.
   *
   * Alternativa a subir, no sustituto: quien tenga el video en el movil lo sube
   * y va al proveedor; quien ya lo tenga publicado en el OneDrive de su centro
   * comparte el enlace y no se mueve un byte.
   */
  @Post('links')
  @RequirePermissions(PERMISSIONS.MEDIA_UPLOAD)
  @HttpCode(HttpStatus.CREATED)
  async createLink(
    @Body(zodBody(shareLinkSchema)) input: ShareLinkRequest,
    @Req() request: Request,
  ) {
    return this.shareLink.execute(input, contextFrom(request));
  }

  /** URL de descarga de vida corta. Los buckets son privados. */
  @Get(':mediaAssetId/url')
  @RequirePermissions(PERMISSIONS.MEDIA_READ)
  async downloadUrl(@Param('mediaAssetId') mediaAssetId: string, @Req() request: Request) {
    return this.issueDownload.execute({ mediaAssetId }, contextFrom(request));
  }
}
