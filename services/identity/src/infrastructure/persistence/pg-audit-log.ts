import type { Pool } from 'pg';
import type { Logger } from '@glexco/observability';
import type { AuditEntry, AuditLog } from '../../application/ports';

/**
 * Registro de auditoria de acceso.
 *
 * **Escritura en lote diferida.** Cada inicio de sesion, cada fallo y cada
 * cambio de rol genera una entrada. A escala son decenas de miles de INSERT por
 * minuto, y hacerlos uno a uno dentro de la peticion anadiria una ida y vuelta a
 * la base en la ruta mas caliente del servicio, ademas de convertir un pico de
 * inicios de sesion en un pico de escrituras.
 *
 * Se acumulan en memoria y se vuelcan en lotes. El precio es que, si el proceso
 * muere de golpe, se pierden las entradas del ultimo intervalo. Es un
 * compromiso aceptable para auditoria de acceso -no es un libro contable- y se
 * acota volcando tambien en el apagado ordenado y manteniendo el intervalo corto.
 *
 * Lo que NO se hace: escribir la auditoria dentro de la transaccion del caso de
 * uso. Un fallo al auditar no debe impedir que alguien inicie sesion.
 */
export class PgAuditLog implements AuditLog {
  private buffer: AuditEntry[] = [];
  private timer: NodeJS.Timeout | null = null;

  /** Tope del buffer. Si se supera, se vuelca de inmediato en vez de crecer sin
   *  limite durante un incidente (que es justo cuando mas entradas se generan). */
  private static readonly MAX_BUFFER = 500;
  private static readonly FLUSH_INTERVAL_MS = 2_000;

  constructor(
    private readonly pool: Pool,
    private readonly logger?: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), PgAuditLog.FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  async record(entry: AuditEntry): Promise<void> {
    this.buffer.push(entry);
    if (this.buffer.length >= PgAuditLog.MAX_BUFFER) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Se vacia el buffer ANTES de escribir: si el INSERT falla y reintentaramos
    // sobre el mismo arreglo, las entradas nuevas que llegasen mientras tanto se
    // duplicarian.
    const batch = this.buffer;
    this.buffer = [];

    const values: unknown[] = [];
    const rows: string[] = [];

    batch.forEach((entry, index) => {
      const base = index * 11;
      rows.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},` +
          `$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`,
      );
      values.push(
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.outcome,
        entry.reason ?? null,
        entry.institutionId ?? null,
        entry.ipAddress ?? null,
        entry.userAgent?.slice(0, 500) ?? null,
        entry.correlationId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      );
    });

    try {
      await this.pool.query(
        `INSERT INTO identity.audit_log
           (actor_id, action, target_type, target_id, outcome, reason,
            institution_id, ip_address, user_agent, correlation_id, metadata)
         VALUES ${rows.join(',')}`,
        values,
      );
    } catch (error) {
      // La auditoria no puede tumbar el servicio. Se registra el fallo con las
      // entradas perdidas para que quede rastro en los logs, que es la segunda
      // fuente de verdad.
      this.logger?.error(
        { err: error, lostEntries: batch.length },
        'No se pudo escribir el lote de auditoria',
      );
    }
  }
}
