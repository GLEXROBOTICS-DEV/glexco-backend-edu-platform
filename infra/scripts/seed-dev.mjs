#!/usr/bin/env node
/**
 * Sembrado de datos de desarrollo.
 *
 * Existe porque, en cuanto los servicios hablan entre si de verdad (con
 * CATALOG_URL e INSTITUTIONS_URL apuntando a los servicios reales y no a los
 * dobles en memoria), no se puede registrar a un alumno sin que haya de
 * antemano un kit, un lote y un codigo de activacion en la base. Los dobles en
 * memoria aceptaban cualquier codigo `GLX-TEST...`; contra el catalogo real, un
 * codigo que no existe se rechaza, que es exactamente lo que debe pasar.
 *
 * Escribe con SQL directo y no por HTTP a proposito: la API de generacion de
 * lotes es una operacion de personal GLEXCO que exige un token, y el sembrado
 * tiene que funcionar sobre una base recien migrada, cuando todavia no hay
 * ningun usuario que pueda emitir ese token.
 *
 * Uso:
 *   node --env-file-if-exists=.env infra/scripts/seed-dev.mjs
 *   node --env-file-if-exists=.env infra/scripts/seed-dev.mjs --codes 40
 *
 * Tambien se importa como modulo desde smoke-test.mjs y concurrency-check.mjs.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';

// Mismos valores que `@glexco/contracts`. Se repiten aqui, y no se importan,
// porque este script tiene que poder ejecutarse sin haber compilado el
// monorepo: es lo primero que se lanza sobre una base vacia.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;
const CODE_PREFIX = 'GLX';

/** Identificador del personal GLEXCO ficticio al que se atribuye el lote. */
const SEED_OPERATOR_ID = '00000000-0000-4000-8000-000000000001';

export function generateCode() {
  let body = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${CODE_PREFIX}${body}`;
}

/** Mismo hasheo que `hashActivationCode` en el dominio de catalogo. Si esto se
 *  desviara, los codigos sembrados no se encontrarian al canjearlos. */
export function hashCode(code, pepper) {
  return createHash('sha256').update(`${pepper}:${code}`).digest('hex');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en el entorno. Ejecuta "pnpm setup" y carga el .env.`);
  }
  return value;
}

/**
 * Crea kit + lote + codigos, y devuelve los codigos EN CLARO.
 *
 * Es la unica vez que existen sin hashear, igual que en la generacion real para
 * imprenta: en la base solo queda el hash.
 */
export async function seedCatalog({ codeCount = 30, kitCode, grade = 'primary_6' } = {}) {
  const pepper = requireEnv('ACTIVATION_CODE_PEPPER');
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_CATALOG') });
  await client.connect();

  try {
    const kitId = randomUUID();
    const batchId = randomUUID();
    const resolvedKitCode = kitCode ?? `KIT-DEV-${Date.now().toString(36).toUpperCase()}`;

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO catalog.kits (id, code, name, description, program, grade, robot_platforms, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published')`,
      [
        kitId,
        resolvedKitCode,
        'Kit de desarrollo — uKit Explore',
        'Kit sembrado por seed-dev.mjs para pruebas de punta a punta.',
        grade.startsWith('primary') ? 'discover' : 'academy',
        grade,
        ['ukit'],
      ],
    );

    await client.query(
      `INSERT INTO catalog.code_batches (id, kit_id, grade, total, reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [batchId, kitId, grade, codeCount, 'sembrado de desarrollo', SEED_OPERATOR_ID],
    );

    const codes = [];
    const values = [];
    const tuples = [];

    for (let i = 0; i < codeCount; i += 1) {
      const code = generateCode();
      codes.push(code);
      const base = i * 6;
      tuples.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6})`);
      values.push(randomUUID(), hashCode(code, pepper), code.slice(-4), batchId, kitId, grade);
    }

    await client.query(
      `INSERT INTO catalog.activation_codes
         (id, code_hash, code_suffix, batch_id, kit_id, grade)
       VALUES ${tuples.join(',')}`,
      values,
    );

    await client.query('COMMIT');

    return { kitId, kitCode: resolvedKitCode, batchId, grade, codes };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Crea una institucion con licencia vigente y un salon.
 *
 * `capacity` es parametro porque la comprobacion del tope de plazas necesita un
 * salon deliberadamente pequeno (5) frente a muchas matriculas simultaneas.
 */
export async function seedInstitution({
  capacity = 30,
  grade = 'primary_6',
  teacherId = randomUUID(),
  academicYear = new Date().getFullYear(),
} = {}) {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_INSTITUTIONS') });
  await client.connect();

  try {
    const institutionId = randomUUID();
    const classroomId = randomUUID();
    const suffix = Date.now().toString(36).toUpperCase();

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO institutions.institutions
         (id, code, name, short_name, education_levels, responsible_name, contact_email, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        institutionId,
        `DEV${suffix}`,
        'Institucion Educativa de Desarrollo',
        'IE Desarrollo',
        ['primary', 'secondary'],
        'Responsable de Pruebas',
        `contacto.${suffix.toLowerCase()}@colegio.pe`,
        'Lima',
      ],
    );

    await client.query(
      `INSERT INTO institutions.licenses (id, institution_id, seats, starts_at, expires_at, granted_by)
       VALUES ($1,$2,$3, now() - interval '1 day', now() + interval '365 days', $4)`,
      [randomUUID(), institutionId, 500, SEED_OPERATOR_ID],
    );

    await client.query(
      `INSERT INTO institutions.classrooms
         (id, institution_id, teacher_id, name, grade, capacity, academic_year, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
      [classroomId, institutionId, teacherId, `Salon Dev ${suffix}`, grade, capacity, academicYear],
    );

    await client.query(
      `INSERT INTO institutions.teacher_directory (user_id, institution_id, full_name, email)
       VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`,
      [teacherId, institutionId, 'Docente de Desarrollo', `docente.${suffix.toLowerCase()}@colegio.pe`],
    );

    await client.query('COMMIT');

    return { institutionId, classroomId, teacherId, capacity, grade, academicYear };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Uso como script
// ---------------------------------------------------------------------------
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('seed-dev.mjs');

if (invokedDirectly) {
  const flagIndex = process.argv.indexOf('--codes');
  const codeCount = flagIndex > -1 ? Number.parseInt(process.argv[flagIndex + 1] ?? '30', 10) : 30;

  try {
    const catalog = await seedCatalog({ codeCount });
    const institution = await seedInstitution();

    console.log('Sembrado completo.\n');
    console.log(`  kit          ${catalog.kitId}  (${catalog.kitCode}, ${catalog.grade})`);
    console.log(`  lote         ${catalog.batchId}  (${catalog.codes.length} codigos)`);
    console.log(`  institucion  ${institution.institutionId}`);
    console.log(`  salon        ${institution.classroomId}  (capacidad ${institution.capacity})`);
    console.log('\nCodigos de activacion en claro (no se pueden recuperar despues):\n');
    for (const code of catalog.codes) console.log(`  ${code}`);
  } catch (error) {
    console.error(`\nError al sembrar: ${error.message}\n`);
    process.exitCode = 1;
  }
}
