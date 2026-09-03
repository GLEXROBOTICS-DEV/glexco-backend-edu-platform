import { CircuitBreaker, defaultBreakerOptions } from '@glexco/nest-platform';
import type { Logger } from '@glexco/observability';
import { getRequestContext } from '@glexco/observability';
import type { OneTimeTokenIssuer } from '../../application/ports';

/**
 * Pide a identidad el enlace de un solo uso, justo antes de enviar el correo.
 *
 * **Es la pieza que evita que el token viaje en un evento.** Un evento vive dias
 * en la outbox y en el stream de JetStream; un token de recuperacion escrito ahi
 * convierte el acceso de lectura a una tabla —o a una copia de seguridad vieja—
 * en el control de cualquier cuenta de la plataforma. Aqui el secreto cruza la
 * red una vez, entre dos servicios internos, y no queda escrito en ningun sitio.
 *
 * Va por `/internal` y con el token compartido: dos barreras. El endpoint del
 * otro lado entrega credenciales de acceso, asi que exponerlo por el gateway
 * seria entregar la plataforma.
 *
 * Con interruptor de circuito, como el resto de llamadas entre servicios: si
 * identidad se degrada, el envio falla rapido y el evento se reentrega, en vez
 * de acumular peticiones colgadas que agotan los sockets del proceso.
 */
export class IdentityTokenIssuer implements OneTimeTokenIssuer {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      ...defaultBreakerOptions('identity', logger),
      timeoutMs: 5_000,
      failureThreshold: 5,
    });
  }

  async issue(input: {
    userId: string;
    purpose: 'email_verification' | 'password_reset';
  }): Promise<{ token: string; ttlSeconds: number } | null> {
    return this.breaker.execute(async () => {
      const response = await fetch(`${this.baseUrl}/api/internal/v1/one-time-tokens`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${this.internalToken}`,
          'x-correlation-id': getRequestContext()?.correlationId ?? '',
          Accept: 'application/json',
        },
        body: JSON.stringify(input),
      });

      // Un 404 significa que la cuenta ya no existe: la outbox retiene eventos
      // durante dias y una baja puede haber ocurrido en medio. Se devuelve
      // `null` y no se lanza, para que el consumidor CONFIRME el evento: seguir
      // reintentando un correo a un usuario borrado no lo va a arreglar nunca y
      // atasca la cola.
      if (response.status === 404) return null;

      if (!response.ok) {
        throw new Error(`identidad respondio ${response.status} al acunar el enlace`);
      }

      return (await response.json()) as { token: string; ttlSeconds: number };
    });
  }
}
