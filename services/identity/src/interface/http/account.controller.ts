import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  changePasswordRequestSchema,
  createStaffUserSchema,
  revokeSessionSchema,
  PERMISSIONS,
  type ChangePasswordRequest,
  type CreateStaffUserInput,
} from '@glexco/contracts';
import { CurrentActor, RequirePermissions, zodBody, type RequestActor } from '@glexco/nest-platform';
import { ChangePasswordUseCase } from '../../application/change-password.usecase';
import { CreateStaffUserUseCase } from '../../application/create-staff-user.usecase';
import {
  ListSessionsUseCase,
  RevokeSessionUseCase,
} from '../../application/manage-sessions.usecase';
import { UpdatePreferencesUseCase } from '../../application/update-preferences.usecase';
import { contextFrom } from './auth.controller';

/**
 * Solo el idioma, y validado contra los dos que existen.
 *
 * Se comprueba aqui y no solo en el objeto de valor porque un valor invalido
 * tiene que responder 422 con el campo, no un error de dominio generico.
 */
const updateLocaleSchema = z.object({ locale: z.enum(['es', 'en']) });

/**
 * Operaciones sobre la propia cuenta y alta de usuarios de personal.
 *
 * Va separado de `AuthController` porque todo lo de aqui exige estar
 * autenticado, mientras que aquel es mayoritariamente publico. Tenerlos juntos
 * obligaria a marcar rutas con `@Public()` de forma dispersa, que es como se
 * acaba dejando abierta una que no debia.
 */
@Controller({ path: 'account', version: '1' })
export class AccountController {
  constructor(
    private readonly changePassword: ChangePasswordUseCase,
    private readonly listSessions: ListSessionsUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
    private readonly updatePreferences: UpdatePreferencesUseCase,
  ) {}

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async change(
    @Body(zodBody(changePasswordRequestSchema)) input: ChangePasswordRequest,
    @Req() request: Request,
  ): Promise<void> {
    await this.changePassword.execute(input, contextFrom(request));
  }

  /** Sesiones activas del usuario, para "cerrar sesion en otros dispositivos". */
  /**
   * Cambia el idioma de la cuenta.
   *
   * En el PERFIL y no en una cookie: es el idioma que deciden los correos, asi
   * que con cookie un alumno lo pondria en ingles y seguiria recibiendo los
   * avisos en espanol sin entender por que.
   */
  @Post('locale')
  @HttpCode(HttpStatus.NO_CONTENT)
  async locale(
    @Body(zodBody(updateLocaleSchema)) input: { locale: string },
    @Req() request: Request,
  ): Promise<void> {
    await this.updatePreferences.execute(input, contextFrom(request));
  }

  @Get('sessions')
  async sessions(@Req() request: Request) {
    return this.listSessions.execute(undefined, contextFrom(request));
  }

  /**
   * Cierra una sesion propia, o todas menos la actual si no se indica cual.
   *
   * Nunca cierra la sesion desde la que se llama cuando no se especifica id:
   * un usuario que pulsa "cerrar las demas sesiones" no espera quedar fuera.
   */
  @Delete('sessions')
  async revoke(
    @Body(zodBody(revokeSessionSchema)) input: { sessionId?: string },
    @Req() request: Request,
  ) {
    return this.revokeSession.execute(input, contextFrom(request));
  }
}

/**
 * Alta de usuarios de personal.
 *
 * El guard comprueba el permiso; el caso de uso comprueba el AMBITO (que un
 * administrador del colegio A no cree docentes en el colegio B) y la matriz de
 * creacion de roles. Los tres controles son necesarios y ninguno sustituye a
 * los otros.
 */
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly createStaffUser: CreateStaffUserUseCase) {}

  @Post('staff')
  @RequirePermissions(PERMISSIONS.USER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Body(zodBody(createStaffUserSchema)) input: CreateStaffUserInput,
    @Req() request: Request,
  ) {
    const result = await this.createStaffUser.execute(input, contextFrom(request));

    // La contrasena temporal se devuelve UNA sola vez, a quien crea la cuenta.
    // No se guarda en claro ni se vuelve a mostrar; si se pierde, hay que
    // restablecerla.
    return {
      ...result,
      aviso:
        'Entrega esta contrasena temporal al usuario por un canal seguro. No volvera a mostrarse.',
    };
  }

  /** Datos del actor autenticado, resueltos desde el token sin tocar la base. */
  @Get('me')
  me(@CurrentActor() actor: RequestActor) {
    return {
      userId: actor.userId,
      roles: actor.roles,
      permissions: actor.permissions,
      institutionId: actor.institutionId ?? null,
      locale: actor.locale,
    };
  }
}
