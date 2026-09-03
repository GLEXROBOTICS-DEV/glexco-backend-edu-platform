import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERMISSIONS, activationCodeSchema, uuidSchema } from '@glexco/contracts';
import {
  CurrentActor,
  InternalOnlyGuard,
  Public,
  RequirePermissions,
  zodBody,
  zodQuery,
  type RequestActor,
} from '@glexco/nest-platform';
import { ForbiddenError, type ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  PrecheckActivationCodeUseCase,
  RedeemActivationCodeUseCase,
} from '../../application/redeem-activation-code.usecase';
import type { EntitlementRepository, KitRepository } from '../../domain/repositories';

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

const redeemSchema = z.object({ code: activationCodeSchema });
const libraryQuerySchema = z.object({
  kitId: uuidSchema,
  locale: z.enum(['es', 'en']).default('es'),
  type: z.string().optional(),
  search: z.string().trim().max(80).optional(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(
    private readonly redeem: RedeemActivationCodeUseCase,
    private readonly entitlements: EntitlementRepository,
    private readonly kits: KitRepository,
    private readonly content: {
      listLibrary: (
        kitId: string,
        filters: { type?: never; locale: 'es' | 'en'; search?: string },
        page: { limit: number; cursor?: string },
      ) => Promise<unknown>;
      listCoursesByKit: (kitId: string, onlyPublished: boolean) => Promise<unknown>;
    },
  ) {}

  /**
   * Canje del codigo del libro por un alumno ya registrado.
   *
   * Existe ademas del canje que ocurre durante el registro porque un alumno
   * puede comprar un segundo kit mas adelante: un libro por grado significa un
   * canje nuevo cada curso.
   */
  @Post('redeem')
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_REDEEM)
  @HttpCode(HttpStatus.OK)
  async redeemCode(
    @Body(zodBody(redeemSchema)) input: { code: string },
    @Req() request: Request,
  ) {
    const context = contextFrom(request);
    return this.redeem.execute(
      {
        code: input.code,
        studentId: context.actor!.userId,
        institutionId: context.actor!.institutionId,
      },
      context,
    );
  }

  /**
   * Kits a los que el alumno tiene acceso.
   *
   * El `studentId` sale SIEMPRE del token, nunca de un parametro: aceptarlo de
   * la peticion permitiria a cualquiera listar el contenido de otro alumno.
   */
  @Get('my-kits')
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  async myKits(@CurrentActor() actor: RequestActor) {
    const entitlements = await this.entitlements.listActiveByStudent(actor.userId);

    const kits = await Promise.all(
      entitlements.map(async (entitlement) => {
        const kit = await this.kits.findById(entitlement.kitId);
        return kit
          ? {
              kitId: kit.id,
              name: kit.name,
              program: kit.program,
              grade: kit.grade,
              robotPlatforms: kit.robotPlatforms,
              coverImageKey: kit.coverImageKey,
              grantedAt: entitlement.grantedAt.toISOString(),
            }
          : null;
      }),
    );

    return { kits: kits.filter(Boolean) };
  }

  /**
   * Biblioteca multimedia de un kit.
   *
   * Comprueba el derecho ANTES de leer nada. Es la mitad que el guard no puede
   * hacer: el guard sabe que un alumno puede "leer contenido", pero solo aqui,
   * con el kit concreto delante, se sabe si ESE contenido es suyo.
   */
  @Get('library')
  @RequirePermissions(PERMISSIONS.CONTENT_READ)
  async library(
    @Query(zodQuery(libraryQuerySchema))
    query: { kitId: string; locale: 'es' | 'en'; type?: string; search?: string; cursor?: string; limit: number },
    @CurrentActor() actor: RequestActor,
  ) {
    const allowed = await this.entitlements.hasActiveForKit(actor.userId, query.kitId);
    if (!allowed) {
      // Mismo error que si el kit no existiera: distinguirlos permitiria a un
      // alumno averiguar que kits hay en el catalogo sondeando identificadores.
      throw new ForbiddenError('KIT_NOT_ACCESSIBLE', 'Este contenido no está en tu kit.');
    }

    return this.content.listLibrary(
      query.kitId,
      { locale: query.locale, search: query.search } as never,
      { limit: query.limit, cursor: query.cursor },
    );
  }

  @Get('kits/:kitId/courses')
  @RequirePermissions(PERMISSIONS.COURSE_READ)
  async courses(@Param('kitId') kitId: string, @CurrentActor() actor: RequestActor) {
    const allowed = await this.entitlements.hasActiveForKit(actor.userId, kitId);
    if (!allowed) {
      throw new ForbiddenError('KIT_NOT_ACCESSIBLE', 'Este contenido no está en tu kit.');
    }
    return { courses: await this.content.listCoursesByKit(kitId, true) };
  }
}

/**
 * Comprobacion previa que consulta el servicio de identidad durante el registro.
 *
 * Bajo `/internal`, fuera de la tabla de rutas del gateway y con el token
 * interno: dos barreras, no una.
 */
@Controller({ path: 'internal/v1/activation-codes' })
@UseGuards(InternalOnlyGuard)
export class InternalActivationCodesController {
  constructor(private readonly precheck: PrecheckActivationCodeUseCase) {}

  @Get(':code/precheck')
  @Public()
  async check(@Param('code') code: string) {
    return this.precheck.execute({ code });
  }
}
