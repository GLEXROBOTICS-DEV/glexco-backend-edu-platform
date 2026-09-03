#!/usr/bin/env node
/**
 * Comprobaciones de CONCURRENCIA real contra la infraestructura levantada.
 *
 * Son las cuatro cosas que justifican la arquitectura y que ninguna prueba en
 * memoria puede desmentir, porque todas dependen de que dos peticiones lleguen
 * de verdad a la vez a la misma fila de PostgreSQL:
 *
 *   3.1  el codigo de activacion es de un solo uso
 *   3.2  el salon respeta su tope de plazas
 *   3.3  la outbox no pierde eventos cuando el bus esta caido
 *   3.4  el consumidor deduplica un evento entregado dos veces
 *
 * Las dos primeras **funcionan igual de bien con el bloqueo de fila que sin el**
 * mientras se lancen en serie: en desarrollo nunca hay dos peticiones a la vez.
 * Por eso aqui se lanzan con `Promise.all`. En serie no probarian nada.
 *
 * Sobre los tokens: los alumnos se siembran directamente en la base y su token
 * se firma aqui con el mismo secreto que usa identidad. No es un atajo por
 * comodidad: registrarlos por HTTP chocaria con los limites de fuerza bruta
 * (cinco codigos por IP y hora, diez registros por IP y hora), que son
 * correctos y no se van a relajar. Lo que se esta midiendo es el bloqueo de
 * fila, no la autenticacion, y el guard verifica estos tokens exactamente igual
 * que los que emite el servicio.
 *
 * Uso:
 *   node --env-file-if-exists=.env infra/scripts/concurrency-check.mjs
 *   node --env-file-if-exists=.env infra/scripts/concurrency-check.mjs --only 3.1
 */
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import contracts from '@glexco/contracts';
import { mintAccessToken, seedCatalog, seedInstitution, seedUsers } from './seed-dev.mjs';

const run = promisify(execFile);

const { ROLES, ROLE_PERMISSIONS } = contracts;

const IDENTITY = 'http://localhost:3101';
const INSTITUTIONS = 'http://localhost:3102';
const CATALOG = 'http://localhost:3103';

/** Numero de peticiones simultaneas. Veinte basta para que la carrera se
 *  manifieste siempre y sigue siendo un numero realista: un salon entero
 *  activando su libro en el mismo minuto. */
const CONCURRENCY = 20;
const CLASSROOM_CAPACITY = 5;

const colors = {
  ok: '\x1b[32m',
  fail: '\x1b[31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

let passed = 0;
let failed = 0;

function report(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ${colors.ok}PASA${colors.reset}  ${name}`);
  } else {
    failed += 1;
    console.log(`  ${colors.fail}FALLA${colors.reset} ${name}`);
    if (detail) console.log(`        ${colors.dim}${detail}${colors.reset}`);
  }
}

function section(title) {
  console.log(`\n${colors.bold}${title}${colors.reset}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  return value;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

async function queryCatalog(sql, params = []) {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_CATALOG') });
  await client.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function queryInstitutions(sql, params = []) {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_INSTITUTIONS') });
  await client.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function queryIdentity(sql, params = []) {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_IDENTITY') });
  await client.connect();
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

async function postJson(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  let parsed = null;
  const text = await response.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  return { status: response.status, body: parsed };
}

const compose = ['compose', '-f', 'infra/docker/docker-compose.yml'];
const docker = (...args) => run('docker', [...compose, ...args], { windowsHide: true });

// ---------------------------------------------------------------------------
// 3.1  El codigo de activacion es de un solo uso
// ---------------------------------------------------------------------------
async function checkSingleUseActivationCode() {
  section('3.1  Codigo de activacion de un solo uso');

  const seeded = await seedCatalog({ codeCount: 1 });
  const target = seeded.codes[0];
  const students = await seedUsers(CONCURRENCY);

  // Se preparan TODOS los tokens antes de disparar: firmar dentro del
  // Promise.all introduciria decenas de milisegundos de diferencia entre
  // peticiones y la carrera dejaria de serlo.
  const tokens = students.map((student) =>
    mintAccessToken({ userId: student.id, roles: student.roles }),
  );

  const results = await Promise.all(
    tokens.map((token) => postJson(`${CATALOG}/api/v1/catalog/redeem`, token, { code: target })),
  );

  const succeeded = results.filter((r) => r.status === 200);
  const alreadyUsed = results.filter(
    (r) => r.status === 409 && r.body?.code === 'ACTIVATION_CODE_ALREADY_USED',
  );
  const other = results.filter((r) => !succeeded.includes(r) && !alreadyUsed.includes(r));

  report(
    `Exactamente 1 canje con exito de ${CONCURRENCY} simultaneos`,
    succeeded.length === 1,
    `exitos=${succeeded.length}`,
  );
  report(
    `Los otros ${CONCURRENCY - 1} reciben 409 ACTIVATION_CODE_ALREADY_USED`,
    alreadyUsed.length === CONCURRENCY - 1,
    `409=${alreadyUsed.length}, otros=${other.length} ${JSON.stringify(
      other.slice(0, 2).map((r) => ({ status: r.status, code: r.body?.code })),
    )}`,
  );

  const codeRows = await queryCatalog(
    `SELECT id, status, redeemed_by FROM catalog.activation_codes WHERE batch_id = $1`,
    [seeded.batchId],
  );
  const entitlements = await queryCatalog(
    `SELECT student_id FROM catalog.entitlements WHERE source_activation_code_id = $1`,
    [codeRows[0]?.id],
  );

  report(
    'El codigo queda en estado "redeemed"',
    codeRows[0]?.status === 'redeemed',
    `status=${codeRows[0]?.status}`,
  );
  report(
    'Hay EXACTAMENTE 1 fila en catalog.entitlements para ese codigo',
    entitlements.length === 1,
    `filas=${entitlements.length}`,
  );
  report(
    'El derecho es del mismo alumno que gano el canje',
    entitlements[0]?.student_id === codeRows[0]?.redeemed_by,
    `entitlement=${entitlements[0]?.student_id} codigo=${codeRows[0]?.redeemed_by}`,
  );
}

// ---------------------------------------------------------------------------
// 3.2  El tope de plazas del salon
// ---------------------------------------------------------------------------
async function checkClassroomCapacity() {
  section(`3.2  Tope de plazas del salon (capacidad ${CLASSROOM_CAPACITY})`);

  const { institutionId, classroomId } = await seedInstitution({ capacity: CLASSROOM_CAPACITY });
  const students = await seedUsers(CONCURRENCY, { institutionId });

  // Quien matricula es un administrador de la institucion, no cada alumno: es
  // la operacion del panel. El `institutionId` sale de SU token, nunca del
  // cuerpo de la peticion.
  const admin = (await seedUsers(1, { roles: [ROLES.INSTITUTION_ADMIN], institutionId }))[0];
  const adminToken = mintAccessToken({
    userId: admin.id,
    roles: admin.roles,
    institutionId,
  });

  const results = await Promise.all(
    students.map((student) =>
      postJson(`${INSTITUTIONS}/api/v1/classrooms/${classroomId}/enrollments`, adminToken, {
        studentId: student.id,
      }),
    ),
  );

  const admitted = results.filter((r) => r.status === 201);
  const rejected = results.filter((r) => r.status === 409 && r.body?.code === 'CLASSROOM_FULL');
  const other = results.filter((r) => !admitted.includes(r) && !rejected.includes(r));

  report(
    `Entran exactamente ${CLASSROOM_CAPACITY} de ${CONCURRENCY} simultaneos`,
    admitted.length === CLASSROOM_CAPACITY,
    `admitidos=${admitted.length}`,
  );
  report(
    `Los otros ${CONCURRENCY - CLASSROOM_CAPACITY} reciben CLASSROOM_FULL`,
    rejected.length === CONCURRENCY - CLASSROOM_CAPACITY,
    `rechazados=${rejected.length}, otros=${other.length} ${JSON.stringify(
      other.slice(0, 2).map((r) => ({ status: r.status, code: r.body?.code })),
    )}`,
  );

  const rows = await queryInstitutions(
    `SELECT count(*)::int AS total FROM institutions.enrollments
      WHERE classroom_id = $1 AND status = 'active'`,
    [classroomId],
  );

  report(
    `institutions.enrollments tiene ${CLASSROOM_CAPACITY} filas activas, ni una mas`,
    rows[0]?.total === CLASSROOM_CAPACITY,
    `filas=${rows[0]?.total}`,
  );

  return { institutionId };
}

// ---------------------------------------------------------------------------
// 3.3  La outbox no pierde eventos
// ---------------------------------------------------------------------------
async function checkOutboxSurvivesBusOutage() {
  section('3.3  La outbox no pierde eventos con el bus caido');

  const seeded = await seedCatalog({ codeCount: 1 });
  const { institutionId, classroomId } = await seedInstitution({ capacity: 30 });

  console.log(`  ${colors.dim}parando NATS...${colors.reset}`);
  await docker('stop', 'nats');

  const email = `outbox.${Date.now()}@colegio.pe`;
  const registration = await fetch(`${IDENTITY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'institutional',
      email,
      password: 'robotica-glexco-2026',
      firstName: 'Lucia',
      lastName: 'Quispe',
      birthDate: '2008-03-15',
      grade: seeded.grade,
      activationCode: seeded.codes[0],
      institutionId,
      classroomId,
      acceptedTerms: true,
      locale: 'es',
    }),
  });

  const registered = await registration.json();
  report(
    'El registro funciona con el bus caido',
    registration.status === 201,
    `status=${registration.status} ${JSON.stringify(registered).slice(0, 200)}`,
  );

  const userId = registered?.userId;

  const pending = await queryIdentity(
    `SELECT event_name, published_at FROM identity.outbox
      WHERE aggregate_id = $1 AND event_name = 'identity.user.registered.v1'`,
    [userId],
  );

  report(
    'El evento queda en identity.outbox SIN publicar',
    pending.length === 1 && pending[0].published_at === null,
    `filas=${pending.length} published_at=${pending[0]?.published_at}`,
  );

  console.log(`  ${colors.dim}levantando NATS de nuevo...${colors.reset}`);
  await docker('start', 'nats');

  // El relay drena por intervalo y con backoff; se le da margen suficiente.
  const publishedRow = await waitFor(
    async () => {
      const rows = await queryIdentity(
        `SELECT published_at FROM identity.outbox
          WHERE aggregate_id = $1 AND event_name = 'identity.user.registered.v1'`,
        [userId],
      );
      return rows[0]?.published_at ? rows[0] : null;
    },
    90_000,
  );

  report(
    'Al volver el bus, el relay publica el evento pendiente',
    Boolean(publishedRow),
    publishedRow ? '' : 'seguia sin publicar pasados 90 s',
  );

  const enrollment = await waitFor(
    async () => {
      const rows = await queryInstitutions(
        `SELECT status FROM institutions.enrollments
          WHERE classroom_id = $1 AND student_id = $2`,
        [classroomId, userId],
      );
      return rows[0] ?? null;
    },
    60_000,
  );

  report(
    'El alumno acaba matriculado: no se pierde, solo tarda mas',
    enrollment?.status === 'active',
    enrollment ? `status=${enrollment.status}` : 'nunca llego la matricula',
  );

  return { classroomId, institutionId, userId };
}

// ---------------------------------------------------------------------------
// 3.4  Deduplicacion de eventos
// ---------------------------------------------------------------------------
async function checkEventDeduplication() {
  section('3.4  Deduplicacion de un evento entregado dos veces');

  const { institutionId, classroomId } = await seedInstitution({ capacity: 30 });
  const [student] = await seedUsers(1, { institutionId });

  const eventId = randomUUID();
  const envelope = {
    metadata: {
      eventId,
      eventName: 'identity.user.registered.v1',
      occurredAt: new Date().toISOString(),
      aggregateType: 'User',
      aggregateId: student.id,
      aggregateVersion: 1,
      correlationId: randomUUID(),
      tenantId: institutionId,
    },
    payload: {
      userId: student.id,
      email: `dedup.${Date.now()}@colegio.pe`,
      firstName: 'Mateo',
      lastName: 'Rojas',
      roles: [ROLES.STUDENT],
      institutionId,
      classroomId,
      grade: 'primary_6',
      accountType: 'institutional',
    },
  };

  // Se publica DOS veces con `Nats-Msg-Id` distinto a proposito. Con el mismo
  // id lo descartaria JetStream y no se estaria probando nada del servicio: lo
  // que se quiere verificar es la tabla `processed_events`, que es la que
  // protege cuando la deduplicacion del bus no llega (ventana vencida,
  // reentrega tras un ack perdido).
  await publishToStream('identity.user.registered.v1', envelope, randomUUID());
  await publishToStream('identity.user.registered.v1', envelope, randomUUID());

  const processed = await waitFor(async () => {
    const rows = await queryInstitutions(
      `SELECT count(*)::int AS total FROM institutions.processed_events WHERE event_id = $1`,
      [eventId],
    );
    return rows[0]?.total >= 1 ? rows[0] : null;
  }, 60_000);

  report(
    'institutions.processed_events registra el evento UNA sola vez',
    processed?.total === 1,
    `filas=${processed?.total}`,
  );

  const enrollments = await queryInstitutions(
    `SELECT count(*)::int AS total FROM institutions.enrollments
      WHERE classroom_id = $1 AND student_id = $2`,
    [classroomId, student.id],
  );

  report(
    'La matricula se aplica UNA sola vez',
    enrollments[0]?.total === 1,
    `filas=${enrollments[0]?.total}`,
  );
}

/** Publica en el stream sin pasar por ningun servicio. */
async function publishToStream(subject, envelope, messageId) {
  const { connect, headers } = await import('nats');
  const connection = await connect({ servers: requireEnv('NATS_URL') });

  try {
    const jetstream = connection.jetstream();
    const messageHeaders = headers();
    messageHeaders.set('Nats-Msg-Id', messageId);
    await jetstream.publish(subject, Buffer.from(JSON.stringify(envelope)), {
      headers: messageHeaders,
      timeout: 5_000,
    });
  } finally {
    await connection.drain().catch(() => {});
  }
}

/** Reintenta `probe` hasta que devuelva algo distinto de null o venza el plazo. */
async function waitFor(probe, timeoutMs, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await probe().catch(() => null);
    if (result) return result;
    await sleep(intervalMs);
  }

  return null;
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`${colors.bold}Comprobaciones de concurrencia GLEXCO${colors.reset}`);
  console.log(`${colors.dim}${CONCURRENCY} peticiones simultaneas por prueba${colors.reset}`);

  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null;

  const checks = [
    ['3.1', checkSingleUseActivationCode],
    ['3.2', checkClassroomCapacity],
    ['3.3', checkOutboxSurvivesBusOutage],
    ['3.4', checkEventDeduplication],
  ];

  for (const [id, check] of checks) {
    if (only && only !== id) continue;
    await check();
  }

  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(`\n${colors.fail}La comprobacion se interrumpio:${colors.reset}`, error);
  // Si algo fallo con NATS parado, dejarlo parado romperia todo lo demas.
  await docker('start', 'nats').catch(() => {});
  process.exit(1);
});
