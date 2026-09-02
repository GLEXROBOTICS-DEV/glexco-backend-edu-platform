import { Pool, type PoolConfig } from 'pg';
import type { Logger } from '@glexco/observability';

/**
 * Conexiones a PostgreSQL con separacion de escritura y lectura.
 *
 * La base de datos es el cuello de botella de esta plataforma: anadir replicas
 * de API es trivial, escalar escrituras no lo es. Por eso el acceso se separa
 * desde el primer dia:
 *
 * - `write`: apunta al primario. Comandos y todo lo que deba leer sus propias
 *   escrituras dentro de la misma peticion.
 * - `read`: apunta a las replicas de lectura. Consultas, listados, dashboards y
 *   reportes, que son la abrumadora mayoria del trafico.
 *
 * En local ambas apuntan al mismo Postgres, asi que el codigo que se escribe
 * hoy ya es el correcto cuando en produccion existan tres replicas: no hay una
 * migracion posterior "para escalar".
 *
 * ATENCION al retardo de replicacion: una replica puede ir unos milisegundos
 * por detras. Cualquier lectura que deba ver un cambio recien hecho (leer tu
 * propio perfil despues de editarlo, comprobar el cupo del salon justo antes de
 * matricular) tiene que ir al pool de escritura. El helper `readAfterWrite` de
 * mas abajo lo hace explicito en el sitio de la llamada.
 */
export const DB_WRITE_POOL = Symbol('DB_WRITE_POOL');
export const DB_READ_POOL = Symbol('DB_READ_POOL');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface DatabaseOptions {
  writeUrl: string;
  /** URLs de replicas. Si esta vacio, las lecturas van al primario. */
  readUrls?: string[];
  poolMax: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  applicationName: string;
  logger?: Logger;
}

function poolConfig(url: string, options: DatabaseOptions, readOnly: boolean): PoolConfig {
  return {
    connectionString: url,
    // El total de conexiones es poolMax * numero de replicas del servicio. Con
    // 8 servicios y 6 replicas cada uno, un poolMax de 10 son 480 conexiones:
    // por encima de lo que aguanta un Postgres gestionado mediano. Cuando el
    // numero de replicas suba, la respuesta correcta es poner PgBouncer en
    // modo transaction delante, no subir este numero.
    max: options.poolMax,
    idleTimeoutMillis: options.idleTimeoutMs,
    connectionTimeoutMillis: 5_000,
    // Corta consultas descontroladas antes de que agoten el pool y arrastren al
    // servicio entero. Es la red de seguridad contra un JOIN sin indice que se
    // cuela en produccion.
    statement_timeout: options.statementTimeoutMs,
    // Una transaccion abierta y olvidada bloquea VACUUM y hace crecer la tabla.
    idle_in_transaction_session_timeout: 30_000,
    application_name: `${options.applicationName}${readOnly ? '-ro' : '-rw'}`,
    keepAlive: true,
  };
}

export function createWritePool(options: DatabaseOptions): Pool {
  const pool = new Pool(poolConfig(options.writeUrl, options, false));
  attachDiagnostics(pool, 'escritura', options.logger);
  return pool;
}

/**
 * Pool de lectura con reparto entre replicas.
 *
 * El reparto se hace por conexion y no por consulta: el balanceo fino lo hara el
 * balanceador gestionado (RDS Proxy, el endpoint de lectura de Railway/Huawei)
 * cuando existan varias replicas. Aqui basta con repartir de forma uniforme.
 */
export function createReadPool(options: DatabaseOptions): Pool {
  const urls = options.readUrls?.filter(Boolean) ?? [];
  const url = urls.length > 0 ? urls[Math.floor(Math.random() * urls.length)]! : options.writeUrl;

  const pool = new Pool(poolConfig(url, options, true));
  attachDiagnostics(pool, 'lectura', options.logger);
  return pool;
}

function attachDiagnostics(pool: Pool, label: string, logger?: Logger): void {
  pool.on('error', (error) => {
    // Un error en una conexion ociosa no debe tumbar el proceso: pg la descarta
    // y crea otra. Si lo dejamos propagar, mata al servidor entero.
    logger?.error({ err: error, pool: label }, 'Error en conexion ociosa de PostgreSQL');
  });

  pool.on('connect', (client) => {
    // Zona horaria fija en UTC: toda fecha se guarda y se compara en UTC, y la
    // conversion a hora local ocurre solo al presentar en el navegador.
    void client.query("SET TIME ZONE 'UTC'");
  });
}

/**
 * Metricas del pool, expuestas en /metrics.
 *
 * `waitingCount` sostenido por encima de cero es la senal temprana de que el
 * pool se esta quedando corto: es lo que hay que vigilar antes de que aparezcan
 * los tiempos de espera en el cliente.
 */
export function poolStats(pool: Pool): Record<string, number> {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}
