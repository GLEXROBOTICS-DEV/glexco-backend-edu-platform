import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  confirmPasswordResetSchema,
  loginSchema,
  requestPasswordResetSchema,
  studentRegistrationSchema,
  verifyEmailSchema,
  type LoginInput,
  type StudentRegistrationInput,
} from '@glexco/contracts';
import {
  CurrentActor,
  JwtAuthGuard,
  PermissionsGuard,
  Public,
  zodBody,
  type RequestActor,
} from '@glexco/nest-platform';
import { UnauthorizedError, type ExecutionContext as UseCaseContext } from '@glexco/kernel';
import { COOKIE_OPTIONS } from '../../tokens';
import { RegisterStudentUseCase } from '../../application/register-student.usecase';
import { LoginUseCase } from '../../application/login.usecase';
import { RefreshSessionUseCase } from '../../application/refresh-session.usecase';
import { LogoutUseCase } from '../../application/logout.usecase';
import { VerifyEmailUseCase } from '../../application/verify-email.usecase';
import {
  ConfirmPasswordResetUseCase,
  RequestPasswordResetUseCase,
} from '../../application/password-reset.usecase';

/**
 * Controlador de autenticacion.
 *
 * Es una capa fina a proposito: traduce HTTP a comandos, ejecuta el caso de uso
 * y traduce el resultado. Ninguna regla de negocio vive aqui, de modo que el
 * mismo caso de uso puede invocarse desde un consumidor de eventos o un script
 * sin arrastrar Express.
 *
 * Lo unico que si es responsabilidad del controlador son las cookies: son un
 * detalle del transporte HTTP y no tienen sentido fuera de el.
 */
const REFRESH_COOKIE = 'glexco_rt';

export interface CookieOptions {
  domain: string;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

@Controller({ path: 'auth', version: '1' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuthController {
  constructor(
    private readonly registerStudent: RegisterStudentUseCase,
    private readonly login: LoginUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logout: LogoutUseCase,
    private readonly verifyEmailUseCase: VerifyEmailUseCase,
    private readonly requestPasswordReset: RequestPasswordResetUseCase,
    private readonly confirmPasswordReset: ConfirmPasswordResetUseCase,
    // `CookieOptions` es una interfaz, asi que en tiempo de ejecucion su tipo es
    // `Object` y Nest no tiene forma de resolverla. El token explicito es
    // obligatorio, no una preferencia de estilo.
    @Inject(COOKIE_OPTIONS) private readonly cookieOptions: CookieOptions,
  ) {}

  @Post('register/student')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(zodBody(studentRegistrationSchema)) input: StudentRegistrationInput,
    @Req() request: Request,
  ) {
    return this.registerStudent.execute(input, contextFrom(request));
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(zodBody(loginSchema)) input: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.login.execute(input, contextFrom(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
    return result.auth;
  }

  /**
   * Renueva el access token.
   *
   * El refresh token se lee de la cookie y NUNCA del cuerpo: si se aceptara por
   * el cuerpo, un JavaScript inyectado por XSS podria leerlo de donde lo tuviera
   * el cliente y renovar sesiones indefinidamente. Al vivir solo en una cookie
   * httpOnly, el navegador la envia pero ningun script puede leerla.
   */
  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedError('MISSING_REFRESH_TOKEN', 'No hay una sesion activa.');
    }

    try {
      const result = await this.refreshSession.execute(
        { refreshToken: token },
        contextFrom(request),
      );
      this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
      return result.auth;
    } catch (error) {
      // Si el refresco falla, la cookie ya no sirve: dejarla haria que el
      // cliente reintentase en bucle contra un token muerto.
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async signOut(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = request.cookies?.[REFRESH_COOKIE];
    // Idempotente: cerrar sesion sin sesion activa no es un error. Devolver 401
    // aqui solo genera ruido en el cliente y en los logs.
    if (token) {
      await this.logout.execute({ refreshToken: token }, contextFrom(request)).catch(() => undefined);
    }
    this.clearRefreshCookie(response);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) input: { token: string },
    @Req() request: Request,
  ) {
    return this.verifyEmailUseCase.execute(input, contextFrom(request));
  }

  /**
   * Solicitud de recuperacion de contrasena.
   *
   * SIEMPRE devuelve 202, exista la cuenta o no. Responder distinto convertiria
   * este endpoint en un oraculo para averiguar que correos estan registrados en
   * la plataforma, y aqui esos correos son de menores identificables.
   */
  @Post('password-reset/request')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestReset(
    @Body(zodBody(requestPasswordResetSchema)) input: { email: string; locale: 'es' | 'en' },
    @Req() request: Request,
  ) {
    await this.requestPasswordReset.execute(input, contextFrom(request));
    return {
      message: 'Si existe una cuenta con ese correo, recibiras un enlace para restablecerla.',
    };
  }

  @Post('password-reset/confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  async confirmReset(
    @Body(zodBody(confirmPasswordResetSchema)) input: { token: string; password: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.confirmPasswordReset.execute(input, contextFrom(request));
    // Cambiar la contrasena cierra todas las sesiones, incluida la de este
    // navegador: si el cambio se debe a un robo, dejar viva la sesion del
    // atacante haria inutil el reseteo.
    this.clearRefreshCookie(response);
    return { message: 'Contrasena actualizada. Inicia sesion con tu nueva contrasena.' };
  }

  /** Perfil del usuario autenticado. Lo usa el frontend al recargar la pagina. */
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

  private setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(REFRESH_COOKIE, token, {
      // Inaccesible a JavaScript: es lo que impide que un XSS robe la sesion.
      httpOnly: true,
      // Solo por HTTPS en produccion.
      secure: this.cookieOptions.secure,
      // `lax` permite que el usuario llegue desde un enlace de correo con la
      // sesion viva, y sigue bloqueando el envio en peticiones POST de terceros,
      // que es el vector CSRF que importa.
      sameSite: this.cookieOptions.sameSite,
      domain: this.cookieOptions.domain,
      // Acotada a la ruta de autenticacion: no se envia en cada peticion a la
      // API, solo donde hace falta. Menos exposicion y menos bytes por request.
      path: '/api/v1/auth',
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.cookieOptions.secure,
      sameSite: this.cookieOptions.sameSite,
      domain: this.cookieOptions.domain,
      path: '/api/v1/auth',
    });
  }
}

/**
 * Construye el contexto de ejecucion desde la peticion HTTP.
 *
 * Es el unico punto donde la capa de aplicacion toca algo de Express, y por eso
 * esta aqui y no dentro de los casos de uso.
 */
export function contextFrom(request: Request): UseCaseContext {
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
