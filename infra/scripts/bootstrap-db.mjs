#!/usr/bin/env node
/**
 * Prepara una base de datos PostgreSQL recien creada para GLEXCO.
 *
 * **Por que existe.** En local, `infra/docker/postgres/init/*.sql` se ejecutan
 * solos: Docker los monta en `/docker-entrypoint-initdb.d` y el contenedor los
 * corre al inicializarse. En Railway —o en RDS, o en cualquier Postgres
 * gestionado— ese directorio no existe, asi que **esos scripts no se ejecutan
 * nunca**. Sin ellos no hay schemas, ni roles por servicio, ni tabla `outbox`, y
 * el primer `db:migrate` falla con "permission denied for database".
 *
 * Este script hace lo mismo contra cualquier Postgres al que se pueda conectar
 * con un usuario administrador. Es **idempotente**: se puede volver a ejecutar
 * sin romper nada, que es lo que hace falta cuando se anade un servicio.
 *
 * Uso:
 *   ADMIN_DATABASE_URL=postgresql://user:pass@host:5432/railway \
 *   GLEXCO_DB_PASSWORD=<secreto> \
 *   node infra/scripts/bootstrap-db.mjs
 *
 * Al terminar imprime las `DATABASE_URL_*` de cada servicio, que es lo que hay
 * que pegar en las variables de cada servicio de Railway.
 *
 * La contrasena de los roles se pasa por entorno y NO se genera aqui: si se
 * generara, volver a ejecutarlo cambiaria las credenciales de ocho servicios en
 * marcha. Una sola contrasena para los ocho roles es aceptable porque el
 * aislamiento no lo da la contrasena sino los permisos del rol: `glexco_catalog`
 * no puede leer el schema `identity` aunque alguien conozca su clave.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INIT_DIR = path.join(HERE, '..', 'docker', 'postgres', 'init');

const SERVICES = [
  'identity',
  'institutions',
  'catalog',
  'learning',
  'assessment',
  'engagement',
  'analytics',
  'media',
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`\nFalta ${name}.\n\n`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const adminUrl = requireEnv('ADMIN_DATABASE_URL');
  const password = requireEnv('GLEXCO_DB_PASSWORD');

  if (password.length < 16) {
    process.stderr.write('\nGLEXCO_DB_PASSWORD debe tener al menos 16 caracteres.\n\n');
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: adminUrl,
    // Los Postgres gestionados exigen TLS pero presentan un certificado que la
    // cadena por defecto de Node no valida. Se acepta porque la conexion es
    // interna y de un solo uso; para el trafico de la aplicacion, cada servicio
    // usa su propia cadena con la configuracion que corresponda.
    ssl: adminUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    const schemas = await readFile(path.join(INIT_DIR, '01-schemas.sql'), 'utf8');
    const outbox = await readFile(path.join(INIT_DIR, '02-outbox-template.sql'), 'utf8');

    process.stdout.write('Creando extensiones, schemas y roles...\n');
    await client.query(schemas);

    // La contrasena de los roles se fija DESPUES del script, que trae la de
    // desarrollo escrita dentro. Asi el mismo archivo sirve para las dos cosas
    // sin tener dos copias que se separen.
    process.stdout.write('Fijando la contrasena de los roles...\n');
    for (const service of SERVICES) {
      await client.query(`ALTER ROLE ${quoteIdent(`glexco_${service}`)} WITH PASSWORD $1`, [
        password,
      ]);
    }

    process.stdout.write('Creando las tablas outbox y processed_events...\n');
    await client.query(outbox);

    const { rows } = await client.query('SELECT current_database() AS db');
    const database = rows[0].db;

    process.stdout.write('\nListo.\n\n');
    printConnectionStrings(adminUrl, database, password);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Imprime las cadenas de conexion de cada servicio.
 *
 * Se construyen a partir del host y el puerto del administrador, porque en un
 * Postgres gestionado son los mismos: lo unico que cambia por servicio es el
 * usuario. Se marca `?schema=` porque es lo que espera `withServiceDatabaseUrl`.
 */
function printConnectionStrings(adminUrl, database, password) {
  const admin = new URL(adminUrl);
  const encoded = encodeURIComponent(password);

  process.stdout.write(
    'Pega cada linea en la variable correspondiente del servicio en Railway.\n' +
      'Cada servicio recibe SOLO la suya: darle la de otro romperia el aislamiento\n' +
      'que estos roles existen para garantizar.\n\n',
  );

  for (const service of SERVICES) {
    const url =
      `postgresql://glexco_${service}:${encoded}@${admin.hostname}:${admin.port || 5432}` +
      `/${database}?schema=${service}`;
    process.stdout.write(`DATABASE_URL_${service.toUpperCase()}=${url}\n`);
  }

  process.stdout.write(
    '\nAviso: en produccion cada servicio recibe UNA sola DATABASE_URL, no las ocho.\n' +
      'La lista completa es solo para que la copies.\n\n',
  );
}

/** Cita un identificador SQL. Los nombres son fijos, pero interpolar sin citar
 *  es un habito que acaba mordiendo cuando el nombre deja de ser fijo. */
function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  process.stderr.write(`\nFallo la preparacion de la base: ${error.message}\n\n`);
  process.exit(1);
});
