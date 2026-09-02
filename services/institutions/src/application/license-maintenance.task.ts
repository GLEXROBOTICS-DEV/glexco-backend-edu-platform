import type { Clock, DistributedLock, LoggerPort, UnitOfWork } from '@glexco/kernel';
import type { InstitutionRepository } from '../domain/repositories';

/**
 * Tarea periodica que recalcula el estado de las licencias.
 *
 * Marca como `expiring_soon` las que vencen en 30 dias y como `expired` las
 * vencidas, y emite `institutions.license.expired.v1` la primera vez que una
 * caduca. El equipo comercial ve el aviso con margen para renovar sin que el
 * colegio note nada.
 *
 * **Solo una replica la ejecuta**, garantizado por un cerrojo distribuido en
 * Redis. Con N replicas detras del balanceador, sin cerrojo las N harian el
 * mismo trabajo a la vez: N veces la carga sobre la base y, peor, N eventos de
 * vencimiento por licencia, que se traducirian en N correos al mismo cliente.
 *
 * El cerrojo tiene TTL: si la replica que lo tiene muere a mitad, el cerrojo
 * caduca solo y otra lo toma en la siguiente vuelta. Un cerrojo sin caducidad
 * dejaria la tarea muerta para siempre tras un unico fallo.
 */
export class LicenseMaintenanceTask {
  private timer: NodeJS.Timeout | null = null;

  /** Cada hora. La granularidad util aqui es el dia, asi que una hora deja
   *  margen de sobra y mantiene la carga en nada. */
  private static readonly INTERVAL_MS = 3_600_000;
  /** Vida del cerrojo: mas que lo que la tarea puede tardar, menos que el
   *  intervalo, para que nunca se solape consigo misma. */
  private static readonly LOCK_TTL_MS = 300_000;
  private static readonly LOCK_KEY = 'task:license-maintenance';

  /** Ventana de aviso previo al vencimiento. */
  private static readonly WARNING_DAYS = 30;

  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly lock: DistributedLock,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.runOnce();
    }, LicenseMaintenanceTask.INTERVAL_MS);

    // `unref` para que un temporizador pendiente no impida que el proceso
    // termine durante un apagado ordenado.
    this.timer.unref();

    // Una pasada al arrancar: si el servicio estuvo caido un dia entero, no hay
    // que esperar otra hora para poner al dia los estados.
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ejecuta una pasada. Devuelve cuantas instituciones se revisaron, o `null` si
   * otra replica tenia el cerrojo.
   */
  async runOnce(): Promise<number | null> {
    return this.lock.withLock(
      LicenseMaintenanceTask.LOCK_KEY,
      LicenseMaintenanceTask.LOCK_TTL_MS,
      async () => {
        const now = this.clock.now();

        // Solo se traen las que estan cerca de vencer o ya vencieron: recorrer
        // todas las instituciones en cada pasada seria trabajo inutil que crece
        // con la cartera de clientes.
        const affected = await this.institutions.findWithExpiringLicenses(
          LicenseMaintenanceTask.WARNING_DAYS,
        );

        let changed = 0;

        for (const institution of affected) {
          institution.refreshLicenseStatuses(now);
          const events = institution.pullDomainEvents();

          // Sin eventos no hubo cambio de estado, asi que no se escribe: evita
          // un UPDATE por institucion en cada pasada horaria.
          if (events.length === 0) continue;

          await this.unitOfWork.run(async (tx) => {
            await this.institutions.save(institution, tx);
            (tx as { enqueue(...events: unknown[]): void }).enqueue(...events);
          });

          changed += 1;
        }

        if (changed > 0) {
          this.logger.info('Estados de licencia actualizados', {
            revisadas: affected.length,
            cambiadas: changed,
          });
        }

        return affected.length;
      },
    );
  }
}
