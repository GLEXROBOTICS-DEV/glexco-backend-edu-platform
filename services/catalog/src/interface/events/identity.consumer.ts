import type { Pool, PoolClient } from 'pg';
import type { NatsConnection } from 'nats';
import { EventConsumer, JoiningUnitOfWork } from '@glexco/nest-platform';
import { EVENTS, ROLES, type Role } from '@glexco/contracts';
import { isDomainError, type Clock, type ExecutionContext, type LoggerPort, type SecureRandom } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { RedeemActivationCodeUseCase } from '../../application/redeem-activation-code.usecase';
import type {
  ActivationCodeRepository,
  EntitlementRepository,
  KitRepository,
} from '../../domain/repositories';

/**
 * Reaccion de catalogo al alta de un alumno en identidad.
 *
 * Cierra el flujo del registro: el alumno teclea el codigo de su libro en el
 * formulario, identidad solo lo COMPRUEBA -no lo canjea, porque eso exigiria
 * una transaccion distribuida entre dos servicios que no existe- y el canje de
 * verdad ocurre aqui, al consumir el evento.
 *
 * Que el canje sea asincrono no lo debilita: sigue pasando por
 * `SELECT ... FOR UPDATE` sobre la misma fila y por el mismo agregado, asi que
 * compite en igualdad con el canje por HTTP. Si ambos ocurren a la vez, uno
 * gana y el otro se encuentra el codigo ya canjeado.
 *
 * El evento trae el ID de la fila del codigo, nunca el codigo: un secreto con
 * valor economico no debe vivir dias en la outbox ni en el stream.
 */
export interface CatalogIdentityConsumerDeps {
  connection: NatsConnection;
  pool: Pool;
  streamName: string;
  serviceName: string;
  codes: ActivationCodeRepository;
  kits: KitRepository;
  entitlements: EntitlementRepository;
  clock: Clock;
  logger: LoggerPort;
  pepper: string;
  ids: SecureRandom;
  /** Logger de pino del propio consumidor; los casos de uso reciben el puerto. */
  natsLogger: Logger;
}

interface UserRegisteredPayload {
  userId: string;
  roles: Role[];
  institutionId?: string;
  activationCodeId?: string;
  accountType: 'institutional' | 'independent';
}

export function buildCatalogIdentityConsumer(deps: CatalogIdentityConsumerDeps): EventConsumer {
  const consumer = new EventConsumer({
    connection: deps.connection,
    pool: deps.pool,
    schema: 'catalog',
    serviceName: deps.serviceName,
    streamName: deps.streamName,
    // Solo el alta. Suscribirse a `identity.>` traeria los eventos de sesion,
    // que son miles por minuto, para descartarlos aqui.
    subjects: [EVENTS.USER_REGISTERED],
    logger: deps.natsLogger,
  });

  consumer.on<UserRegisteredPayload>(EVENTS.USER_REGISTERED, async (event, tx) => {
    const payload = event.payload;

    if (!payload.roles.includes(ROLES.STUDENT)) return;

    // Un alta de personal, o un registro por una via que no pida codigo, no
    // trae nada que canjear. No es un error.
    if (!payload.activationCodeId) return;

    const redeem = new RedeemActivationCodeUseCase(
      deps.codes,
      deps.kits,
      deps.entitlements,
      // Se SUMA a la transaccion del consumidor en vez de abrir la suya. Con la
      // normal habria dos transacciones compitiendo por la misma fila del
      // codigo, y la marca de deduplicacion podria confirmarse sin el canje.
      new JoiningUnitOfWork(tx.client as PoolClient, 'catalog'),
      deps.clock,
      deps.logger,
      deps.pepper,
      deps.ids,
    );

    try {
      await redeem.execute(
        {
          activationCodeId: payload.activationCodeId,
          studentId: payload.userId,
          ...(payload.institutionId ? { institutionId: payload.institutionId } : {}),
        },
        contextFromEvent(event.metadata.correlationId, payload.userId),
      );
    } catch (error) {
      // Un codigo ya canjeado POR OTRO alumno no se arregla reintentando: entre
      // la comprobacion del formulario y este momento alguien gano la carrera.
      // Se registra y se da el evento por procesado; reintentar en bucle solo
      // llenaria el log y acabaria en la cola de mensajes muertos.
      //
      // El alumno queda registrado y sin acceso al kit, que es un estado
      // recuperable por soporte: el caso contrario -reventar aqui y reprocesar
      // el alta- no le devolveria el codigo.
      if (isDomainError(error) && error.code === 'ACTIVATION_CODE_ALREADY_USED') {
        deps.logger.warn('Codigo ya canjeado por otro alumno al procesar el alta', {
          studentId: payload.userId,
          activationCodeId: payload.activationCodeId,
          correlationId: event.metadata.correlationId,
        });
        return;
      }

      throw error;
    }
  });

  return consumer;
}

function contextFromEvent(correlationId: string | undefined, userId: string): ExecutionContext {
  return {
    correlationId: correlationId ?? '',
    locale: 'es',
    requestedAt: new Date(),
    // El actor es el propio alumno: el canje se hace en su nombre, no en el de
    // un operador. No hay sesion porque esto no viene de una peticion HTTP.
    actor: { userId, roles: [ROLES.STUDENT], permissions: [], sessionId: '' },
  };
}
