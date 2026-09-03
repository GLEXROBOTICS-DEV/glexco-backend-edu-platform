import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  PERMISSIONS,
  activationCodeSchema,
  generateCodeBatchSchema,
  listBatchCodesSchema,
  listCodeBatchesSchema,
  publishContentSchema,
  revokeActivationCodeSchema,
  uuidSchema,
  type GenerateCodeBatchRequest,
  type ListBatchCodesQuery,
  type ListCodeBatchesQuery,
  type PublishContentRequest,
  type RevokeActivationCodeRequest,
} from '@glexco/contracts';
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
import {
  GenerateCodeBatchUseCase,
  GetCodeBatchUseCase,
  ListCodeBatchesUseCase,
} from '../../application/generate-code-batch.usecase';
import {
  ListBatchCodesUseCase,
  RevokeActivationCodeUseCase,
} from '../../application/revoke-activation-code.usecase';
import { PublishContentUseCase } from '../../application/publish-content.usecase';
import type { EntitlementRepository, KitRepository } from '../../domain/repositories';
import { CONTENT_REPOSITORY, ENTITLEMENT_REPOSITORY, KIT_REPOSITORY } from '../../tokens';

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
    // Los tres siguientes son puertos del dominio, no clases: su tipo se borra
    // al compilar y Nest solo puede resolverlos por token explicito.
    @Inject(ENTITLEMENT_REPOSITORY) private readonly entitlements: EntitlementRepository,
    @Inject(KIT_REPOSITORY) private readonly kits: KitRepository,
    @Inject(CONTENT_REPOSITORY) private readonly content: {
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
/**
 * `VERSION_NEUTRAL`: la API interna lleva su version en la propia ruta
 * (`internal/v1/...`). Sin esto, el versionado por URI de Nest anade ademas su
 * propio segmento y la ruta real pasa a ser `/api/v1/internal/v1/...`, que no
 * es la que llaman los otros servicios: el resultado era un 404 que el
 * consumidor interpretaba como "ese codigo no existe".
 */
@Controller({ path: 'internal/v1/activation-codes', version: VERSION_NEUTRAL })
@UseGuards(InternalOnlyGuard)
export class InternalActivationCodesController {
  constructor(private readonly precheck: PrecheckActivationCodeUseCase) {}

  @Get(':code/precheck')
  @Public()
  async check(@Param('code') code: string) {
    return this.precheck.execute({ code });
  }
}


// ---------------------------------------------------------------------------
// Lotes de codigos para imprenta
// ---------------------------------------------------------------------------

/**
 * Fabricacion y seguimiento de tiradas de codigos.
 *
 * Es personal de GLEXCO, no del colegio: `ACTIVATION_CODE_GENERATE` solo la
 * tienen `platform_admin` y `platform_owner`. Un administrador de institucion
 * puede consultar cuantos codigos de su pedido se han activado, pero no
 * fabricar mas.
 */
@Controller({ path: 'catalog/batches', version: '1' })
export class CodeBatchesController {
  constructor(
    private readonly generate: GenerateCodeBatchUseCase,
    private readonly getBatch: GetCodeBatchUseCase,
    private readonly listBatches: ListCodeBatchesUseCase,
    private readonly listCodes: ListBatchCodesUseCase,
  ) {}

  /**
   * Genera una tirada y devuelve los codigos EN CLARO, una sola vez.
   *
   * Con `format=csv` la respuesta es el fichero que se envia a imprenta. No hay
   * endpoint para volver a descargarlo: en la base solo queda el hash de cada
   * codigo, asi que reconstruirlo es imposible por diseno. Es deliberado -un
   * volcado de la tabla no debe convertirse en miles de accesos vendibles- y
   * por eso la respuesta lo advierte de forma explicita.
   */
  @Post()
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_GENERATE)
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @Body(zodBody(generateCodeBatchSchema)) input: GenerateCodeBatchRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.generate.execute(
      {
        kitId: input.kitId,
        size: input.size,
        distributedTo: input.distributedTo,
        reference: input.reference,
        expiresAt: input.expiresAt,
      },
      contextFrom(request),
    );

    if (input.format === 'csv') {
      response.setHeader('content-type', 'text/csv; charset=utf-8');
      response.setHeader(
        'content-disposition',
        `attachment; filename="glexco-lote-${result.batchId}.csv"`,
      );
      // Sin cache en ningun punto intermedio: el cuerpo son codigos en claro.
      response.setHeader('cache-control', 'no-store');
      return toCsv(result);
    }

    return {
      ...result,
      aviso:
        'Estos codigos no volveran a mostrarse. Guardalos ahora: en la base solo queda su hash.',
    };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_READ)
  async list(@Query(zodQuery(listCodeBatchesSchema)) query: ListCodeBatchesQuery) {
    return this.listBatches.execute({ limit: query.limit, cursor: query.cursor });
  }

  /** Cuantos codigos del lote se han activado. La pregunta comercial real. */
  @Get(':batchId')
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_READ)
  async summary(@Param('batchId') batchId: string) {
    return this.getBatch.execute({ batchId });
  }

  /**
   * Codigos del lote, por sufijo.
   *
   * Es como soporte localiza la fila que hay que anular: el cliente lee los
   * cuatro ultimos caracteres de su libro y aqui se encuentra. El codigo
   * completo no aparece porque no existe en la base.
   */
  @Get(':batchId/codes')
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_READ)
  async codes(
    @Param('batchId') batchId: string,
    @Query(zodQuery(listBatchCodesSchema)) query: ListBatchCodesQuery,
  ) {
    return this.listCodes.execute({
      batchId,
      page: { limit: query.limit, cursor: query.cursor },
    });
  }
}

/**
 * Publicacion y retirada de contenido.
 *
 * Es del equipo academico de GLEXCO (`content_manager` y por encima), no del
 * colegio: lo que se publica aqui lo ven todos los alumnos que tengan el kit.
 *
 * Cada cambio invalida la cache del kit por etiqueta. Sin eso, publicar una
 * leccion tardaria en verse lo que durase el TTL, y -peor- archivar contenido
 * lo dejaria visible mientras tanto: alguien lo habria retirado creyendo que ya
 * no se ve.
 */
@Controller({ path: 'catalog/content', version: '1' })
export class ContentPublicationController {
  constructor(private readonly publish: PublishContentUseCase) {}

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.CONTENT_PUBLISH)
  @HttpCode(HttpStatus.OK)
  async changeStatus(
    @Param('id') id: string,
    @Body(zodBody(publishContentSchema)) input: PublishContentRequest,
    @Req() request: Request,
  ) {
    return this.publish.execute(
      { target: input.target, id, status: input.status },
      contextFrom(request),
    );
  }
}

/**
 * Anulacion de codigos.
 *
 * Va en su propio controlador y no junto a los lotes porque su permiso es otro:
 * `ACTIVATION_CODE_REVOKE` retira acceso ya pagado, mientras que
 * `ACTIVATION_CODE_READ` solo mira. Mezclarlos invitaria a conceder los dos
 * juntos por comodidad.
 */
@Controller({ path: 'catalog/activation-codes', version: '1' })
export class ActivationCodesController {
  constructor(private readonly revoke: RevokeActivationCodeUseCase) {}

  /**
   * Anula un codigo y, si estaba canjeado, retira el acceso que concedio.
   *
   * Las dos cosas ocurren en la misma transaccion: anular sin retirar deja al
   * alumno viendo contenido de un libro devuelto, y retirar sin anular permite
   * volver a canjearlo.
   */
  @Post(':activationCodeId/revoke')
  @RequirePermissions(PERMISSIONS.ACTIVATION_CODE_REVOKE)
  @HttpCode(HttpStatus.OK)
  async revokeCode(
    @Param('activationCodeId') activationCodeId: string,
    @Body(zodBody(revokeActivationCodeSchema)) input: RevokeActivationCodeRequest,
    @Req() request: Request,
  ) {
    return this.revoke.execute({ activationCodeId, reason: input.reason }, contextFrom(request));
  }
}

/**
 * CSV para la imprenta.
 *
 * Se antepone un BOM porque Excel en Windows -que es donde se abre este fichero-
 * interpreta un CSV sin BOM como Latin-1 y destroza cualquier tilde del nombre
 * del kit. Y los campos se citan siempre: el nombre de un kit puede llevar una
 * coma y partiria la fila en dos.
 */
function toCsv(result: {
  batchId: string;
  kitCode?: string;
  kitName: string;
  grade: string;
  codes: string[];
}): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const lines = [['codigo', 'lote', 'kit', 'grado'].join(',')];

  for (const code of result.codes) {
    lines.push(
      [quote(code), quote(result.batchId), quote(result.kitName), quote(result.grade)].join(','),
    );
  }

  return `\ufeff${lines.join('\r\n')}\r\n`;
}
