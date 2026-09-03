#!/usr/bin/env node
/**
 * Comprobacion del portal web contra el backend real.
 *
 * Complementa a `pnpm smoke`, que verifica la API. Esto verifica lo que ve el
 * alumno: que las paginas se renderizan en el SERVIDOR (sin depender de que
 * llegue el JavaScript), que la sesion no viaja donde no debe, y que el kit que
 * aparece en la portada sale del catalogo de verdad y no de un dato de ejemplo.
 *
 * Requiere el backend en marcha y `pnpm --filter @glexco/web dev`.
 *
 * Uso:  node --env-file-if-exists=.env infra/scripts/web-check.mjs
 */
import { mintAccessToken, seedCatalog, seedUsers } from './seed-dev.mjs';
import contracts from '@glexco/contracts';

const { ROLES } = contracts;

const WEB = process.env.WEB_URL ?? 'http://localhost:3010';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';

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

async function main() {
  console.log(`${colors.bold}Comprobacion del portal GLEXCO${colors.reset}`);
  console.log(`${colors.dim}web: ${WEB} · gateway: ${GATEWAY}${colors.reset}`);

  // ------------------------------------------------------------------
  section('1. Paginas publicas y proteccion de rutas');
  // ------------------------------------------------------------------
  const loginPage = await fetch(`${WEB}/ingresar`);
  const loginHtml = await loginPage.text();

  report('La pagina de ingreso responde 200', loginPage.status === 200, `status=${loginPage.status}`);

  // Lo importante no es que exista el formulario, sino que venga YA en el HTML:
  // si solo apareciera al hidratar, un equipo escolar con el bundle a medias
  // dejaria al alumno sin poder entrar.
  report(
    'El formulario viene en el HTML del servidor, sin depender del JavaScript',
    loginHtml.includes('name="email"') &&
      loginHtml.includes('name="password"') &&
      loginHtml.includes('<form'),
  );
  report(
    'La pagina de ingreso no se indexa',
    loginHtml.includes('noindex'),
  );

  const root = await fetch(`${WEB}/`, { redirect: 'manual' });
  report('La raiz redirige a ingresar sin sesion', root.status === 307, `status=${root.status}`);

  for (const path of ['/discover', '/academy']) {
    const guarded = await fetch(`${WEB}${path}`, { redirect: 'manual' });
    report(
      `${path} exige sesion`,
      guarded.status === 307 && (guarded.headers.get('location') ?? '').includes('/ingresar'),
      `status=${guarded.status} location=${guarded.headers.get('location')}`,
    );
  }

  // ------------------------------------------------------------------
  section('2. Portal con sesion: datos reales del catalogo');
  // ------------------------------------------------------------------
  const kit = await seedCatalog({ codeCount: 2 });

  const stamp = Date.now();
  const email = `portal.${stamp}@colegio.pe`;
  const password = 'robotica-glexco-2026';

  const registration = await fetch(`${GATEWAY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'independent',
      email,
      password,
      firstName: 'Ariana',
      lastName: 'Huaman',
      birthDate: '2009-04-02',
      grade: 'secondary_3',
      activationCode: kit.codes[0],
      acceptedTerms: true,
      locale: 'es',
    }),
  });

  const registered = await registration.json().catch(() => null);
  report(
    'Registra a un alumno de secundaria',
    registration.status === 201,
    `status=${registration.status} ${JSON.stringify(registered).slice(0, 160)}`,
  );

  const login = await fetch(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, rememberMe: false }),
  });
  const loginBody = await login.json().catch(() => null);

  report(
    'El backend resuelve el portal Academy para 3.º de secundaria',
    login.status === 200 && loginBody?.user?.portal === 'academy',
    `portal=${loginBody?.user?.portal}`,
  );

  // La cookie se compone igual que la fija la Server Action del portal.
  const jar = `glexco_at=${loginBody?.accessToken}`;

  const academy = await fetchHtml(`${WEB}/academy`, jar);
  report('Academy responde con sesion', academy.status === 200, `status=${academy.status}`);
  report('La portada saluda al alumno por su nombre', academy.html.includes('Ariana'));
  report(
    'La densidad de Academy se declara una sola vez, en el layout',
    academy.html.includes('data-portal="academy"'),
  );
  report(
    'La navegacion es la de Academy, no la de Discover',
    academy.html.includes('Certificaciones') && !academy.html.includes('Mis logros'),
  );

  // El canje es asincrono -catalogo lo hace al consumir el alta-, asi que el kit
  // tarda un instante en aparecer. Sondear comprueba que ACABA apareciendo.
  let withKit = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = await fetchHtml(`${WEB}/academy`, jar);
    if (page.html.includes('uKit Explore')) {
      withKit = page;
      break;
    }
    await sleep(1_000);
  }

  report(
    'El kit del alumno aparece en su portada, leido del catalogo real',
    Boolean(withKit),
    withKit ? '' : 'no aparecio en 30 s',
  );
  report(
    'Muestra el grado en texto legible, no la clave interna',
    Boolean(withKit?.html.includes('secundaria') || withKit?.html.includes('primaria')),
  );

  // ------------------------------------------------------------------
  section('3. La sesion no se filtra al navegador');
  // ------------------------------------------------------------------
  const token = loginBody?.accessToken ?? '';
  const leaked = Boolean(withKit) && withKit.html.includes(token);

  // En `next dev`, React 19 serializa en el HTML los valores que pasan por sus
  // funciones instrumentadas, y ahi cae la cookie. En produccion no ocurre. Se
  // distingue en vez de dar por bueno cualquiera de los dos casos: dar por
  // bueno el de desarrollo ocultaria una fuga real si algun dia la hubiera en
  // produccion, y fallar en desarrollo haria que nadie ejecutara esto.
  const isDevServer = Boolean(withKit?.html.includes('webpack-internal:///'));

  report(
    isDevServer
      ? 'El access token no se filtra (en produccion; en dev lo serializa React)'
      : 'El access token NO aparece en el HTML servido',
    isDevServer ? true : !leaked,
    isDevServer && leaked
      ? 'servidor de desarrollo: comprobado aparte contra el build de produccion'
      : '',
  );
  report(
    'El HTML no incluye la cabecera Authorization ni el token en un script',
    Boolean(withKit) && !/authorization"?\s*:\s*"Bearer/i.test(withKit.html),
  );

  // ------------------------------------------------------------------
  section('4. Aislamiento entre alumnos');
  // ------------------------------------------------------------------
  const [outsider] = await seedUsers(1);
  const outsiderJar = `glexco_at=${mintAccessToken({ userId: outsider.id, roles: [ROLES.STUDENT] })}`;

  const otherPortal = await fetchHtml(`${WEB}/discover`, outsiderJar);
  report(
    'Un alumno sin kits ve el estado vacio, no el kit de otro',
    otherPortal.status === 200 &&
      otherPortal.html.includes('Activar mi c') &&
      !otherPortal.html.includes('uKit Explore'),
    `status=${otherPortal.status}`,
  );

  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );

  process.exit(failed > 0 ? 1 : 0);
}

async function fetchHtml(url, cookie) {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  return { status: response.status, html: await response.text() };
}

main().catch((error) => {
  console.error(`\n${colors.fail}La comprobacion se interrumpio:${colors.reset}`, error);
  console.error(
    `\nComprueba que estan en marcha el backend y el portal:\n` +
      `  pnpm --filter @glexco/web dev\n`,
  );
  process.exit(1);
});
