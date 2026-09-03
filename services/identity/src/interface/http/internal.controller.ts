import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import { InternalOnlyGuard, Public, zodBody } from '@glexco/nest-platform';
import { NotFoundError } from '@glexco/kernel';
import { ONE_TIME_TOKENS, USER_REPOSITORY } from '../../tokens';
import type { OneTimeTokenStore } from '../../application/ports';
import type { UserRepository } from '../../domain/user/user.repository';
import { UserId } from '../../domain/user/value-objects';

/**
 * API interna: acuna el enlace de un solo uso en el momento de enviarlo.
 *
 * **Existe para que el token no viaje en un evento.** Un evento vive dias en la
 * outbox y en el stream de JetStream; un token de recuperacion de contrasena
 * escrito ahi convierte el acceso de lectura a una tabla —o a una copia de
 * seguridad— en el control de cualquier cuenta de la plataforma. Es el mismo
 * criterio por el que el codigo de activacion viaja como id de fila y no en
 * claro.
 *
 * Asi, el secreto cruza la red UNA vez, entre dos servicios internos, y no queda
 * escrito en ningun registro duradero. Y como efecto util, la vida del enlace
 * empieza cuando el correo sale: si el relevo de la outbox va retrasado, un
 * token embebido en el evento llegaria al buzon ya medio caducado.
 *
 * Bajo `/internal`, fuera de la tabla de rutas del gateway y con el token
 * interno: dos barreras, no una. Este endpoint entrega credenciales de acceso,
 * asi que exponerlo seria entregar la plataforma entera.
 */

const VERIFICATION_TTL_SECONDS = 48 * 3600;
/** Una hora: suficiente para leer el correo, corto si el buzon esta comprometido. */
const RESET_TTL_SECONDS = 3600;

const issueTokenSchema = z.object({
  userId: z.string().uuid(),
  purpose: z.enum(['email_verification', 'password_reset']),
});

@Controller({ path: 'internal/v1/one-time-tokens', version: VERSION_NEUTRAL })
@UseGuards(InternalOnlyGuard)
export class InternalTokensController {
  constructor(
    @Inject(ONE_TIME_TOKENS) private readonly tokens: OneTimeTokenStore,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async issue(@Body(zodBody(issueTokenSchema)) input: z.infer<typeof issueTokenSchema>) {
    // Se comprueba que el usuario existe ANTES de acunar. Sin esto, un evento
    // que sobrevive a la baja de una cuenta —la outbox tiene dias de retencion—
    // generaria un enlace valido para un usuario que ya no esta.
    const user = await this.users.findById(UserId.create(input.userId));
    if (!user) {
      throw new NotFoundError('USER_NOT_FOUND', 'El usuario indicado no existe.');
    }

    const ttlSeconds =
      input.purpose === 'password_reset' ? RESET_TTL_SECONDS : VERIFICATION_TTL_SECONDS;

    const { token } = await this.tokens.issue({
      purpose: input.purpose,
      userId: input.userId,
      ttlSeconds,
    });

    return { token, ttlSeconds };
  }
}
