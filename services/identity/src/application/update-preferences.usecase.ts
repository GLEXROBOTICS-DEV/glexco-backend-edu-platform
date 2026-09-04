import {
  BusinessRuleError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import type { UserRepository } from '../domain/user/user.repository';
import { LocalePreference, UserId } from '../domain/user/value-objects';

export interface UpdatePreferencesInput {
  locale: string;
}

/**
 * El usuario cambia su idioma.
 *
 * **Se guarda en el PERFIL y no en una cookie**, y esa es toda la razon de que
 * este caso de uso exista. El idioma del perfil es el que deciden los correos
 * -verificacion, recuperacion, avisos-, asi que si la interfaz se cambiara solo
 * con una cookie, un alumno que la pone en ingles seguiria recibiendo los
 * correos en espanol sin entender por que.
 *
 * El selector de la pantalla de ingreso SI usa cookie, porque ahi todavia no hay
 * perfil al que escribir; en cuanto hay sesion, manda el perfil.
 *
 * Emite `USER_PROFILE_UPDATED`, que ya escuchan instituciones y aprendizaje para
 * mantener sus directorios de nombres: cambiar el idioma no los toca, pero el
 * mismo evento lleva las dos cosas y separarlos obligaria a mantener dos.
 */
export class UpdatePreferencesUseCase implements UseCase<UpdatePreferencesInput, void> {
  constructor(
    private readonly users: UserRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdatePreferencesInput, context: ExecutionContext): Promise<void> {
    const actor = context.actor;
    if (!actor) {
      throw new BusinessRuleError('ACTOR_REQUIRED', 'Esta operacion exige estar autenticado.');
    }

    // El identificador sale del TOKEN, nunca de la peticion: aceptarlo
    // convertiria esto en "cambiale el idioma a quien yo diga".
    const locale = LocalePreference.create(input.locale);

    await this.unitOfWork.run(async (tx) => {
      // Sin bloqueo de fila: el idioma no participa en ninguna invariante y la
      // version optimista del agregado ya cubre el caso de dos cambios a la vez
      // -el ultimo gana, que para una preferencia es lo correcto-.
      const user = await this.users.findById(UserId.create(actor.userId));
      if (!user) throw new NotFoundError('USER_NOT_FOUND', 'No encontramos tu cuenta.');

      user.updateProfile({ locale }, this.clock.now());

      await this.users.save(user, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...user.pullDomainEvents());
    });
  }
}
