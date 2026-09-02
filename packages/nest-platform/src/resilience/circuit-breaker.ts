import type { Logger } from '@glexco/observability';
import { ServiceUnavailableError } from '@glexco/kernel';

/**
 * Interruptor de circuito para llamadas a dependencias externas.
 *
 * El problema que resuelve: si el servicio de catalogo se degrada y tarda 30
 * segundos en responder, el gateway acumula peticiones esperando, agota su pool
 * de sockets y deja de atender TODO, incluidas las rutas que no dependen de
 * catalogo. Un servicio lento tumba la plataforma entera; es el fallo en cascada
 * clasico y es peor que una caida limpia.
 *
 * Con el interruptor abierto, las llamadas a esa dependencia fallan al instante
 * y el resto de la plataforma sigue funcionando. La funcionalidad degradada
 * queda acotada al area afectada.
 *
 * Estados:
 *   CERRADO      -> todo pasa; se cuentan los fallos.
 *   ABIERTO      -> todo falla de inmediato; ni se intenta.
 *   SEMIABIERTO  -> se deja pasar un numero limitado de sondas para comprobar si
 *                   la dependencia se recupero.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  name: string;
  /** Fallos consecutivos que abren el circuito. */
  failureThreshold: number;
  /** Tiempo abierto antes de pasar a semiabierto. */
  resetTimeoutMs: number;
  /** Exitos seguidos en semiabierto para volver a cerrar. */
  successThreshold: number;
  /** Timeout de cada llamada: sin el, el interruptor nunca detectaria lentitud. */
  timeoutMs: number;
  logger?: Logger;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt = 0;
  private halfOpenInFlight = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  get currentState(): CircuitState {
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.options.resetTimeoutMs) {
        return this.reject(fallback);
      }
      this.transitionTo('half_open');
    }

    // En semiabierto solo dejamos pasar una sonda a la vez: si la dependencia
    // sigue caida, no queremos volver a inundarla.
    if (this.state === 'half_open' && this.halfOpenInFlight >= 1) {
      return this.reject(fallback);
    }

    if (this.state === 'half_open') this.halfOpenInFlight += 1;

    try {
      const result = await this.withTimeout(operation());
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      if (fallback) return fallback();
      throw error;
    } finally {
      if (this.state === 'half_open') this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ServiceUnavailableError(
                  'DEPENDENCY_TIMEOUT',
                  `La dependencia ${this.options.name} no respondio a tiempo.`,
                  { dependency: this.options.name, timeoutMs: this.options.timeoutMs },
                ),
              ),
            this.options.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === 'half_open') {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.options.successThreshold) this.transitionTo('closed');
    }
  }

  private onFailure(error: unknown): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures += 1;

    if (this.state === 'half_open') {
      // La sonda fallo: se vuelve a abrir sin agotar el umbral.
      this.transitionTo('open');
      return;
    }

    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.options.logger?.error(
        { dependency: this.options.name, failures: this.consecutiveFailures, err: error },
        'Circuito abierto: la dependencia se considera caida',
      );
      this.transitionTo('open');
    }
  }

  private transitionTo(state: CircuitState): void {
    if (this.state === state) return;
    this.state = state;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
    if (state === 'open') {
      this.openedAt = Date.now();
    } else if (state === 'closed') {
      this.consecutiveFailures = 0;
      this.options.logger?.info({ dependency: this.options.name }, 'Circuito cerrado: dependencia recuperada');
    }
  }

  private async reject<T>(fallback?: () => Promise<T>): Promise<T> {
    if (fallback) return fallback();
    throw new ServiceUnavailableError(
      'DEPENDENCY_UNAVAILABLE',
      `El servicio ${this.options.name} no esta disponible en este momento.`,
      { dependency: this.options.name, state: this.state },
    );
  }
}

/** Valores por defecto razonables para llamadas entre microservicios internos. */
export const defaultBreakerOptions = (
  name: string,
  logger?: Logger,
): CircuitBreakerOptions => ({
  name,
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  successThreshold: 2,
  timeoutMs: 3_000,
  logger,
});
