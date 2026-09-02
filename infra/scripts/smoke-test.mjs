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
  const student = {
    accountType: 'independent',
    email: `alumno.prueba.${stamp}@colegio.pe`,
    password: 'robotica-glexco-2026',
    firstName: 'Carlos',
    lastName: 'Salazar',
    birthDate: '2010-05-14',
    grade: 'primary_6',
    // El adaptador en memoria de catalogo acepta cualquier codigo GLX-TEST...
    activationCode: `GLXTEST${String(stamp).slice(-5)}`,
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
      activationCode: 'GLXZZZZZZZZZZ',
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
      activationCode: `GLXTEST${String(stamp).slice(-4)}1`,
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

  // Se reenvia el token ANTIGUO: debe interpretarse como robo y revocar la familia.
  cookieJar.set('glexco_rt', firstRefreshToken);
  const reuse = await call('/auth/refresh', { method: 'POST' });
  report(
    'Detecta la reutilizacion del token antiguo y revoca la sesion',
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
  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ` +
      `${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n${colors.fail}La prueba de humo se interrumpio:${colors.reset}`, error);
  process.exit(1);
});
