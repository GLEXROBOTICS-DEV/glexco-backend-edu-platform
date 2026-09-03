#!/usr/bin/env node
/**
 * Prueba de humo de punta a punta contra los servicios en ejecucion.
 *
 * Complementa a las pruebas unitarias, que corren en memoria y no tocan
 * infraestructura. Esta recorre el camino REAL: HTTP -> gateway -> identidad ->
 * PostgreSQL -> Redis, y verifica lo que solo se rompe cuando hay
 * infraestructura de verdad: migraciones sin aplicar, cookies mal configuradas,
 * el schema equivocado, Redis inaccesible.
 *
 * Uso:
 *   node infra/scripts/smoke-test.mjs                 # contra el gateway (3000)
 *   node infra/scripts/smoke-test.mjs --direct        # contra identidad (3101)
 *
 * No necesita dependencias: usa fetch nativo de Node.
 */
import {
  generateCode,
  mintAccessToken,
  seedCatalog,
  seedInstitution,
  seedUsers,
} from './seed-dev.mjs';
import contracts from '@glexco/contracts';

const { ROLES } = contracts;

/** El catalogo se prueba directo: no tiene rutas de autenticacion, asi que el
 *  gateway no anade nada a lo que aqui se verifica. */
const CATALOG = 'http://localhost:3103';
const MEDIA = 'http://localhost:3108';
const ASSESSMENT = 'http://localhost:3105';
const ANALYTICS = 'http://localhost:3107';
const INSTITUTIONS = 'http://localhost:3102';

const DIRECT = process.argv.includes('--direct');
const BASE = DIRECT ? 'http://localhost:3101' : 'http://localhost:3000';
const API = `${BASE}/api/v1`;

let passed = 0;
let failed = 0;
/** Cookies acumuladas entre peticiones: es como se prueba el refresh real. */
const cookieJar = new Map();

const colors = {
  ok: '\x1b[32m',
  fail: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

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

/** Debe coincidir con `RedisSessionStore.ROTATION_GRACE_MS`. */
const GRACE_WINDOW_MS = 10_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera a que el canje asincrono se refleje en los kits del alumno.
 *
 * El canje ocurre cuando catalogo consume el evento de alta, de modo que NO
 * esta hecho cuando la peticion de registro responde. Sondear es lo correcto
 * aqui: lo que se comprueba es que acaba ocurriendo, no cuando.
 */
/**
 * Sube al almacen con el POST prefirmado.
 *
 * Es multipart y el orden importa: los campos de la politica van ANTES del
 * archivo. S3 y MinIO leen el formulario en orden y descartan lo que llegue
 * despues del contenido.
 */
async function putToPresignedPost(presigned, body, contentType) {
  if (!presigned?.url) return 0;

  const form = new FormData();
  for (const [key, value] of Object.entries(presigned.fields ?? {})) {
    form.append(key, value);
  }
  form.append('file', new Blob([body], { type: contentType }));

  const response = await fetch(presigned.url, { method: 'POST', body: form });
  return response.status;
}

/** Reintenta hasta que `probe` devuelve algo distinto de null, o vence el plazo. */
async function waitFor(probe, timeoutMs, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe().catch(() => null);
    if (result) return result;
    await sleep(intervalMs);
  }
  return null;
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function postJson(url, token, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

async function waitForKits(studentId, timeoutMs = 30_000) {
  if (!studentId) return [];

  const token = mintAccessToken({ userId: studentId, roles: [ROLES.STUDENT] });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${CATALOG}/api/v1/catalog/my-kits`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);

    if (response?.ok) {
      const body = await response.json().catch(() => null);
      if (body?.kits?.length > 0) return body.kits;
    }

    await sleep(1_000);
  }

  return [];
}

function section(title) {
  console.log(`\n${colors.bold}${title}${colors.reset}`);
}

async function call(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };

  if (cookieJar.size > 0) {
    headers.cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const response = await fetch(`${API}${path}`, { ...options, headers });

  // Guarda las cookies que devuelva el servidor, para la siguiente llamada.
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index > 0) cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body, headers: response.headers };
}

async function main() {
  console.log(`${colors.bold}Prueba de humo GLEXCO${colors.reset}`);
  console.log(`${colors.dim}Objetivo: ${BASE}${colors.reset}`);

  // --------------------------------------------------------------------
  section('1. Salud del servicio');
  // --------------------------------------------------------------------
  try {
    const live = await fetch(`${BASE}/health/live`);
    report('/health/live responde 200', live.status === 200);

    const ready = await fetch(`${BASE}/health/ready`);
    const readyBody = await ready.json();
    report(
      '/health/ready reporta el servicio listo',
      ready.status === 200 && readyBody.status === 'ok',
      JSON.stringify(readyBody),
    );
  } catch (error) {
    report('El servicio responde', false, `${error.message} — ¿esta levantado?`);
    console.log(
      `\n${colors.fail}No se pudo contactar con ${BASE}.${colors.reset}\n` +
        `Levanta la infraestructura y el servicio:\n` +
        `  pnpm infra:up\n` +
        `  pnpm --filter @glexco/identity db:migrate\n` +
        `  pnpm --filter @glexco/identity dev\n`,
    );
    process.exit(1);
  }

  // --------------------------------------------------------------------
  section('2. Registro de alumno');
  // --------------------------------------------------------------------
  const stamp = Date.now();

  // Codigos reales, sembrados en el catalogo. Antes se usaban literales
  // `GLXTEST...` que solo aceptaba el doble en memoria: con CATALOG_URL
  // apuntando al servicio real, un codigo inexistente se rechaza -que es
  // justo lo que debe pasar- y la prueba de humo no podia pasar de aqui.
  let seeded;
  try {
    seeded = await seedCatalog({ codeCount: 3 });
  } catch (error) {
    report('Siembra codigos de activacion en el catalogo', false, error.message);
    console.log(
      `
${colors.fail}Sin codigos sembrados no se puede registrar a nadie.${colors.reset}
` +
        `Comprueba que catalog este migrado y que .env tenga DATABASE_URL_CATALOG
` +
        `y ACTIVATION_CODE_PEPPER.
`,
    );
    process.exit(1);
  }
  report('Siembra codigos de activacion en el catalogo', seeded.codes.length === 3);

  const student = {
    accountType: 'independent',
    email: `alumno.prueba.${stamp}@colegio.pe`,
    password: 'robotica-glexco-2026',
    firstName: 'Carlos',
    lastName: 'Salazar',
    birthDate: '2010-05-14',
    grade: 'primary_6',
    activationCode: seeded.codes[0],
    acceptedTerms: true,
    locale: 'es',
  };

  const registration = await call('/auth/register/student', {
    method: 'POST',
    body: JSON.stringify(student),
  });
  report(
    'Registra un alumno independiente',
    registration.status === 201,
    JSON.stringify(registration.body),
  );

  const duplicate = await call('/auth/register/student', {
    method: 'POST',
    body: JSON.stringify(student),
  });
  report(
    'Rechaza un correo duplicado con 409',
    duplicate.status === 409 && duplicate.body?.code === 'EMAIL_ALREADY_REGISTERED',
    `status=${duplicate.status} code=${duplicate.body?.code}`,
  );

  const badCode = await call('/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({
      ...student,
      email: `otro.${stamp}@colegio.pe`,
      // Bien formado pero inexistente: el literal anterior tenia 13 caracteres
      // en vez de 15, asi que fallaba en la validacion del formato y nunca
      // llegaba a comprobar contra el catalogo, que es lo que aqui interesa.
      activationCode: generateCode(),
    }),
  });
  report(
    'Rechaza un codigo de libro invalido',
    badCode.status === 422 && badCode.body?.code === 'ACTIVATION_CODE_INVALID',
    `status=${badCode.status} code=${badCode.body?.code}`,
  );

  const minorWithoutGuardian = await call('/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({
      ...student,
      email: `menor.${stamp}@colegio.pe`,
      birthDate: '2018-05-14',
      activationCode: seeded.codes[1],
    }),
  });
  report(
    'Exige correo de apoderado a un menor de 14',
    minorWithoutGuardian.status === 422,
    `status=${minorWithoutGuardian.status} code=${minorWithoutGuardian.body?.code}`,
  );

  // --------------------------------------------------------------------
  section('3. Inicio de sesion');
  // --------------------------------------------------------------------
  const login = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: student.email, password: student.password, rememberMe: false }),
  });
  report('Inicia sesion con credenciales correctas', login.status === 200);
  report('Devuelve un access token', Boolean(login.body?.accessToken));
  report(
    'Entrega el refresh token en cookie httpOnly (no en el cuerpo)',
    cookieJar.has('glexco_rt') && !JSON.stringify(login.body ?? {}).includes('glexco_rt'),
  );
  report(
    'Resuelve el portal segun la edad (Discover para 16 anos = academy)',
    login.body?.user?.portal === 'academy',
    `portal=${login.body?.user?.portal}`,
  );
  report(
    'Incluye los permisos resueltos en la respuesta',
    Array.isArray(login.body?.user?.permissions) &&
      login.body.user.permissions.includes('content:read'),
  );

  const accessToken = login.body?.accessToken;

  const wrongPassword = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: student.email, password: 'incorrecta', rememberMe: false }),
  });
  const unknownUser = await call('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: `noexiste.${stamp}@colegio.pe`,
      password: 'incorrecta',
      rememberMe: false,
    }),
  });
  report(
    'No distingue "usuario inexistente" de "contrasena incorrecta"',
    wrongPassword.status === unknownUser.status &&
      wrongPassword.body?.code === unknownUser.body?.code,
    `${wrongPassword.body?.code} vs ${unknownUser.body?.code}`,
  );

  // --------------------------------------------------------------------
  section('4. Sesion autenticada');
  // --------------------------------------------------------------------
  const me = await call('/auth/me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  report('/auth/me devuelve el actor autenticado', me.status === 200 && Boolean(me.body?.userId));

  const noToken = await call('/auth/me');
  report('/auth/me sin token responde 401', noToken.status === 401);

  const badToken = await call('/auth/me', {
    headers: { authorization: 'Bearer token.falsificado.aqui' },
  });
  report('/auth/me con token invalido responde 401', badToken.status === 401);

  const sessions = await call('/account/sessions', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  report(
    'Lista las sesiones activas',
    sessions.status === 200 && Array.isArray(sessions.body) && sessions.body.length >= 1,
    JSON.stringify(sessions.body),
  );

  // --------------------------------------------------------------------
  section('5. Rotacion del refresh token');
  // --------------------------------------------------------------------
  const firstRefreshToken = cookieJar.get('glexco_rt');

  const refreshed = await call('/auth/refresh', { method: 'POST' });
  report('Refresca la sesion desde la cookie', refreshed.status === 200);
  report(
    'La rotacion entrega un refresh token DISTINTO',
    cookieJar.get('glexco_rt') !== firstRefreshToken,
  );

  // El token ANTIGUO, reenviado DENTRO de la ventana de gracia. Debe aceptarse:
  // dos pestanas del mismo navegador refrescan a la vez continuamente, y tratar
  // eso como robo cerraria la sesion a un usuario al que nadie ha atacado.
  cookieJar.set('glexco_rt', firstRefreshToken);
  const graceReuse = await call('/auth/refresh', { method: 'POST' });
  report(
    'Acepta el token anterior dentro de la ventana de gracia',
    graceReuse.status === 200,
    `status=${graceReuse.status} code=${graceReuse.body?.code}`,
  );

  // El mismo token, ya FUERA de la ventana. Ahi si es reutilizacion real: un
  // token robado nunca llega en los primeros diez segundos.
  await sleep(GRACE_WINDOW_MS + 1_000);
  cookieJar.set('glexco_rt', firstRefreshToken);
  const reuse = await call('/auth/refresh', { method: 'POST' });
  report(
    'Detecta la reutilizacion fuera de la gracia y revoca la sesion',
    reuse.status === 401 && reuse.body?.code === 'SESSION_COMPROMISED',
    `status=${reuse.status} code=${reuse.body?.code}`,
  );

  // --------------------------------------------------------------------
  section('6. Recuperacion de contrasena');
  // --------------------------------------------------------------------
  const resetExisting = await call('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: student.email, locale: 'es' }),
  });
  const resetUnknown = await call('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ email: `fantasma.${stamp}@colegio.pe`, locale: 'es' }),
  });
  report(
    'No revela si la cuenta existe (misma respuesta en ambos casos)',
    resetExisting.status === resetUnknown.status && resetExisting.status === 202,
    `${resetExisting.status} vs ${resetUnknown.status}`,
  );

  // --------------------------------------------------------------------
  section('7. Trazabilidad');
  // --------------------------------------------------------------------
  const traced = await fetch(`${BASE}/health/live`);
  report(
    'Devuelve x-correlation-id en la respuesta',
    Boolean(traced.headers.get('x-correlation-id')),
  );

  const echoed = await fetch(`${BASE}/health/live`, {
    headers: { 'x-correlation-id': '00000000-0000-4000-8000-000000000abc' },
  });
  report(
    'Propaga el x-correlation-id que envia el cliente',
    echoed.headers.get('x-correlation-id') === '00000000-0000-4000-8000-000000000abc',
  );

  // --------------------------------------------------------------------
  section('8. Catalogo: lote de imprenta y canje asincrono');
  // --------------------------------------------------------------------
  const kit = await seedCatalog({ codeCount: 1 });
  const [operator] = await seedUsers(1, { roles: [ROLES.PLATFORM_ADMIN] });
  const operatorToken = mintAccessToken({ userId: operator.id, roles: operator.roles });

  const batch = await fetch(`${CATALOG}/api/v1/catalog/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ kitId: kit.kitId, size: 5, reference: 'OC-HUMO' }),
  });
  const batchBody = await batch.json().catch(() => null);

  report(
    'Genera un lote de codigos',
    batch.status === 201 && batchBody?.codes?.length === 5,
    `status=${batch.status} ${JSON.stringify(batchBody).slice(0, 200)}`,
  );
  report(
    'Los codigos llegan en claro UNA vez, con aviso explicito',
    typeof batchBody?.aviso === 'string' && batchBody.aviso.includes('no volveran a mostrarse'),
  );

  const summary = await fetch(`${CATALOG}/api/v1/catalog/batches/${batchBody?.batchId}`, {
    headers: { authorization: `Bearer ${operatorToken}` },
  });
  const summaryBody = await summary.json().catch(() => null);
  report(
    'El resumen del lote cuenta 5 emitidos y 0 canjeados',
    summary.status === 200 &&
      summaryBody?.total === 5 &&
      summaryBody?.issued === 5 &&
      summaryBody?.redeemed === 0,
    JSON.stringify(summaryBody),
  );

  const csv = await fetch(`${CATALOG}/api/v1/catalog/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${operatorToken}` },
    body: JSON.stringify({ kitId: kit.kitId, size: 3, format: 'csv' }),
  });
  // Se leen los BYTES, no el texto: al decodificar, fetch descarta un BOM
  // inicial, asi que comprobarlo sobre .text() nunca daria positivo aunque
  // el fichero lo lleve.
  const csvBytes = new Uint8Array(await csv.arrayBuffer());
  const csvBody = new TextDecoder('utf-8').decode(csvBytes);
  const hasBom = csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
  report(
    'La exportacion CSV llega como adjunto y sin cachear',
    csv.status === 201 &&
      (csv.headers.get('content-type') ?? '').startsWith('text/csv') &&
      (csv.headers.get('content-disposition') ?? '').includes('attachment') &&
      csv.headers.get('cache-control') === 'no-store',
    `type=${csv.headers.get('content-type')} disp=${csv.headers.get('content-disposition')}`,
  );
  report(
    'El CSV trae BOM, cabecera y una fila por codigo',
    hasBom && csvBody.trim().split('\r\n').length === 4,
    `lineas=${csvBody.trim().split('\r\n').length}`,
  );

  // Un alumno no puede fabricar codigos. Es la separacion entre el personal de
  // GLEXCO y quien usa la plataforma, y vale dinero: quien pueda generar lotes
  // puede regalarse acceso indefinido.
  const [pupil] = await seedUsers(1);
  const forbidden = await fetch(`${CATALOG}/api/v1/catalog/batches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${mintAccessToken({ userId: pupil.id, roles: pupil.roles })}`,
    },
    body: JSON.stringify({ kitId: kit.kitId, size: 1 }),
  });
  report('Un alumno no puede generar lotes', forbidden.status === 403, `status=${forbidden.status}`);

  // El canje asincrono cierra el flujo del registro: identidad solo COMPRUEBA
  // el codigo -canjearlo alli exigiria una transaccion distribuida- y catalogo
  // lo canjea al consumir el alta.
  const institution = await seedInstitution({ capacity: 30, grade: kit.grade });
  const asyncRegistration = await call('/auth/register/student', {
    method: 'POST',
    body: JSON.stringify({
      accountType: 'institutional',
      email: `canje.async.${stamp}@colegio.pe`,
      password: 'robotica-glexco-2026',
      firstName: 'Renata',
      lastName: 'Ccahuana',
      birthDate: '2008-03-15',
      grade: kit.grade,
      activationCode: batchBody?.codes?.[0],
      institutionId: institution.institutionId,
      classroomId: institution.classroomId,
      acceptedTerms: true,
      locale: 'es',
    }),
  });

  report(
    'Registra a un alumno con un codigo del lote recien generado',
    asyncRegistration.status === 201,
    JSON.stringify(asyncRegistration.body),
  );

  const grantedKits = await waitForKits(asyncRegistration.body?.userId);
  report(
    'Catalogo canjea al consumir el alta y concede el derecho al kit',
    grantedKits.length === 1 && grantedKits[0]?.kitId === kit.kitId,
    `kits=${JSON.stringify(grantedKits)}`,
  );

  // --------------------------------------------------------------------
  section('9. Contenido: derecho de acceso, cache y anulacion');
  // --------------------------------------------------------------------
  // El alumno del canje asincrono ya tiene derecho al kit: se usa para
  // comprobar que ve SU contenido y solo el publicado.
  const pupilToken = mintAccessToken({
    userId: asyncRegistration.body?.userId,
    roles: [ROLES.STUDENT],
  });

  const library = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${kit.kitId}`,
    pupilToken,
  );
  report(
    'La biblioteca del kit trae solo el recurso publicado',
    library.status === 200 && library.body?.items?.length === 1,
    `status=${library.status} items=${library.body?.items?.length}`,
  );

  // Segunda lectura idéntica: la sirve la cache. No se puede observar desde
  // fuera, así que lo que se comprueba es que el resultado es el mismo -una
  // cache que devolviera otra cosa sería peor que no tenerla-.
  const libraryCached = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${kit.kitId}`,
    pupilToken,
  );
  report(
    'La segunda lectura devuelve exactamente lo mismo',
    JSON.stringify(libraryCached.body) === JSON.stringify(library.body),
  );

  // Se publica el recurso que estaba en borrador. Sin invalidacion por
  // etiqueta, la biblioteca seguiria devolviendo uno solo hasta que venciera
  // el TTL de diez minutos.
  const toReview = await postJson(
    `${CATALOG}/api/v1/catalog/content/${kit.draftAssetId}/status`,
    operatorToken,
    { target: 'asset', status: 'in_review' },
  );
  const published = await postJson(
    `${CATALOG}/api/v1/catalog/content/${kit.draftAssetId}/status`,
    operatorToken,
    { target: 'asset', status: 'published' },
  );
  report(
    'Publicar exige pasar por revision (draft -> in_review -> published)',
    toReview.status === 200 && published.status === 200,
    `revision=${toReview.status} publicado=${published.status}`,
  );

  const skipReview = await postJson(
    `${CATALOG}/api/v1/catalog/content/${kit.assetId}/status`,
    operatorToken,
    { target: 'asset', status: 'draft' },
  );
  report(
    'Un salto de estado no permitido se rechaza',
    skipReview.status === 422 && skipReview.body?.code === 'INVALID_PUBLICATION_TRANSITION',
    `status=${skipReview.status} code=${skipReview.body?.code}`,
  );

  const libraryAfter = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${kit.kitId}`,
    pupilToken,
  );
  report(
    'Al publicar, la cache se invalida y el recurso nuevo aparece de inmediato',
    libraryAfter.body?.items?.length === 2,
    `items=${libraryAfter.body?.items?.length}`,
  );

  // Aislamiento: un alumno sin derecho a ese kit no ve su biblioteca, y el
  // error es el mismo que si el kit no existiera.
  const [outsider] = await seedUsers(1);
  const denied = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${kit.kitId}`,
    mintAccessToken({ userId: outsider.id, roles: outsider.roles }),
  );
  report(
    'Un alumno sin derecho no ve la biblioteca del kit',
    denied.status === 403 && denied.body?.code === 'KIT_NOT_ACCESSIBLE',
    `status=${denied.status} code=${denied.body?.code}`,
  );

  // Anulacion: soporte localiza el codigo por su sufijo y lo anula. El derecho
  // que concedio se retira en la MISMA transaccion.
  const batchCodes = await getJson(
    `${CATALOG}/api/v1/catalog/batches/${batchBody?.batchId}/codes`,
    operatorToken,
  );
  const redeemedRow = batchCodes.body?.items?.find((item) => item.status === 'redeemed');
  report(
    'El listado del lote muestra el sufijo y nunca el codigo',
    batchCodes.status === 200 &&
      batchCodes.body?.items?.length === 5 &&
      batchCodes.body.items.every(
        (item) => item.codeSuffix?.length === 4 && item.code === undefined,
      ),
    `items=${batchCodes.body?.items?.length}`,
  );

  const revoked = await postJson(
    `${CATALOG}/api/v1/catalog/activation-codes/${redeemedRow?.activationCodeId}/revoke`,
    operatorToken,
    { reason: 'devolucion del libro en la prueba de humo' },
  );
  report(
    'Anular un codigo canjeado retira tambien el derecho de acceso',
    revoked.status === 200 && revoked.body?.entitlementRevoked === true,
    `status=${revoked.status} ${JSON.stringify(revoked.body)}`,
  );

  const kitsAfterRevoke = await getJson(`${CATALOG}/api/v1/catalog/my-kits`, pupilToken);
  report(
    'El alumno deja de tener el kit tras la anulacion',
    kitsAfterRevoke.body?.kits?.length === 0,
    `kits=${JSON.stringify(kitsAfterRevoke.body?.kits)}`,
  );

  const reRevoke = await postJson(
    `${CATALOG}/api/v1/catalog/activation-codes/${redeemedRow?.activationCodeId}/revoke`,
    operatorToken,
    { reason: 'reintento de soporte' },
  );
  report(
    'Anular dos veces es idempotente, no un error',
    reRevoke.status === 200,
    `status=${reRevoke.status}`,
  );

  // --------------------------------------------------------------------
  section('10. Medios: subida prefirmada y validacion de tipo real');
  // --------------------------------------------------------------------
  const [uploader] = await seedUsers(1);
  const uploaderToken = mintAccessToken({ userId: uploader.id, roles: uploader.roles });

  // Un PNG minimo valido: firma de ocho bytes mas una cabecera IHDR.
  const realPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478' +
      '9c6300010000050001' +
      '0d0a2db40000000049454e44ae426082',
    'hex',
  );

  const upload = await postJson(`${MEDIA}/api/v1/media/uploads`, uploaderToken, {
    scope: 'evidence',
    mimeType: 'image/png',
    filename: 'evidencia.png',
    sizeBytes: realPng.length,
  });

  report(
    'Entrega una URL prefirmada con politica de tamano',
    upload.status === 201 && Boolean(upload.body?.url) && Boolean(upload.body?.fields),
    `status=${upload.status} ${JSON.stringify(upload.body).slice(0, 160)}`,
  );

  const uploaded = await putToPresignedPost(upload.body, realPng, 'image/png');
  report('El archivo sube directo al almacen, sin pasar por el servicio', uploaded < 400, `status=${uploaded}`);

  const confirmed = await postJson(
    `${MEDIA}/api/v1/media/uploads/${upload.body?.mediaAssetId}/confirm`,
    uploaderToken,
    {},
  );
  report(
    'Confirma la subida y detecta image/png por su firma binaria',
    confirmed.status === 200 &&
      confirmed.body?.status === 'ready' &&
      confirmed.body?.mimeType === 'image/png',
    JSON.stringify(confirmed.body),
  );
  report(
    'Genera la miniatura de la imagen',
    Boolean(confirmed.body?.thumbnailKey),
    `thumbnail=${confirmed.body?.thumbnailKey}`,
  );

  const downloadUrl = await getJson(
    `${MEDIA}/api/v1/media/${upload.body?.mediaAssetId}/url`,
    uploaderToken,
  );
  report(
    'Entrega una URL de descarga firmada y de vida corta',
    downloadUrl.status === 200 &&
      typeof downloadUrl.body?.url === 'string' &&
      downloadUrl.body.url.includes('X-Amz-Signature'),
    `status=${downloadUrl.status}`,
  );

  // Aislamiento: otro alumno, de otra institucion, no descarga esto.
  const [stranger] = await seedUsers(1);
  const strangerAccess = await getJson(
    `${MEDIA}/api/v1/media/${upload.body?.mediaAssetId}/url`,
    mintAccessToken({ userId: stranger.id, roles: stranger.roles }),
  );
  report(
    'Otro usuario no obtiene la URL de un archivo ajeno',
    strangerAccess.status === 422 && strangerAccess.body?.code === 'MEDIA_NOT_ACCESSIBLE',
    `status=${strangerAccess.status} code=${strangerAccess.body?.code}`,
  );

  // LA comprobacion que justifica el servicio: un ejecutable renombrado a .pdf
  // y declarado como application/pdf. Pasa cualquier validacion que se fie de
  // la extension o del Content-Type; no pasa la de la firma binaria.
  const fakePdf = Buffer.concat([
    Buffer.from('MZ', 'ascii'), // cabecera de ejecutable de Windows
    Buffer.from('90000300000004000000ffff0000', 'hex'),
  ]);

  const badUpload = await postJson(`${MEDIA}/api/v1/media/uploads`, uploaderToken, {
    scope: 'document',
    mimeType: 'application/pdf',
    filename: 'inofensivo.pdf',
    sizeBytes: fakePdf.length,
  });
  await putToPresignedPost(badUpload.body, fakePdf, 'application/pdf');

  const badConfirm = await postJson(
    `${MEDIA}/api/v1/media/uploads/${badUpload.body?.mediaAssetId}/confirm`,
    uploaderToken,
    {},
  );
  report(
    'Rechaza un ejecutable renombrado a .pdf, pese a declararse application/pdf',
    badConfirm.status === 200 && badConfirm.body?.status === 'rejected',
    JSON.stringify(badConfirm.body),
  );

  const rejectedAccess = await getJson(
    `${MEDIA}/api/v1/media/${badUpload.body?.mediaAssetId}/url`,
    uploaderToken,
  );
  report(
    'Un archivo rechazado no se puede descargar',
    rejectedAccess.status === 422 && rejectedAccess.body?.code === 'MEDIA_NOT_READY',
    `status=${rejectedAccess.status} code=${rejectedAccess.body?.code}`,
  );

  const notAccepted = await postJson(`${MEDIA}/api/v1/media/uploads`, uploaderToken, {
    scope: 'document',
    mimeType: 'application/x-msdownload',
    filename: 'programa.exe',
    sizeBytes: 1024,
  });
  report(
    'Un tipo fuera de la lista no llega ni a firmarse',
    notAccepted.status === 422,
    `status=${notAccepted.status} code=${notAccepted.body?.code}`,
  );

  // --------------------------------------------------------------------
  section('11. Enlaces externos');
  // --------------------------------------------------------------------
  const linkOk = await postJson(`${MEDIA}/api/v1/media/links`, uploaderToken, {
    scope: 'evidence',
    url: 'https://contoso.sharepoint.com/sites/robotica/Documentos/exposicion.mp4',
    title: 'Exposicion del grupo 3',
  });
  report(
    'Acepta un enlace de un dominio institucional',
    linkOk.status === 201 && linkOk.body?.host === 'contoso.sharepoint.com',
    `status=${linkOk.status} ${JSON.stringify(linkOk.body).slice(0, 160)}`,
  );
  report(
    'Advierte del permiso del enlace, que es el fallo mas comun',
    typeof linkOk.body?.warning === 'string' && linkOk.body.warning.includes('acceso denegado'),
  );

  for (const [caso, url, code] of [
    ['un dominio fuera de la lista', 'https://sitio-cualquiera.com/video.mp4', 'LINK_HOST_NOT_ALLOWED'],
    ['un acortador', 'https://bit.ly/3xYzAbC', 'LINK_SHORTENER_NOT_ALLOWED'],
    ['http sin cifrar', 'http://drive.google.com/file/d/abc', 'LINK_NOT_HTTPS'],
    [
      'credenciales incrustadas',
      'https://user:clave@drive.google.com/file/d/abc',
      'LINK_HAS_CREDENTIALS',
    ],
    [
      'un dominio que solo TERMINA parecido',
      'https://malicioso-sharepoint.com/x',
      'LINK_HOST_NOT_ALLOWED',
    ],
  ]) {
    const rejected = await postJson(`${MEDIA}/api/v1/media/links`, uploaderToken, {
      scope: 'evidence',
      url,
      title: 'intento',
    });
    report(
      `Rechaza ${caso}`,
      rejected.status === 422 && rejected.body?.code === code,
      `status=${rejected.status} code=${rejected.body?.code}`,
    );
  }

  const linkUrl = await getJson(
    `${MEDIA}/api/v1/media/${linkOk.body?.mediaAssetId}/url`,
    uploaderToken,
  );
  report(
    'La descarga de un enlace devuelve la direccion tal cual, sin firmar nada',
    linkUrl.status === 200 && linkUrl.body?.url?.includes('sharepoint.com'),
    `status=${linkUrl.status}`,
  );

  // --------------------------------------------------------------------
  section('12. Evaluaciones: banco de GLEXCO y del docente');
  // --------------------------------------------------------------------
  const evalKit = await seedCatalog({ codeCount: 1 });
  const institutionForExams = await seedInstitution({ capacity: 30, grade: evalKit.grade });

  const [contentManager] = await seedUsers(1, { roles: [ROLES.CONTENT_MANAGER] });
  const glexcoToken = mintAccessToken({ userId: contentManager.id, roles: contentManager.roles });

  const [teacher] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: institutionForExams.institutionId,
  });
  const teacherToken = mintAccessToken({
    userId: teacher.id,
    roles: teacher.roles,
    institutionId: institutionForExams.institutionId,
  });

  // GLEXCO crea el cuestionario que viene con el kit, igual para todos.
  const glexcoQuiz = await postJson(`${ASSESSMENT}/api/v1/assessments`, glexcoToken, {
    kitId: evalKit.kitId,
    kind: 'quiz',
    title: 'Reconoce las piezas del uKit',
    passingScore: 60,
  });
  report(
    'El equipo de GLEXCO crea una evaluacion del banco comun',
    glexcoQuiz.status === 201,
    `status=${glexcoQuiz.status} ${JSON.stringify(glexcoQuiz.body).slice(0, 140)}`,
  );

  const q1 = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'single_choice',
      prompt: 'Cual de estas piezas es un servomotor?',
      options: [{ text: 'El bloque azul' }, { text: 'El servo' }, { text: 'El cable' }],
      correctOptions: [1],
      points: 10,
    },
  );
  report('Anade una pregunta de marcar', q1.status === 201, `status=${q1.status}`);

  const sinClave = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'single_choice',
      prompt: 'Pregunta sin respuesta marcada',
      options: [{ text: 'A' }, { text: 'B' }],
      points: 5,
    },
  );
  report(
    'Rechaza una pregunta de marcar sin respuesta correcta',
    sinClave.status === 422,
    `status=${sinClave.status} code=${sinClave.body?.code}`,
  );

  const publicada = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/publish`,
    glexcoToken,
    {},
  );
  report('Publica la evaluacion', publicada.status === 200, `status=${publicada.status}`);

  // La regla que mas se intentara saltar.
  const intentoDeEdicion = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/questions`,
    teacherToken,
    { type: 'true_false', prompt: 'Intento del docente', options: [{ text: 'Si' }, { text: 'No' }], correctOptions: [0], points: 5 },
  );
  report(
    'Un docente NO puede modificar una evaluacion de GLEXCO',
    intentoDeEdicion.status === 403 &&
      intentoDeEdicion.body?.code === 'ASSESSMENT_IS_GLEXCO_CONTENT',
    `status=${intentoDeEdicion.status} code=${intentoDeEdicion.body?.code}`,
  );

  const copia = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/clone`,
    teacherToken,
    { classroomId: institutionForExams.classroomId },
  );
  report(
    'Pero SI puede duplicarla para adaptarla',
    copia.status === 201 && Boolean(copia.body?.assessmentId),
    `status=${copia.status}`,
  );

  const banco = await getJson(
    `${ASSESSMENT}/api/v1/assessments?kitId=${evalKit.kitId}`,
    teacherToken,
  );
  const delBanco = banco.body?.items?.find((a) => a.origin === 'glexco');
  const propia = banco.body?.items?.find((a) => a.origin === 'institution');
  report(
    'El banco del docente marca que es editable y que no',
    delBanco?.editable === false && propia?.editable === true,
    `glexco.editable=${delBanco?.editable} propia.editable=${propia?.editable}`,
  );

  // --------------------------------------------------------------------
  section('13. Evaluaciones: el alumno responde y se corrige solo');
  // --------------------------------------------------------------------
  const [examinee] = await seedUsers(1, { institutionId: institutionForExams.institutionId });
  const examineeToken = mintAccessToken({
    userId: examinee.id,
    roles: examinee.roles,
    institutionId: institutionForExams.institutionId,
  });

  const intento = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/attempts`,
    examineeToken,
    { classroomId: institutionForExams.classroomId },
  );
  report(
    'El alumno abre un intento y recibe las preguntas',
    intento.status === 201 && intento.body?.questions?.length === 1,
    `status=${intento.status} preguntas=${intento.body?.questions?.length}`,
  );

  // LA comprobacion que justifica el servicio.
  const serializado = JSON.stringify(intento.body);
  report(
    'La clave de correccion NO viaja al alumno',
    !serializado.includes('correctOptionIds') && !serializado.includes('explanation'),
  );

  const repetido = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/attempts`,
    examineeToken,
    { classroomId: institutionForExams.classroomId },
  );
  report(
    'Volver a abrir devuelve el MISMO intento, no uno nuevo',
    repetido.body?.submissionId === intento.body?.submissionId,
    `${repetido.body?.submissionId} vs ${intento.body?.submissionId}`,
  );

  const pregunta = intento.body?.questions?.[0];
  const correcta = pregunta?.options?.find((o) => o.text === 'El servo');

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${intento.body?.submissionId}/answers`,
    examineeToken,
    { questionId: pregunta?.id, selectedOptionIds: [correcta?.id] },
  );

  const entregado = await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${intento.body?.submissionId}/submit`,
    examineeToken,
    {},
  );
  report(
    'Al entregar, lo de marcar se corrige al instante',
    entregado.status === 200 &&
      entregado.body?.status === 'graded' &&
      entregado.body?.score === 10 &&
      entregado.body?.passed === true,
    JSON.stringify(entregado.body),
  );

  const reentrega = await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${intento.body?.submissionId}/submit`,
    examineeToken,
    {},
  );
  report(
    'Entregar dos veces es idempotente, no corrige de nuevo',
    reentrega.status === 200 && reentrega.body?.score === 10,
    `score=${reentrega.body?.score}`,
  );

  const congelada = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/questions`,
    glexcoToken,
    { type: 'true_false', prompt: 'Tarde', options: [{ text: 'Si' }, { text: 'No' }], correctOptions: [0], points: 5 },
  );
  report(
    'Con entregas hechas, ya no se pueden cambiar las preguntas',
    congelada.status === 422 && congelada.body?.code === 'ASSESSMENT_HAS_SUBMISSIONS',
    `status=${congelada.status} code=${congelada.body?.code}`,
  );

  // Aislamiento: un alumno de otra institucion no ve esta evaluacion propia.
  const otraInstitucion = await seedInstitution({ capacity: 10, grade: evalKit.grade });
  const [ajeno] = await seedUsers(1, { institutionId: otraInstitucion.institutionId });
  const intentoAjeno = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${copia.body?.assessmentId}/attempts`,
    mintAccessToken({
      userId: ajeno.id,
      roles: ajeno.roles,
      institutionId: otraInstitucion.institutionId,
    }),
    {},
  );
  report(
    'Un alumno de otra institucion no accede a la evaluacion de este colegio',
    intentoAjeno.status === 404,
    `status=${intentoAjeno.status} code=${intentoAjeno.body?.code}`,
  );

  // --------------------------------------------------------------------
  section('14. Dashboards: los cuatro niveles y su aislamiento');
  // --------------------------------------------------------------------
  // La analitica es una PROYECCION alimentada por eventos, asi que la nota que
  // el alumno acaba de sacar tarda un instante en aparecer. Sondear comprueba
  // que ACABA apareciendo, que es lo unico que se le puede exigir.
  const myDashboard = await waitFor(async () => {
    const response = await getJson(`${ANALYTICS}/api/v1/analytics/me`, examineeToken);
    return response.status === 200 && response.body?.assessmentsTaken > 0 ? response.body : null;
  }, 30_000);

  report(
    'El alumno ve su propio dashboard, alimentado por el evento de correccion',
    Boolean(myDashboard),
    myDashboard ? '' : 'la proyeccion no llego en 30 s',
  );
  report(
    'Separa la media de GLEXCO de la del docente',
    myDashboard?.averageGlexco === 100 && myDashboard?.averageInstitution === null,
    `glexco=${myDashboard?.averageGlexco} institucion=${myDashboard?.averageInstitution}`,
  );
  report(
    'Trae la evolucion en el tiempo, no solo el numero final',
    Array.isArray(myDashboard?.timeline) && myDashboard.timeline.length >= 1,
    `puntos=${myDashboard?.timeline?.length}`,
  );

  // El identificador sale del token: no hay forma de pedir el de otro.
  const otherStudentDashboard = await getJson(
    `${ANALYTICS}/api/v1/analytics/me`,
    mintAccessToken({ userId: outsider.id, roles: outsider.roles }),
  );
  report(
    'El dashboard propio sale del token: otro alumno ve el suyo, vacio',
    otherStudentDashboard.status === 200 && otherStudentDashboard.body?.assessmentsTaken === 0,
    `entregas=${otherStudentDashboard.body?.assessmentsTaken}`,
  );

  // --- Salon: lo ve su docente ---
  // El salon se crea por la API REAL, no sembrado por SQL, y eso es
  // deliberado: la analitica aprende quien es el docente de cada salon del
  // evento `institutions.classroom.created.v1`, y un salon insertado a mano no
  // emite ningun evento. Sin pasar por la API no se estaria probando el camino
  // que existe en produccion.
  const [ownerTeacher] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: institutionForExams.institutionId,
  });
  const ownerTeacherToken = mintAccessToken({
    userId: ownerTeacher.id,
    roles: ownerTeacher.roles,
    institutionId: institutionForExams.institutionId,
  });

  const createdClassroom = await postJson(
    `${INSTITUTIONS}/api/v1/classrooms`,
    ownerTeacherToken,
    {
      name: `Salon Analitica ${stamp}`,
      grade: evalKit.grade,
      capacity: 30,
      academicYear: new Date().getFullYear(),
      teacherId: ownerTeacher.id,
    },
  );

  report(
    'Crea un salon por la API, que es lo que emite el evento',
    createdClassroom.status === 201 && Boolean(createdClassroom.body?.classroomId),
    `status=${createdClassroom.status} ${JSON.stringify(createdClassroom.body).slice(0, 160)}`,
  );

  const analyticsClassroomId = createdClassroom.body?.classroomId;

  // Un alumno de ese salon responde el cuestionario de GLEXCO.
  const [pupilInClassroom] = await seedUsers(1, {
    institutionId: institutionForExams.institutionId,
  });
  const pupilInClassroomToken = mintAccessToken({
    userId: pupilInClassroom.id,
    roles: pupilInClassroom.roles,
    institutionId: institutionForExams.institutionId,
  });

  const classroomAttempt = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${glexcoQuiz.body?.assessmentId}/attempts`,
    pupilInClassroomToken,
    { classroomId: analyticsClassroomId },
  );

  const classroomQuestion = classroomAttempt.body?.questions?.[0];
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${classroomAttempt.body?.submissionId}/answers`,
    pupilInClassroomToken,
    {
      questionId: classroomQuestion?.id,
      // Se responde MAL a proposito: asi el dashboard tiene algo que senalar en
      // "preguntas que mas falla el salon", que es su dato mas accionable.
      selectedOptionIds: [classroomQuestion?.options?.find((o) => o.text !== 'El servo')?.id],
    },
  );
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${classroomAttempt.body?.submissionId}/submit`,
    pupilInClassroomToken,
    {},
  );

  const classroomDash = await waitFor(async () => {
    const response = await getJson(
      `${ANALYTICS}/api/v1/analytics/classrooms/${analyticsClassroomId}`,
      ownerTeacherToken,
    );
    return response.status === 200 && response.body?.studentsMeasured > 0 ? response.body : null;
  }, 40_000);

  report(
    'El docente ve el dashboard de SU salon',
    Boolean(classroomDash),
    classroomDash ? '' : 'la proyeccion del salon no llego en 40 s',
  );
  report(
    'Trae la dispersion, no solo la media',
    classroomDash !== null &&
      classroomDash.stddevPercentage !== undefined &&
      classroomDash.averagePercentage !== null,
    `media=${classroomDash?.averagePercentage} desviacion=${classroomDash?.stddevPercentage}`,
  );
  report(
    'Senala las preguntas que mas falla el salon',
    Array.isArray(classroomDash?.hardestQuestions),
    `preguntas=${classroomDash?.hardestQuestions?.length}`,
  );

  // Otro docente de la MISMA institucion no ve este salon: el permiso es de
  // salon, no de institucion, y sin la comprobacion de recurso se comportaria
  // como si lo fuera.
  const otherTeacherView = await getJson(
    `${ANALYTICS}/api/v1/analytics/classrooms/${analyticsClassroomId}`,
    teacherToken,
  );
  report(
    'Otro docente del mismo colegio no ve ese salon',
    otherTeacherView.status === 403,
    `status=${otherTeacherView.status} code=${otherTeacherView.body?.code}`,
  );

  const studentInClassroomView = await getJson(
    `${ANALYTICS}/api/v1/analytics/classrooms/${analyticsClassroomId}/students/${pupilInClassroom.id}`,
    ownerTeacherToken,
  );
  report(
    'El docente ve el dashboard de un alumno de su salon',
    studentInClassroomView.status === 200 &&
      studentInClassroomView.body?.assessmentsTaken >= 1,
    `status=${studentInClassroomView.status}`,
  );

  const foreignStudentView = await getJson(
    `${ANALYTICS}/api/v1/analytics/classrooms/${analyticsClassroomId}/students/${outsider.id}`,
    ownerTeacherToken,
  );
  report(
    'No ve a un alumno que no esta en ese salon',
    foreignStudentView.status === 404,
    `status=${foreignStudentView.status} code=${foreignStudentView.body?.code}`,
  );

  // --- Aislamiento: el salon de otro colegio no existe para este docente ---
  const otherInstitution = await seedInstitution({ capacity: 10, grade: evalKit.grade });
  const foreignClassroom = await getJson(
    `${ANALYTICS}/api/v1/analytics/classrooms/${otherInstitution.classroomId}`,
    teacherToken,
  );
  report(
    'Un docente no ve el salon de otra institucion',
    foreignClassroom.status === 404 || foreignClassroom.status === 403,
    `status=${foreignClassroom.status} code=${foreignClassroom.body?.code}`,
  );

  const foreignInstitution = await getJson(
    `${ANALYTICS}/api/v1/analytics/institutions/${otherInstitution.institutionId}`,
    mintAccessToken({
      userId: (await seedUsers(1, { roles: [ROLES.INSTITUTION_ADMIN], institutionId: institutionForExams.institutionId }))[0].id,
      roles: [ROLES.INSTITUTION_ADMIN],
      institutionId: institutionForExams.institutionId,
    }),
  );
  report(
    'Un admin no ve la institucion de otro, ni agregada',
    foreignInstitution.status === 404,
    `status=${foreignInstitution.status} code=${foreignInstitution.body?.code}`,
  );

  // --- Institucion: lo ve su administrador ---
  const [schoolAdmin] = await seedUsers(1, {
    roles: [ROLES.INSTITUTION_ADMIN],
    institutionId: institutionForExams.institutionId,
  });
  const adminAnalyticsToken = mintAccessToken({
    userId: schoolAdmin.id,
    roles: schoolAdmin.roles,
    institutionId: institutionForExams.institutionId,
  });

  const institutionDash = await getJson(
    `${ANALYTICS}/api/v1/analytics/institutions/${institutionForExams.institutionId}`,
    adminAnalyticsToken,
  );
  report(
    'El admin de institucion ve el dashboard de su colegio',
    institutionDash.status === 200 && institutionDash.body?.studentsMeasured >= 1,
    `status=${institutionDash.status} alumnos=${institutionDash.body?.studentsMeasured}`,
  );
  report(
    'Desglosa por grado, no solo el total',
    Array.isArray(institutionDash.body?.byGrade),
    `grados=${institutionDash.body?.byGrade?.length}`,
  );

  // --- Eficacia docente ---
  const teaching = await getJson(
    `${ANALYTICS}/api/v1/analytics/institutions/${institutionForExams.institutionId}/teaching`,
    adminAnalyticsToken,
  );
  report(
    'El admin ve la eficacia docente de su colegio',
    teaching.status === 200 && Array.isArray(teaching.body?.rows),
    `status=${teaching.status}`,
  );
  report(
    'La metrica es PROGRESO, y el aviso viaja con los datos',
    typeof teaching.body?.metric === 'string' &&
      teaching.body.metric.includes('progreso') &&
      typeof teaching.body?.caveat === 'string' &&
      teaching.body.caveat.includes('refuerzo'),
  );
  report(
    'Cada fila lleva el tamano de la muestra y si es concluyente',
    teaching.body?.rows?.length === 0 ||
      (teaching.body.rows[0].sampleSize !== undefined &&
        teaching.body.rows[0].statisticallyMeaningful === false),
    `filas=${teaching.body?.rows?.length} muestra=${teaching.body?.rows?.[0]?.sampleSize}`,
  );

  const teacherTryingTeaching = await getJson(
    `${ANALYTICS}/api/v1/analytics/institutions/${institutionForExams.institutionId}/teaching`,
    teacherToken,
  );
  report(
    'Un docente NO ve la eficacia de sus companeros',
    teacherTryingTeaching.status === 403,
    `status=${teacherTryingTeaching.status}`,
  );

  // --- GLEXCO ---
  const platformView = await getJson(`${ANALYTICS}/api/v1/analytics/institutions`, glexcoToken);
  report(
    'GLEXCO ve una vista por institucion',
    platformView.status === 200 && Array.isArray(platformView.body?.institutions),
    `status=${platformView.status} instituciones=${platformView.body?.institutions?.length}`,
  );

  const adminTryingPlatform = await getJson(
    `${ANALYTICS}/api/v1/analytics/institutions`,
    adminAnalyticsToken,
  );
  report(
    'Un admin de colegio no ve la vista de plataforma',
    adminTryingPlatform.status === 403,
    `status=${adminTryingPlatform.status}`,
  );

  const weakest = await getJson(`${ANALYTICS}/api/v1/analytics/kits/weakest`, glexcoToken);
  report(
    'GLEXCO ve los kits con peor resultado en todas partes',
    weakest.status === 200 && Array.isArray(weakest.body?.kits),
    `status=${weakest.status}`,
  );

  // --------------------------------------------------------------------
  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ` +
      `${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Envoltura de fetch que dice QUE objetivo fallo.
 *
 * Sin esto, un ECONNRESET sale como `fetch failed` a secas y con ocho procesos
 * en marcha hay que adivinar cual se estaba reiniciando. Adivinar cuesta mas
 * que el propio fallo.
 */
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  try {
    return await nativeFetch(input, init);
  } catch (error) {
    throw new Error(`no se pudo contactar con ${url}: ${error?.cause?.code ?? error.message}`, {
      cause: error,
    });
  }
};

main().catch((error) => {
  console.error(`\n${colors.fail}La prueba de humo se interrumpio:${colors.reset}`, error);
  process.exit(1);
});
