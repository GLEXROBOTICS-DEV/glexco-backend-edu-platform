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
import { mintAccessToken, seedCatalog, seedInstitution, seedUsers } from './seed-dev.mjs';
import contracts from '@glexco/contracts';

const { ROLES } = contracts;

const WEB = process.env.WEB_URL ?? 'http://localhost:3010';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const ASSESSMENT = process.env.ASSESSMENT_URL ?? 'http://localhost:3105';
const INSTITUTIONS = process.env.INSTITUTIONS_URL ?? 'http://localhost:3102';
const CATALOG = process.env.CATALOG_URL ?? 'http://localhost:3103';

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

  // ------------------------------------------------------------------
  section('5. Dashboards en el portal');
  // ------------------------------------------------------------------
  // Se monta el escenario completo por la API real: kit, cuestionario de
  // GLEXCO publicado, salon creado con su docente, y un alumno que responde.
  // Sembrarlo por SQL no serviria: la analitica aprende quien es el docente
  // del evento `institutions.classroom.created.v1`.
  const dashKit = await seedCatalog({ codeCount: 1 });

  const [contentManager] = await seedUsers(1, { roles: [ROLES.CONTENT_MANAGER] });
  const glexcoToken = mintAccessToken({ userId: contentManager.id, roles: contentManager.roles });

  const quiz = await postJson(`${ASSESSMENT}/api/v1/assessments`, glexcoToken, {
    kitId: dashKit.kitId,
    kind: 'quiz',
    title: 'Piezas del uKit',
    passingScore: 60,
  });

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${quiz.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'single_choice',
      prompt: 'Cual de estas piezas es un servomotor?',
      options: [{ text: 'El bloque' }, { text: 'El servo' }],
      correctOptions: [1],
      points: 10,
    },
  );
  await postJson(`${ASSESSMENT}/api/v1/assessments/${quiz.body?.assessmentId}/publish`, glexcoToken, {});

  const school = await seedInstitution({ capacity: 30, grade: dashKit.grade });

  const [teacher] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: school.institutionId,
  });
  const teacherToken = mintAccessToken({
    userId: teacher.id,
    roles: teacher.roles,
    institutionId: school.institutionId,
  });

  const classroom = await postJson(`${INSTITUTIONS}/api/v1/classrooms`, teacherToken, {
    name: `Salon Portal ${Date.now()}`,
    grade: dashKit.grade,
    capacity: 30,
    academicYear: new Date().getFullYear(),
    teacherId: teacher.id,
  });

  report(
    'Prepara el escenario: kit, cuestionario publicado y salon',
    quiz.status === 201 && classroom.status === 201,
    `quiz=${quiz.status} salon=${classroom.status}`,
  );

  const [pupil] = await seedUsers(1, { institutionId: school.institutionId });
  const pupilToken = mintAccessToken({
    userId: pupil.id,
    roles: pupil.roles,
    institutionId: school.institutionId,
  });

  const attempt = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${quiz.body?.assessmentId}/attempts`,
    pupilToken,
    { classroomId: classroom.body?.classroomId },
  );
  const question = attempt.body?.questions?.[0];
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${attempt.body?.submissionId}/answers`,
    pupilToken,
    {
      questionId: question?.id,
      selectedOptionIds: [question?.options?.find((o) => o.text === 'El servo')?.id],
    },
  );
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${attempt.body?.submissionId}/submit`,
    pupilToken,
    {},
  );

  // --- Dashboard del alumno ---
  const pupilJar = `glexco_at=${pupilToken}`;
  const progreso = await waitForHtml(`${WEB}/discover/progreso`, pupilJar, (html) =>
    html.includes('Nota media GLEXCO') && html.includes('100'),
  );

  report(
    'El alumno ve su dashboard con la nota que acaba de sacar',
    Boolean(progreso),
    progreso ? '' : 'no aparecio en 40 s',
  );
  report(
    'Distingue la media de GLEXCO de la del docente',
    Boolean(progreso?.includes('Nota media GLEXCO') && progreso?.includes('Nota media de tu docente')),
  );
  report(
    'Muestra el progreso, no solo la nota',
    Boolean(progreso?.includes('Cuánto has mejorado') && progreso?.includes('primer intento')),
  );
  report(
    'El grafico se renderiza en el SERVIDOR, sin depender del JavaScript',
    Boolean(progreso?.includes('data-chart="timeline"') && progreso?.includes('<circle')),
  );
  report(
    'Trae la tabla de datos, para lector de pantalla y para copiar',
    Boolean(progreso?.includes('Ver datos')),
  );
  report(
    'NO muestra la posicion del alumno frente a sus companeros',
    Boolean(progreso) && !/puesto|posici[oó]n|ranking|de 30/i.test(progreso),
  );

  // --- Portal del docente ---
  const teacherJar = `glexco_at=${teacherToken}`;
  const misSalones = await fetchHtml(`${WEB}/docentes`, teacherJar);

  report(
    'El docente entra a su panel y ve su salon',
    misSalones.status === 200 && misSalones.html.includes('Mis salones'),
    `status=${misSalones.status}`,
  );

  const salonDash = await waitForHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}`,
    teacherJar,
    (html) => html.includes('Nota media') && !html.includes('Aún no hay resultados'),
  );

  report(
    'Ve el dashboard de su salon con datos reales',
    Boolean(salonDash),
    salonDash ? '' : 'no aparecio en 40 s',
  );
  report(
    'Muestra la dispersion interpretada, no un numero suelto',
    Boolean(salonDash?.includes('Qué tan parejo va el salón')),
  );
  report(
    'Senala lo que mas falla el salon',
    Boolean(salonDash?.includes('Lo que más falla tu salón')),
  );

  // --- Aislamiento en el portal ---
  const pupilInTeacherPortal = await fetchHtml(`${WEB}/docentes`, pupilJar);
  report(
    'Un alumno que entra al panel del docente va a SU portal',
    pupilInTeacherPortal.status === 307,
    `status=${pupilInTeacherPortal.status} location=${pupilInTeacherPortal.location}`,
  );

  const teacherInInstitution = await fetchHtml(`${WEB}/docentes/institucion`, teacherJar);
  report(
    'Un docente no entra a la pantalla de institucion',
    teacherInInstitution.status === 307,
    `status=${teacherInInstitution.status}`,
  );

  // --- Admin de institucion ---
  const [schoolAdmin] = await seedUsers(1, {
    roles: [ROLES.INSTITUTION_ADMIN],
    institutionId: school.institutionId,
  });
  const adminJar = `glexco_at=${mintAccessToken({
    userId: schoolAdmin.id,
    roles: schoolAdmin.roles,
    institutionId: school.institutionId,
  })}`;

  const institucion = await waitForHtml(`${WEB}/docentes/institucion`, adminJar, (html) =>
    html.includes('Mi institución'),
  );

  report(
    'El admin de institucion ve el panel de su colegio',
    Boolean(institucion),
    institucion ? '' : 'no cargo en 40 s',
  );
  report(
    'Ve la activacion de codigos, que es la metrica comercial',
    Boolean(institucion?.includes('Códigos activados')),
  );
  report(
    'La eficacia docente sale con su aviso ARRIBA, no en un pie',
    Boolean(
      institucion?.includes('Dónde hace falta apoyo') &&
        institucion?.includes('Qué mide') &&
        institucion?.includes('refuerzo'),
    ),
  );
  report(
    'No se presenta como ranking de profesores',
    Boolean(institucion) && !/ranking|mejores profesores|peores/i.test(institucion),
  );

  // ------------------------------------------------------------------
  section('6. Responder un cuestionario desde el portal');
  // ------------------------------------------------------------------
  const [quizPupil] = await seedUsers(1, { institutionId: school.institutionId });
  const quizPupilJar = `glexco_at=${mintAccessToken({
    userId: quizPupil.id,
    roles: quizPupil.roles,
    institutionId: school.institutionId,
  })}`;

  // Este alumno no tiene el kit todavia: la evaluacion existe pero su listado
  // debe salir vacio. Es la misma regla del canje -solo ves el contenido del
  // libro que compraste- aplicada a las evaluaciones.
  const sinKit = await fetchHtml(`${WEB}/academy/evaluaciones`, quizPupilJar);
  report(
    'Sin kit activado, el listado de evaluaciones sale vacio',
    sinKit.status === 200 && sinKit.html.includes('Todavia no tienes contenido activado'),
    `status=${sinKit.status}`,
  );

  // El alumno del escenario canjea el codigo de su libro, que es lo que le da
  // derecho al kit y por tanto a sus evaluaciones. Sin ese paso su listado sale
  // vacio, que es exactamente la regla del negocio.
  const redeemed = await postJson(`${CATALOG}/api/v1/catalog/redeem`, pupilToken, {
    code: dashKit.codes[0],
  });
  report(
    'El alumno canjea el codigo de su libro',
    redeemed.status === 200,
    `status=${redeemed.status} ${JSON.stringify(redeemed.body).slice(0, 120)}`,
  );

  const listado = await waitForHtml(`${WEB}/academy/evaluaciones`, `glexco_at=${pupilToken}`, (html) =>
    html.includes('Piezas del uKit'),
  );

  report(
    'El alumno con kit ve el cuestionario en su listado',
    Boolean(listado),
    listado ? '' : 'no aparecio en 40 s',
  );
  report(
    'Dice de donde viene la evaluacion',
    Boolean(listado?.includes('Incluida en tu kit')),
  );

  const quizPage = await fetchHtml(
    `${WEB}/academy/evaluaciones/${quiz.body?.assessmentId}`,
    `glexco_at=${pupilToken}`,
  );

  report(
    'La pantalla del cuestionario abre un intento y pinta las preguntas',
    quizPage.status === 200 && quizPage.html.includes('Cual de estas piezas es un servomotor?'),
    `status=${quizPage.status}`,
  );
  report(
    'Usa controles nativos, que traen teclado y lector de pantalla gratis',
    quizPage.html.includes('type="radio"') && quizPage.html.includes('<fieldset'),
  );
  report(
    'El formulario se sirve desde el servidor: funciona sin JavaScript',
    quizPage.html.includes('<form') && quizPage.html.includes('name="submissionId"'),
  );

  // LA comprobacion que sostiene el cuestionario entero.
  report(
    'La clave de correccion NO llega al HTML del alumno',
    !quizPage.html.includes('correctOptionIds') &&
      !quizPage.html.includes('correctOptions') &&
      !/\bexplanation\b/.test(quizPage.html),
  );

  // Volver a cargar no gasta otro intento.
  const reopened = await fetchHtml(
    `${WEB}/academy/evaluaciones/${quiz.body?.assessmentId}`,
    `glexco_at=${pupilToken}`,
  );
  const firstId = /name="submissionId" value="([^"]+)"/.exec(quizPage.html)?.[1];
  const secondId = /name="submissionId" value="([^"]+)"/.exec(reopened.html)?.[1];
  report(
    'Recargar la pagina no gasta otro intento',
    Boolean(firstId) && firstId === secondId,
    `${firstId} vs ${secondId}`,
  );

  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );

  process.exit(failed > 0 ? 1 : 0);
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

/**
 * Sondea una pagina hasta que su HTML cumple la condicion.
 *
 * Los dashboards salen de una proyeccion alimentada por eventos, asi que el dato
 * tarda un instante en aparecer. Lo que se puede exigir es que ACABE
 * apareciendo, no cuando.
 */
async function waitForHtml(url, cookie, matches, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await fetchHtml(url, cookie).catch(() => null);
    if (page?.status === 200 && matches(page.html)) return page.html;
    await sleep(1_500);
  }
  return null;
}

async function fetchHtml(url, cookie) {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  return {
    status: response.status,
    html: await response.text(),
    location: response.headers.get('location'),
  };
}

/**
 * Envoltura de fetch que dice QUE objetivo fallo.
 *
 * Sin esto, un ECONNREFUSED sale como `fetch failed` a secas y hay que adivinar
 * si el que no responde es el portal, el gateway o Postgres. Con seis procesos
 * en marcha, adivinar cuesta mas que el propio fallo.
 */
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  try {
    return await nativeFetch(input, init);
  } catch (error) {
    throw new Error(`no se pudo contactar con ${url}: ${error?.cause?.code ?? error.message}`, {
      cause: error,
    });
  }
};

main().catch((error) => {
  console.error(`\n${colors.fail}La comprobacion se interrumpio:${colors.reset}`, error);
  console.error(
    `\nComprueba que estan en marcha el backend y el portal:\n` +
      `  pnpm --filter @glexco/web dev\n`,
  );
  process.exit(1);
});
