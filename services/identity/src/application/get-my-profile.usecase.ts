import {
  UnauthorizedError,
  type ExecutionContext,
  type UseCase,
} from '@glexco/kernel';
import { resolvePermissions, type Permission, type Role } from '@glexco/contracts';
import { UserId } from '../domain/user/value-objects';
import type { UserRepository } from '../domain/user/user.repository';
import { resolvePortal } from './resolve-portal';

export interface MyProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  permissions: Permission[];
  institutionId: string | null;
  portal: string;
  locale: 'es' | 'en';
  avatarUrl: string | null;
  emailVerified: boolean;
  mustChangePassword: boolean;
}

/**
 * Perfil del usuario autenticado.
 *
 * **Lee de la base, no del token, y esa es toda la razon de existir.** Antes
 * este endpoint se limitaba a devolver los claims del token, que quien llama ya
 * tiene: no aportaba nada. El nombre, el correo y el avatar NO viajan en el
 * token a proposito -son millones de tokens en cada peticion de cada alumno, y
 * cada campo extra se paga en bytes de red-, asi que el portal no tiene otra
 * forma de saber como se llama la persona que acaba de entrar.
 *
 * El otro dato que solo se puede resolver aqui es el **portal**: depende de la
 * edad y de los roles, y cambia si a alguien le conceden un rol nuevo. Sacarlo
 * del token dejaria a un docente recien nombrado viendo el portal de alumno
 * hasta que su token caducara.
 *
 * Los permisos se recalculan desde los roles en vez de copiarse del token: si un
 * administrador retira un rol, el token viejo sigue diciendo lo que decia, y
 * pintar el menu con esos permisos mostraria opciones que el backend ya rechaza.
 */
export class GetMyProfileUseCase implements UseCase<void, MyProfile> {
  constructor(private readonly users: UserRepository) {}

  async execute(_input: void, context: ExecutionContext): Promise<MyProfile> {
    const actor = context.actor;
    if (!actor) {
      throw new UnauthorizedError('MISSING_TOKEN', 'Se requiere autenticacion.');
    }

    const user = await this.users.findById(UserId.create(actor.userId));

    if (!user) {
      // El token es valido pero la cuenta ya no esta: se elimino o se depuro.
      // Es 401 y no 404 porque lo que el cliente tiene que hacer es volver a
      // autenticarse, no buscar otro recurso.
      throw new UnauthorizedError('SESSION_USER_NOT_FOUND', 'La sesion ya no es valida.');
    }

    const state = user.snapshot();

    return {
      userId: user.id.value,
      email: state.email.value,
      firstName: state.name.first,
      lastName: state.name.last,
      roles: state.roles,
      permissions: resolvePermissions(state.roles),
      institutionId: state.institutionId,
      portal: resolvePortal(user),
      locale: state.locale.value,
      avatarUrl: state.avatarUrl,
      emailVerified: state.emailVerified,
      mustChangePassword: state.mustChangePassword,
    };
  }
}
