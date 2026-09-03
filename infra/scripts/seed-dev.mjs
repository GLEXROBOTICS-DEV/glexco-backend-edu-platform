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
 * Necesita el monorepo compilado (`pnpm build`), porque importa el vocabulario
 * de `@glexco/contracts` en vez de repetirlo.
 *
 * Uso:
 *   node --env-file-if-exists=.env infra/scripts/seed-dev.mjs
 *   node --env-file-if-exists=.env infra/scripts/seed-dev.mjs --codes 40
 *
 * Tambien se importa como modulo desde smoke-test.mjs y concurrency-check.mjs.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import contracts from '@glexco/contracts';

// El alfabeto y el formato salen de los contratos, no de una copia local: si se
// desviaran, los codigos sembrados no pasarian la validacion del dominio y el
// fallo apareceria como "codigo invalido" sin pista de por que.
const {
  ACTIVATION_CODE_ALPHABET: ALPHABET,
  ACTIVATION_CODE_LENGTH: CODE_LENGTH,
  ACTIVATION_CODE_PREFIX: CODE_PREFIX,
  ROLES,
  ROLE_PERMISSIONS,
} = contracts;

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

    // Contenido academico minimo pero real: un curso publicado con una leccion
    // y dos recursos. Sin esto la biblioteca del kit responde vacia y no hay
    // nada sobre lo que probar la publicacion ni la invalidacion de cache.
    const courseId = randomUUID();
    const moduleId = randomUUID();
    const lessonId = randomUUID();
    const assetId = randomUUID();
    const draftAssetId = randomUUID();

    await client.query(
      `INSERT INTO catalog.courses
         (id, kit_id, title, description, robot_platform, order_index, status, estimated_minutes)
       VALUES ($1,$2,$3,$4,'ukit',0,'published',45)`,
      [courseId, kitId, 'Primeros pasos con uKit', 'Curso sembrado para pruebas.'],
    );

    await client.query(
      `INSERT INTO catalog.modules (id, course_id, title, order_index) VALUES ($1,$2,$3,0)`,
      [moduleId, courseId, 'Modulo 1'],
    );

    await client.query(
      `INSERT INTO catalog.lessons
         (id, course_id, module_id, title, description, order_index, status, estimated_minutes)
       VALUES ($1,$2,$3,$4,'',0,'published',15)`,
      [lessonId, courseId, moduleId, 'Conoce tu robot'],
    );

    await client.query(
      `INSERT INTO catalog.content_assets
         (id, kit_id, lesson_id, title, description, type, storage_kind, storage_ref,
          bucket, locale, status, order_index, downloadable)
       VALUES ($1,$2,$3,$4,'','document','object_storage',$5,'glexco-documents','es','published',0,true)`,
      [assetId, kitId, lessonId, 'Guia del docente', `kits/${kitId}/guia.pdf`],
    );

    // Uno en borrador a proposito: la biblioteca del alumno NO debe traerlo, y
    // sirve para probar la transicion a publicado.
    await client.query(
      `INSERT INTO catalog.content_assets
         (id, kit_id, lesson_id, title, description, type, storage_kind, storage_ref,
          bucket, locale, status, order_index, downloadable)
       VALUES ($1,$2,$3,$4,'','document','object_storage',$5,'glexco-documents','es','draft',1,false)`,
      [draftAssetId, kitId, lessonId, 'Ficha en preparacion', `kits/${kitId}/ficha.pdf`],
    );

    await client.query('COMMIT');

    return {
      kitId,
      kitCode: resolvedKitCode,
      batchId,
      grade,
      codes,
      courseId,
      lessonId,
      assetId,
      draftAssetId,
    };
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

    // El codigo viaja de vuelta porque es lo que teclea el alumno en el
    // formulario de registro: sin el, una comprobacion del portal tendria que
    // ir a buscarlo a la base, que es justo lo que este sembrador evita.
    return {
      institutionId,
      classroomId,
      teacherId,
      capacity,
      grade,
      academicYear,
      code: `DEV${suffix}`,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}


// ---------------------------------------------------------------------------
// Usuarios y tokens
// ---------------------------------------------------------------------------

/**
 * Crea usuarios directamente en identity.users.
 *
 * No es un atajo por comodidad: darlos de alta por HTTP chocaria con los
 * limites de fuerza bruta -cinco codigos por IP y hora, diez registros por IP y
 * hora-, que son correctos y no se van a relajar para que las herramientas de
 * desarrollo tengan la vida mas facil.
 *
 * `password_hash` es un marcador imposible de satisfacer: estos usuarios nunca
 * inician sesion, se les firma el token con `mintAccessToken`.
 */
export async function seedUsers(count, { roles = [ROLES.STUDENT], institutionId = null } = {}) {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_IDENTITY') });
  await client.connect();

  try {
    const users = [];
    const stamp = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const isStaff = !roles.includes(ROLES.STUDENT);

    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      users.push({ id, roles, institutionId });

      await client.query(
        `INSERT INTO identity.users
           (id, email, first_name, last_name, birth_date, password_hash, roles,
            institution_id, status, account_type, email_verified, locale,
            accepted_terms_at, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,true,'es', now(), 1)`,
        [
          id,
          `sembrado.${stamp}.${i}@colegio.pe`,
          'Usuario',
          `Sembrado ${i}`,
          isStaff ? null : '2008-03-15',
          '$argon2id$v=19$m=19456,t=2,p=1$c2VtaWxsYS1pbnZhbGlkYQ$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          roles,
          institutionId,
          isStaff ? 'staff' : institutionId ? 'institutional' : 'independent',
        ],
      );
    }

    return users;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Firma un access token con la misma forma que `JwtTokenIssuer`.
 *
 * Los guards lo verifican exactamente igual que uno emitido por identidad: la
 * verificacion es local, con el mismo secreto, emisor y audiencia.
 */
export function mintAccessToken({ userId, roles, institutionId = null }) {
  const permissions = [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role] ?? []))];

  return jwt.sign(
    {
      sub: userId,
      sid: randomUUID(),
      roles,
      perms: permissions,
      loc: 'es',
      jti: randomUUID(),
      ...(institutionId ? { inst: institutionId } : {}),
    },
    requireEnv('JWT_ACCESS_SECRET'),
    {
      algorithm: 'HS256',
      expiresIn: 900,
      issuer: requireEnv('JWT_ISSUER'),
      audience: requireEnv('JWT_AUDIENCE'),
    },
  );
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
    console.log(`  curso        ${catalog.courseId}  (publicado, 1 leccion, 2 recursos)`);
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
