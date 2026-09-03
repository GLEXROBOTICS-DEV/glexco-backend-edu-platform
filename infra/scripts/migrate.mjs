#!/usr/bin/env node
/**
 * Ejecutor de migraciones SQL.
 *
 * Se escribe a mano en vez de usar el runner de un ORM por tres razones
 * concretas:
 *
 * 1. Las migraciones son SQL puro, que es donde de verdad se decide el
 *    rendimiento (indices parciales, restricciones, tipos). Un generador tiende
 *    al minimo comun denominador.
 * 2. Toma un cerrojo de aviso de PostgreSQL, de modo que si arrancan seis
 *    replicas a la vez solo una migra y las demas esperan. Sin eso, un despliegue
 *    con autoescalado produce errores de "la tabla ya existe" en cinco de seis
 *    contenedores.
 * 3. Cada migracion corre dentro de su propia transaccion: si falla a mitad, no
 *    queda un esquema a medio aplicar.
 *
 * Uso:  node infra/scripts/migrate.mjs <servicio>
 * Ej.:  node infra/scripts/migrate.mjs identity
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const service = process.argv[2];

if (!service) {
  console.error('Uso: node infra/scripts/migrate.mjs <servicio>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'services', service, 'migrations');

const connectionString =
  process.env[`DATABASE_URL_${service.toUpperCase()}`] ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    `Falta DATABASE_URL_${service.toUpperCase()} (o DATABASE_URL) en el entorno.\n` +
      `Copia .env.example a .env y cargalo antes de migrar.`,
  );
  process.exit(1);
}

/** Identificador del cerrojo de aviso, derivado del nombre del servicio para que
 *  dos servicios distintos puedan migrar en paralelo sin bloquearse. */
const LOCK_ID = Number.parseInt(
  createHash('sha256').update(`glexco:migrate:${service}`).digest('hex').slice(0, 12),
  16,
);

const client = new pg.Client({ connectionString });

try {
  await client.connect();

  // Cerrojo de sesion: se libera solo si el proceso muere, asi que un fallo no
  // deja la migracion bloqueada para siempre.
  console.log(`Solicitando cerrojo de migracion para "${service}"...`);
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);

  // PostgreSQL comprueba el permiso CREATE sobre la BASE antes de mirar si el
  // schema ya existe, asi que "CREATE SCHEMA IF NOT EXISTS" falla con
  // "permission denied for database" incluso cuando no hay nada que crear. El
  // rol de cada servicio no tiene (ni debe tener) ese permiso: sus schemas los
  // crea el init del contenedor con el superusuario. Por eso se consulta antes.
  const { rows: schemaRows } = await client.query(
    'SELECT 1 FROM pg_namespace WHERE nspname = $1',
    [service],
  );

  if (schemaRows.length === 0) {
    await client.query(`CREATE SCHEMA ${service}`);
  }
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${service}.schema_migrations (
      name        text PRIMARY KEY,
      -- El hash detecta que alguien edito una migracion YA aplicada, que es un
      -- error grave: el entorno de desarrollo y el de produccion quedarian con
      -- esquemas distintos sin que nada avise.
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    )
  `);

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const { rows: applied } = await client.query(
    `SELECT name, checksum FROM ${service}.schema_migrations`,
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  let executed = 0;

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = appliedByName.get(file);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `La migracion "${file}" ya fue aplicada pero su contenido cambio.\n` +
            `Nunca edites una migracion aplicada: crea una nueva que corrija el estado.`,
        );
      }
      continue;
    }

    console.log(`Aplicando ${file}...`);
    const started = Date.now();

    // Cada migracion en su propia transaccion.
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO ${service}.schema_migrations (name, checksum, duration_ms)
         VALUES ($1, $2, $3)`,
        [file, checksum, Date.now() - started],
      );
      await client.query('COMMIT');
      executed += 1;
      console.log(`  aplicada en ${Date.now() - started} ms`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Fallo al aplicar "${file}": ${error.message}`);
    }
  }

  console.log(
    executed === 0
      ? `Sin migraciones pendientes para "${service}".`
      : `${executed} migracion(es) aplicada(s) a "${service}".`,
  );
} catch (error) {
  console.error(`\nError de migracion: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
  await client.end().catch(() => {});
}
