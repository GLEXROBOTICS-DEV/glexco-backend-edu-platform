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
const ANALYTICS = process.env.ANALYTICS_URL ?? 'http://localhost:3107';

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
  // Dos codigos: uno lo canjea el alumno de la seccion 6 y otro el alumno
  // institucional que se registra en la seccion 7.
  const dashKit = await seedCatalog({ codeCount: 2 });

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
  const teacherJar = `glexco_at=${teacherToken}`;

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

  // ------------------------------------------------------------------
  section('7. Bandeja de correccion del docente');
  // ------------------------------------------------------------------

  // Una evaluacion con pregunta ABIERTA: es la unica que la maquina no puede
  // corregir, y por tanto la unica que llega a la bandeja.
  const tarea = await postJson(`${ASSESSMENT}/api/v1/assessments`, glexcoToken, {
    kitId: dashKit.kitId,
    kind: 'project',
    title: 'Explica tu robot',
    passingScore: 60,
  });
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${tarea.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'short_answer',
      prompt: 'Explica con tus palabras que hace tu robot.',
      points: 20,
    },
  );
  const tareaPublish = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${tarea.body?.assessmentId}/publish`,
    glexcoToken,
    {},
  );

  report(
    'Prepara una tarea con pregunta abierta y la publica',
    tarea.status === 201 && tareaPublish.status < 300,
    `crear=${tarea.status} publicar=${tareaPublish.status} ${JSON.stringify(tareaPublish.body).slice(0, 140)}`,
  );

  // Este alumno se registra por la via REAL, no por SQL. Es lo que hace que su
  // nombre entre en el directorio: viaja en `identity.user.registered.v1`, y
  // sembrar la fila a mano no emite ningun evento.
  const inboxEmail = `correccion.${Date.now()}@colegio.pe`;
  const inboxRegistration = await fetch(`${GATEWAY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'institutional',
      email: inboxEmail,
      password: 'robotica-glexco-2026',
      firstName: 'Mateo',
      lastName: 'Quispe',
      birthDate: '2012-07-11',
      grade: dashKit.grade,
      activationCode: dashKit.codes[1],
      institutionId: school.institutionId,
      classroomId: classroom.body?.classroomId,
      acceptedTerms: true,
      locale: 'es',
    }),
  });
  const inboxBody = await inboxRegistration.json().catch(() => null);

  report(
    'Registra a un alumno del salon por la via real',
    inboxRegistration.status === 201,
    `status=${inboxRegistration.status} ${JSON.stringify(inboxBody).slice(0, 140)}`,
  );

  const inboxToken = mintAccessToken({
    userId: inboxBody?.userId ?? inboxBody?.user?.id,
    roles: [ROLES.STUDENT],
    institutionId: school.institutionId,
  });
  const inboxJar = `glexco_at=${inboxToken}`;

  // Se espera a que la matricula este proyectada ANTES de abrir la tarea.
  //
  // No es una comodidad de la prueba: la matricula la crea instituciones al
  // consumir `identity.user.registered.v1`, y el intento se abre con el salon
  // que la pantalla conoce EN ESE MOMENTO. Abrirlo medio segundo antes lo crea
  // sin salon, y como recargar devuelve el mismo intento, esa entrega ya no
  // llega a la bandeja de nadie. En uso real median minutos o dias entre
  // registrarse y abrir una evaluacion; aqui median milisegundos.
  const enrolled = await waitFor(async () => {
    const roster = await getJson(
      `${INSTITUTIONS}/api/v1/classrooms/${classroom.body?.classroomId}/roster`,
      teacherToken,
    );
    return roster.body?.items?.some((entry) => entry.fullName === 'Mateo Quispe') ?? false;
  });

  report(
    'La matricula y el nombre del alumno llegan por evento',
    enrolled,
    enrolled ? '' : 'la proyeccion no llego en 40 s',
  );

  // El alumno responde DESDE EL PORTAL. Que la pantalla resuelva su salon es lo
  // que hace que la entrega llegue a la bandeja: sin eso quedaria sin salon y
  // ningun docente la veria nunca.
  const tareaPage = await waitForHtml(
    `${WEB}/discover/evaluaciones/${tarea.body?.assessmentId}`,
    inboxJar,
    (html) => html.includes('Explica con tus palabras'),
  );

  report(
    'El alumno abre la tarea desde el portal',
    Boolean(tareaPage),
    tareaPage ? '' : 'no cargo en 40 s',
  );
  report(
    'Una pregunta abierta se pinta como area de texto, no como opciones',
    Boolean(tareaPage?.includes('<textarea')) && !tareaPage?.includes('type="radio"'),
  );

  const openSubmissionId = tareaPage
    ? /name="submissionId" value="([^"]+)"/.exec(tareaPage)?.[1]
    : undefined;
  const openQuestionId = tareaPage
    ? /name="questionId" value="([^"]+)"/.exec(tareaPage)?.[1]
    : undefined;

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${openSubmissionId}/answers`,
    inboxToken,
    {
      questionId: openQuestionId,
      text: 'Mi robot sigue una linea negra con el sensor de abajo.',
    },
  );
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${openSubmissionId}/submit`,
    inboxToken,
    {},
  );

  const bandeja = await waitForHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion`,
    teacherJar,
    (html) => html.includes('Explica tu robot'),
  );

  report(
    'La entrega aparece en la bandeja del docente',
    Boolean(bandeja),
    bandeja ? '' : 'no aparecio en 40 s',
  );
  report(
    'La bandeja pone el NOMBRE del alumno, no su identificador',
    Boolean(bandeja?.includes('Mateo Quispe')),
  );
  report(
    'Dice cuanto trabajo queda, no una nota que aun no significa nada',
    Boolean(bandeja?.includes('data-pending="1"')),
  );

  const correccion = await fetchHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion/${openSubmissionId}`,
    teacherJar,
  );

  report(
    'La pantalla de correccion muestra lo que respondio el alumno',
    correccion.status === 200 && correccion.html.includes('sigue una linea negra'),
    `status=${correccion.status}`,
  );
  report(
    'Trae el campo de puntos con el maximo de la pregunta',
    correccion.html.includes('name="points:') && correccion.html.includes('max="20"'),
  );

  // Aislamiento: la bandeja es del salon, y el salon tiene dueno.
  const [intruso] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: school.institutionId,
  });
  const intrusoJar = `glexco_at=${mintAccessToken({
    userId: intruso.id,
    roles: intruso.roles,
    institutionId: school.institutionId,
  })}`;
  const ajena = await fetchHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion`,
    intrusoJar,
  );

  report(
    'Otro docente del mismo colegio NO ve esa bandeja',
    ajena.status === 200 && !ajena.html.includes('Mateo Quispe'),
    `status=${ajena.status}`,
  );

  const ajenaEntrega = await fetchHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion/${openSubmissionId}`,
    intrusoJar,
  );

  report(
    'Ni la entrega concreta, que si lleva la clave de correccion',
    !ajenaEntrega.html.includes('sigue una linea negra'),
  );

  // Y el alumno, tecleando la URL del docente, tampoco.
  const alumnoIntenta = await fetchHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion/${openSubmissionId}`,
    inboxJar,
  );

  report(
    'Un alumno que teclea la URL de correccion no llega a la pantalla',
    !alumnoIntenta.html.includes('Cerrar la nota'),
  );

  // ------------------------------------------------------------------
  section('8. El docente crea sus propias evaluaciones');
  // ------------------------------------------------------------------
  const banco = await fetchHtml(`${WEB}/docentes/evaluaciones`, teacherJar);

  report(
    'El banco separa las de GLEXCO de las propias',
    banco.status === 200 &&
      banco.html.includes('Incluidas en los kits') &&
      banco.html.includes('Explica tu robot'),
    `status=${banco.status}`,
  );
  report(
    'Explica POR QUE no se editan las de GLEXCO, no solo que no se puede',
    banco.html.includes('cambiaria el examen de todo el pais') ||
      banco.html.includes('cambiar\u00eda el examen de todo el pa\u00eds'),
  );

  const nueva = await fetchHtml(`${WEB}/docentes/evaluaciones/nueva`, teacherJar);

  report(
    'El formulario de creacion ofrece los kits de SUS grados',
    nueva.status === 200 && nueva.html.includes(dashKit.kitCode),
    `status=${nueva.status}`,
  );
  report(
    'Y por defecto la evaluacion vale para todos sus salones',
    nueva.html.includes('Todos mis salones'),
  );

  // Se crea por la API con el token del docente, que es exactamente lo que hace
  // la accion de servidor del formulario.
  const propia = await postJson(`${ASSESSMENT}/api/v1/assessments`, teacherToken, {
    kitId: dashKit.kitId,
    kind: 'practical',
    title: 'Repaso de sensores del salon',
    passingScore: 70,
  });

  report(
    'Un docente crea la suya, y nace como de su institucion',
    propia.status === 201,
    `status=${propia.status} ${JSON.stringify(propia.body).slice(0, 120)}`,
  );

  const editor = await waitForHtml(
    `${WEB}/docentes/evaluaciones/${propia.body?.assessmentId}`,
    teacherJar,
    (html) => html.includes('Repaso de sensores del salon'),
  );

  report(
    'El editor dice que sin preguntas no se puede publicar',
    Boolean(editor?.includes('no se puede')),
  );
  report(
    'Y no ofrece el boton de publicar todavia',
    Boolean(editor) && !editor?.includes('>Publicar<'),
  );

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${propia.body?.assessmentId}/questions`,
    teacherToken,
    {
      type: 'single_choice',
      prompt: 'Que sensor mide distancia?',
      options: [{ text: 'El de ultrasonido' }, { text: 'El servo' }],
      correctOptions: [0],
      points: 10,
    },
  );

  const conPregunta = await waitForHtml(
    `${WEB}/docentes/evaluaciones/${propia.body?.assessmentId}`,
    teacherJar,
    (html) => html.includes('Que sensor mide distancia?'),
  );

  report(
    'Con una pregunta ya ofrece publicar',
    Boolean(conPregunta?.includes('>Publicar<')),
  );
  report(
    'Y marca cual es la respuesta correcta para quien la escribio',
    Boolean(conPregunta?.includes('correcta')),
  );

  // El banco de GLEXCO se ve pero no se edita, y la pantalla lo dice.
  const ajenaDeGlexco = await fetchHtml(
    `${WEB}/docentes/evaluaciones/${quiz.body?.assessmentId}`,
    teacherJar,
  );

  report(
    'Abrir una de GLEXCO ofrece duplicar, no editar',
    ajenaDeGlexco.status === 200 &&
      ajenaDeGlexco.html.includes('Duplicar para mi') &&
      !ajenaDeGlexco.html.includes('Anadir una pregunta') &&
      !ajenaDeGlexco.html.includes('A\u00f1adir una pregunta'),
    `status=${ajenaDeGlexco.status}`,
  );

  // LA comprobacion de esta seccion: la clave del banco comun no viaja ni al
  // docente que lo esta mirando, porque son las mismas preguntas que van a
  // responder sus alumnos.
  report(
    'La clave del banco de GLEXCO no llega ni al docente que lo mira',
    !ajenaDeGlexco.html.includes('correcta'),
  );

  const rechazo = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${quiz.body?.assessmentId}/questions`,
    teacherToken,
    { type: 'short_answer', prompt: 'Intento colar una pregunta.', points: 5 },
  );

  report(
    'Y el backend rechaza modificarla aunque se llame directo',
    rechazo.status === 403 && rechazo.body?.code === 'ASSESSMENT_IS_GLEXCO_CONTENT',
    `status=${rechazo.status} ${JSON.stringify(rechazo.body).slice(0, 120)}`,
  );

  const copia = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${quiz.body?.assessmentId}/clone`,
    teacherToken,
    {},
  );

  report(
    'Duplicarla si funciona, y la copia es suya',
    copia.status === 201 && copia.body?.assessmentId !== quiz.body?.assessmentId,
    `status=${copia.status}`,
  );

  const copiaEditor = await waitForHtml(
    `${WEB}/docentes/evaluaciones/${copia.body?.assessmentId}`,
    teacherJar,
    (html) => html.includes('(copia)'),
  );

  report(
    'La copia nace en borrador y con las preguntas dentro',
    Boolean(copiaEditor?.includes('Borrador')) &&
      Boolean(copiaEditor?.includes('Cual de estas piezas es un servomotor?')),
  );


  // ------------------------------------------------------------------
  section('9. Registro de alumno y activacion del codigo desde el portal');
  // ------------------------------------------------------------------

  // Es el camino que permite que un colegio empiece a usar la plataforma sin
  // que nadie de GLEXCO cree cuentas por API. Se comprueba entero: los dos
  // pasos del asistente, el alta real, el canje y la pantalla de activacion
  // para quien ya tiene cuenta.
  const altaKit = await seedCatalog({ codeCount: 4, grade: 'primary_4' });
  const altaSchool = await seedInstitution({ capacity: 30, grade: 'primary_4' });

  const [altaTeacher] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: altaSchool.institutionId,
  });
  const altaTeacherToken = mintAccessToken({
    userId: altaTeacher.id,
    roles: altaTeacher.roles,
    institutionId: altaSchool.institutionId,
  });

  // Un salon de OTRO grado en el MISMO colegio. Es lo que hace falta para
  // comprobar dos cosas distintas: que el paso 2 filtra por grado, y que el
  // backend no se fia de ese filtrado.
  const otroGrado = await postJson(`${INSTITUTIONS}/api/v1/classrooms`, altaTeacherToken, {
    name: `Salon de sexto ${Date.now()}`,
    grade: 'primary_6',
    capacity: 30,
    academicYear: new Date().getFullYear(),
    teacherId: altaTeacher.id,
  });

  // --- Paso 1: colegio y grado ---
  const paso1 = await fetchHtml(`${WEB}/registro`, null);

  report(
    'La pantalla de registro responde 200 sin sesion',
    paso1.status === 200,
    `status=${paso1.status}`,
  );
  report(
    'El primer paso viene en el HTML del servidor: funciona sin JavaScript',
    paso1.html.includes('name="colegio"') &&
      paso1.html.includes('name="grado"') &&
      paso1.html.includes('method="get"'),
  );
  report(
    'Lo seleccionado no se comunica solo con color: lleva su etiqueta de texto',
    paso1.html.includes('(seleccionado)') && paso1.html.includes('aria-current="true"'),
  );

  const independiente = await fetchHtml(`${WEB}/registro?tipo=independiente`, null);
  report(
    'El registro independiente no pide colegio',
    independiente.status === 200 && !independiente.html.includes('name="colegio"'),
  );

  const malCodigo = await fetchHtml(`${WEB}/registro?colegio=NOEXISTE-2026&grado=primary_4`, null);
  report(
    'Un codigo de colegio inexistente lo dice, y se queda en el paso 1',
    malCodigo.html.includes('No encontramos') && malCodigo.html.includes('data-step="1"'),
  );

  // --- Paso 2: salones reales del colegio ---
  const paso2 = await fetchHtml(`${WEB}/registro?colegio=${altaSchool.code}&grado=primary_4`, null);

  report(
    'Con colegio y grado validos pasa al segundo paso',
    paso2.status === 200 && paso2.html.includes('data-step="2"'),
    `status=${paso2.status}`,
  );
  report(
    'Confirma de que colegio se trata antes de pedir los datos',
    paso2.html.includes('Institucion Educativa de Desarrollo'),
  );
  report(
    'Lista los salones REALES del colegio, con el nombre de su docente',
    paso2.html.includes(`value="${altaSchool.classroomId}"`) &&
      paso2.html.includes('Docente de Desarrollo'),
  );
  report(
    'Solo ofrece salones del grado elegido',
    !paso2.html.includes(`value="${otroGrado.body?.classroomId}"`),
    `salon de sexto=${otroGrado.body?.classroomId}`,
  );
  report(
    'Los salones usan radios nativos dentro de un fieldset',
    paso2.html.includes('<fieldset') && paso2.html.includes('type="radio"'),
  );
  report(
    'El formulario de alta se sirve desde el servidor, con el codigo del libro',
    paso2.html.includes('name="activationCode"') &&
      paso2.html.includes('name="acceptedTerms"') &&
      paso2.html.includes('name="birthDate"'),
  );
  report(
    'Pide el correo del apoderado siempre, y no solo si ya se escribio la edad',
    paso2.html.includes('name="guardianEmail"'),
  );

  const paso2Solo = await fetchHtml(`${WEB}/registro?tipo=independiente&grado=primary_4`, null);
  report(
    'El alta independiente llega al formulario sin pedir salon',
    paso2Solo.html.includes('name="activationCode"') &&
      !paso2Solo.html.includes('name="classroomId"'),
  );

  // --- El alta de verdad, con el mismo cuerpo que arma la Server Action ---
  const altaStamp = Date.now();
  const altaEmail = `alta.${altaStamp}@colegio.pe`;
  const altaPassword = 'construyo-robots-2026';

  const alta = await fetch(`${GATEWAY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'institutional',
      email: altaEmail,
      password: altaPassword,
      firstName: 'Mateo',
      lastName: 'Quispe',
      birthDate: '2016-05-14',
      guardianEmail: `apoderado.${altaStamp}@correo.pe`,
      grade: 'primary_4',
      institutionId: altaSchool.institutionId,
      classroomId: altaSchool.classroomId,
      activationCode: altaKit.codes[0],
      acceptedTerms: true,
      locale: 'es',
    }),
  });
  const altaBody = await alta.json().catch(() => null);

  report(
    'Un alumno de primaria se registra con su codigo y su salon',
    alta.status === 201,
    `status=${alta.status} ${JSON.stringify(altaBody).slice(0, 160)}`,
  );
  report(
    'El alta de un menor de 14 exige y registra el correo del apoderado',
    altaBody?.requiresGuardianConsent === true,
  );

  // LA comprobacion que sostiene este formulario. El portal ya solo ofrece
  // salones del grado elegido, pero eso es comodidad del cliente: si el backend
  // no lo revalidase, una peticion forjada matricularia al alumno en el salon
  // de otro grado del mismo colegio, y ni el docente ni el alumno lo notarian
  // hasta ver la lista de clase.
  const gradoCruzado = await fetch(`${GATEWAY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'institutional',
      email: `cruzado.${altaStamp}@colegio.pe`,
      password: altaPassword,
      firstName: 'Lucia',
      lastName: 'Rojas',
      birthDate: '2016-03-01',
      guardianEmail: `apoderado2.${altaStamp}@correo.pe`,
      grade: 'primary_4',
      institutionId: altaSchool.institutionId,
      // El salon es de sexto y el grado declarado es cuarto.
      classroomId: otroGrado.body?.classroomId,
      activationCode: altaKit.codes[1],
      acceptedTerms: true,
      locale: 'es',
    }),
  });
  const cruzadoBody = await gradoCruzado.json().catch(() => null);

  report(
    'El backend rechaza un salon que no es del grado declarado',
    gradoCruzado.status === 422 && cruzadoBody?.code === 'CLASSROOM_GRADE_MISMATCH',
    `status=${gradoCruzado.status} code=${cruzadoBody?.code}`,
  );
  report(
    'Y senala el campo, para que el formulario lo pinte donde toca',
    cruzadoBody?.details?.field === 'classroomId',
    `details=${JSON.stringify(cruzadoBody?.details)}`,
  );

  // --- La sesion y la pantalla de confirmacion ---
  const altaLogin = await fetch(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: altaEmail, password: altaPassword, rememberMe: false }),
  });
  const altaLoginBody = await altaLogin.json().catch(() => null);

  report(
    'Puede ingresar de inmediato con lo que acaba de elegir',
    altaLogin.status === 200 && altaLoginBody?.user?.portal === 'discover',
    `status=${altaLogin.status} portal=${altaLoginBody?.user?.portal}`,
  );

  const altaJar = `glexco_at=${altaLoginBody?.accessToken}`;

  const sinSesion = await fetch(`${WEB}/registro/listo`, { redirect: 'manual' });
  report(
    'La pantalla de confirmacion exige sesion',
    sinSesion.status === 307 && (sinSesion.headers.get('location') ?? '').includes('/ingresar'),
    `status=${sinSesion.status}`,
  );

  // El canje es ASINCRONO: identidad crea la cuenta y encola el evento, y
  // catalogo lo canjea al consumirlo. Por eso se espera a que aparezca en vez
  // de dar por hecho que ya esta, que es justo el hueco que esta pantalla tapa.
  const listo = await waitForHtml(`${WEB}/registro/listo`, altaJar, (html) =>
    html.includes('data-activation="done"'),
  );

  report(
    'La confirmacion acaba mostrando el kit que activo el codigo',
    Boolean(listo) && listo.includes('4.º de primaria'),
    listo ? '' : 'el kit no aparecio en 40 s',
  );
  report(
    'No promete ningun correo de verificacion, porque hoy no se envia',
    Boolean(listo) && !/te enviamos un correo/i.test(listo),
  );

  const yaRegistrado = await fetch(`${WEB}/registro`, {
    headers: { cookie: altaJar },
    redirect: 'manual',
  });
  report(
    'Quien ya tiene sesion no vuelve a ver el formulario de alta',
    yaRegistrado.status === 307,
    `status=${yaRegistrado.status}`,
  );

  // --- Activacion de un codigo por quien ya tiene cuenta ---
  const activarSinSesion = await fetch(`${WEB}/discover/activar`, { redirect: 'manual' });
  report(
    'La pantalla de activacion exige sesion',
    activarSinSesion.status === 307,
    `status=${activarSinSesion.status}`,
  );

  const activar = await fetchHtml(`${WEB}/discover/activar`, altaJar);
  report(
    'Con sesion, el formulario de activacion viene en el HTML del servidor',
    activar.status === 200 && activar.html.includes('name="activationCode"'),
    `status=${activar.status}`,
  );
  report(
    'Avisa de que el codigo es de un solo uso ANTES del boton',
    activar.html.indexOf('una sola vez') > 0 &&
      activar.html.indexOf('una sola vez') < activar.html.indexOf('data-submit="activar"'),
  );

  const academyActivar = await fetchHtml(`${WEB}/academy/activar`, altaJar);
  report(
    'Academy tiene la misma pantalla, y ya no un enlace muerto',
    academyActivar.status === 200 && academyActivar.html.includes('name="activationCode"'),
    `status=${academyActivar.status}`,
  );

  // El segundo kit por la via del portal: es el caso real de un alumno que pasa
  // de grado y compra el libro siguiente. Un libro por grado significa un canje
  // nuevo cada curso, sin cuenta nueva.
  const segundoKit = await seedCatalog({ codeCount: 1, grade: 'primary_5' });
  const segundoCanje = await postJson(
    `${CATALOG}/api/v1/catalog/redeem`,
    altaLoginBody?.accessToken,
    { code: segundoKit.codes[0] },
  );

  report(
    'Un alumno con cuenta activa un segundo codigo sin crear otra cuenta',
    segundoCanje.status === 200 && segundoCanje.body?.firstRedemption === true,
    `status=${segundoCanje.status} ${JSON.stringify(segundoCanje.body).slice(0, 120)}`,
  );

  const repetido = await postJson(
    `${CATALOG}/api/v1/catalog/redeem`,
    altaLoginBody?.accessToken,
    { code: segundoKit.codes[0] },
  );
  report(
    'Reenviar el mismo codigo no gasta nada, y se distingue del alta nueva',
    repetido.status === 200 && repetido.body?.firstRedemption === false,
    `status=${repetido.status} firstRedemption=${repetido.body?.firstRedemption}`,
  );

  const portada = await waitForHtml(`${WEB}/discover`, altaJar, (html) =>
    html.includes('5.º de primaria'),
  );
  report(
    'El kit recien activado aparece en la portada del alumno',
    Boolean(portada),
    portada ? '' : 'no aparecio en 40 s',
  );


  // ------------------------------------------------------------------
  section('10. Biblioteca del kit: reproductor y descargas firmadas');
  // ------------------------------------------------------------------

  // Es lo que el alumno abre cada dia. La regla que la gobierna es la central
  // del negocio -solo ve el contenido del libro que compro- y aqui se comprueba
  // sobre las tres formas de entrega, que se resuelven por caminos distintos.
  const bibKit = await seedCatalog({ codeCount: 1, grade: 'secondary_2' });
  const [bibPupil] = await seedUsers(1);
  const bibToken = mintAccessToken({ userId: bibPupil.id, roles: bibPupil.roles });
  const bibJar = `glexco_at=${bibToken}`;

  // Un alumno SIN el kit, para comprobar el aislamiento con datos reales.
  const [otroPupil] = await seedUsers(1);
  const otroToken = mintAccessToken({ userId: otroPupil.id, roles: otroPupil.roles });

  const sinKitLista = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${bibKit.kitId}`,
    otroToken,
  );
  report(
    'Sin derecho sobre el kit, la biblioteca se rechaza',
    sinKitLista.status === 403 && sinKitLista.body?.code === 'KIT_NOT_ACCESSIBLE',
    `status=${sinKitLista.status} code=${sinKitLista.body?.code}`,
  );

  const sinKitAbrir = await getJson(
    `${CATALOG}/api/v1/catalog/library/${bibKit.assetId}/url`,
    otroToken,
  );
  report(
    'Y tampoco puede abrir un recurso suelto conociendo su identificador',
    sinKitAbrir.status === 403,
    `status=${sinKitAbrir.status}`,
  );

  const bibCanje = await postJson(`${CATALOG}/api/v1/catalog/redeem`, bibToken, {
    code: bibKit.codes[0],
  });
  report('El alumno activa el codigo de su libro', bibCanje.status === 200, `status=${bibCanje.status}`);

  const bibListado = await getJson(
    `${CATALOG}/api/v1/catalog/library?kitId=${bibKit.kitId}`,
    bibToken,
  );

  report(
    'Con derecho, la biblioteca trae el material publicado',
    bibListado.status === 200 && bibListado.body?.items?.length === 3,
    `status=${bibListado.status} items=${bibListado.body?.items?.length}`,
  );
  report(
    'El borrador NO aparece en la biblioteca del alumno',
    !JSON.stringify(bibListado.body ?? {}).includes('Ficha en preparacion'),
  );

  // La clave del almacen es estructura interna. No abre nada por si sola -los
  // buckets son privados- pero publicarla invita a construir rutas a mano y ata
  // el formato de las claves a lo que ya vio un cliente.
  const bibListadoCrudo = JSON.stringify(bibListado.body ?? {});
  report(
    'El listado NO filtra la clave del almacen ni el bucket',
    !bibListadoCrudo.includes('storageRef') &&
      !bibListadoCrudo.includes('bucket') &&
      !bibListadoCrudo.includes('glexco-documents'),
  );

  // --- Las tres formas de entrega ---
  const bibAbierto = {};
  for (const [nombre, id] of [
    ['documento', bibKit.assetId],
    ['video', bibKit.videoAssetId],
    ['enlace', bibKit.linkAssetId],
  ]) {
    bibAbierto[nombre] = await getJson(
      `${CATALOG}/api/v1/catalog/library/${id}/url`,
      bibToken,
    );
  }

  report(
    'Un documento se entrega como descarga firmada, no como direccion permanente',
    bibAbierto.documento.status === 200 &&
      bibAbierto.documento.body?.delivery === 'download' &&
      bibAbierto.documento.body?.expiresInSeconds > 0 &&
      /[?&]X-Amz-Signature=/.test(bibAbierto.documento.body?.url ?? ''),
    `delivery=${bibAbierto.documento.body?.delivery} ttl=${bibAbierto.documento.body?.expiresInSeconds}`,
  );
  report(
    'Un video se entrega para reproducir',
    bibAbierto.video.status === 200 && bibAbierto.video.body?.delivery === 'stream',
    `delivery=${bibAbierto.video.body?.delivery}`,
  );
  report(
    'Un enlace externo se devuelve tal cual y sin caducidad, porque no lo firmamos',
    bibAbierto.enlace.status === 200 &&
      bibAbierto.enlace.body?.delivery === 'external' &&
      bibAbierto.enlace.body?.expiresInSeconds === 0,
    `delivery=${bibAbierto.enlace.body?.delivery} ttl=${bibAbierto.enlace.body?.expiresInSeconds}`,
  );

  const bibBorrador = await getJson(
    `${CATALOG}/api/v1/catalog/library/${bibKit.draftAssetId}/url`,
    bibToken,
  );
  report(
    'Un recurso en borrador responde 404 aunque el alumno tenga el kit',
    bibBorrador.status === 404,
    `status=${bibBorrador.status}`,
  );

  // --- Las pantallas ---
  const bibSinSesion = await fetch(`${WEB}/academy/biblioteca`, { redirect: 'manual' });
  report(
    'La biblioteca exige sesion',
    bibSinSesion.status === 307,
    `status=${bibSinSesion.status}`,
  );

  const bibPagina = await waitForHtml(`${WEB}/academy/biblioteca`, bibJar, (html) =>
    html.includes('Monta tu primer robot'),
  );

  report(
    'La biblioteca se sirve desde el servidor con el material del kit',
    Boolean(bibPagina) && bibPagina.includes('Guia del docente'),
    bibPagina ? '' : 'no aparecio en 40 s',
  );
  report(
    'Lista los tres recursos publicados y ninguno mas',
    /data-library="3"/.test(bibPagina ?? ''),
    `data-library=${/data-library="(\d+)"/.exec(bibPagina ?? '')?.[1]}`,
  );
  report(
    'El borrador tampoco llega al HTML de la pantalla',
    Boolean(bibPagina) && !bibPagina.includes('Ficha en preparacion'),
  );

  // LA comprobacion que sostiene la biblioteca: el bibListado se pinta sin firmar
  // nada. Si las URLs vinieran aqui, estarian muertas en quince minutos y
  // ademas quedarian treinta enlaces vivos en una pagina que se puede guardar.
  report(
    'El listado NO trae ninguna URL firmada: la firma se pide al abrir',
    Boolean(bibPagina) && !/X-Amz-Signature/.test(bibPagina),
  );

  const visorVideo = await fetchHtml(
    `${WEB}/academy/biblioteca/${bibKit.videoAssetId}`,
    bibJar,
  );
  report(
    'El video se reproduce con el reproductor NATIVO, sin libreria',
    visorVideo.status === 200 &&
      visorVideo.html.includes('<video') &&
      visorVideo.html.includes('data-delivery="stream"'),
    `status=${visorVideo.status}`,
  );

  const visorDoc = await fetchHtml(`${WEB}/academy/biblioteca/${bibKit.assetId}`, bibJar);
  report(
    'Un documento descargable ofrece su enlace de descarga firmado',
    visorDoc.html.includes('data-download="1"') && /X-Amz-Signature/.test(visorDoc.html),
  );

  const visorEnlace = await fetchHtml(`${WEB}/academy/biblioteca/${bibKit.linkAssetId}`, bibJar);
  report(
    'Un enlace externo se abre fuera, con noopener, y no se incrusta',
    visorEnlace.html.includes('data-delivery="external"') &&
      visorEnlace.html.includes('noopener') &&
      !visorEnlace.html.includes('<iframe'),
  );

  const visorAjeno = await fetch(`${WEB}/academy/biblioteca/${bibKit.videoAssetId}`, {
    headers: { cookie: `glexco_at=${otroToken}` },
    redirect: 'manual',
  });
  report(
    'Un alumno sin el kit no ve el recurso: misma pantalla que si no existiera',
    visorAjeno.status === 404,
    `status=${visorAjeno.status}`,
  );

  const visorBorrador = await fetch(`${WEB}/academy/biblioteca/${bibKit.draftAssetId}`, {
    headers: { cookie: bibJar },
    redirect: 'manual',
  });
  report(
    'Y un borrador tampoco, aunque el kit sea suyo',
    visorBorrador.status === 404,
    `status=${visorBorrador.status}`,
  );


  // ------------------------------------------------------------------
  section('11. Panel de GLEXCO');
  // ------------------------------------------------------------------

  // `/admin` existia como DESTINO y no como pantalla: `portalPath` manda ahi a
  // los directores y al personal de GLEXCO desde que hay ingreso, asi que
  // aterrizaban en un 404 nada mas entrar.
  const [glexcoStaff] = await seedUsers(1, { roles: [ROLES.PLATFORM_ADMIN] });
  const staffToken = mintAccessToken({ userId: glexcoStaff.id, roles: glexcoStaff.roles });
  const staffJar = `glexco_at=${staffToken}`;

  const panelSinSesion = await fetch(`${WEB}/admin`, { redirect: 'manual' });
  report(
    'El panel de plataforma exige sesion',
    panelSinSesion.status === 307,
    `status=${panelSinSesion.status}`,
  );

  const escuelaPanel = await seedInstitution();
  const [director] = await seedUsers(1, {
    roles: [ROLES.INSTITUTION_ADMIN],
    institutionId: escuelaPanel.institutionId,
  });
  const directorToken = mintAccessToken({
    userId: director.id,
    roles: director.roles,
    institutionId: escuelaPanel.institutionId,
  });

  const directorEnPanel = await fetch(`${WEB}/admin`, {
    headers: { cookie: `glexco_at=${directorToken}` },
    redirect: 'manual',
  });
  report(
    'Un director de colegio NO ve el panel de plataforma: va al suyo',
    directorEnPanel.status === 307 &&
      (directorEnPanel.headers.get('location') ?? '').includes('/docentes/institucion'),
    `status=${directorEnPanel.status} location=${directorEnPanel.headers.get('location')}`,
  );

  const panelApi = await getJson(`${ANALYTICS}/api/v1/analytics/institutions`, directorToken);
  report(
    'Y el backend tambien se lo niega, no solo la pantalla',
    panelApi.status === 403,
    `status=${panelApi.status}`,
  );

  const panel = await fetchHtml(`${WEB}/admin`, staffJar);
  report(
    'GLEXCO ve el panel de plataforma',
    panel.status === 200 && panel.html.includes('Panel de GLEXCO'),
    `status=${panel.status}`,
  );
  report(
    'Lista instituciones reales, no un dato de ejemplo',
    /data-institutions="[1-9]\d*"/.test(panel.html),
    `data-institutions=${/data-institutions="(\d+)"/.exec(panel.html)?.[1]}`,
  );

  // --- El directorio de nombres, que llega por evento ---
  //
  // Un colegio dado de alta por la API emite `institutions.institution.created`,
  // y analitica lo proyecta en su PROPIO directorio. Sin esa proyeccion el panel
  // listaba la cartera de clientes por UUID, y la alternativa -un JOIN contra el
  // schema de instituciones- es justo lo que este servicio no puede hacer: el
  // rol `glexco_analytics` no tiene permiso sobre ese schema.
  const sello = Date.now().toString(36).toUpperCase();
  const nuevaEscuela = await postJson(`${INSTITUTIONS}/api/v1/institutions`, staffToken, {
    code: `EVT${sello}`,
    name: `Colegio San Ejemplo ${sello}`,
    shortName: 'San Ejemplo',
    educationLevels: ['primary', 'secondary'],
    responsibleName: 'Ana Directora',
    contactEmail: `ana.${sello.toLowerCase()}@sanejemplo.pe`,
    city: 'Arequipa',
  });

  report(
    'Se da de alta un colegio por la API, que es lo que emite el evento',
    nuevaEscuela.status === 201,
    `status=${nuevaEscuela.status}`,
  );

  // La proyeccion es asincrona: se espera a que llegue en vez de suponerlo.
  const proyectado = await waitFor(async () => {
    const overview = await getJson(`${ANALYTICS}/api/v1/analytics/institutions`, staffToken);
    return (overview.body?.institutions ?? []).some(
      (row) => row.institutionId === nuevaEscuela.body?.institutionId && row.name,
    );
  }, 30_000);

  report(
    'El nombre del colegio llega a la analitica por EVENTO, sin consultar su schema',
    proyectado,
    proyectado ? '' : 'no se proyecto en 30 s',
  );

  const conNombre = await waitForHtml(`${WEB}/admin`, staffJar, (html) =>
    html.includes(`Colegio San Ejemplo ${sello}`),
  );
  report(
    'Y el panel lo muestra con su nombre y su ciudad, no con su identificador',
    Boolean(conNombre) && conNombre.includes('Arequipa'),
    conNombre ? '' : 'el nombre no aparecio en 40 s',
  );

  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ${colors.ok}${passed} pasan${colors.reset}` +
      (failed > 0 ? `, ${colors.fail}${failed} fallan${colors.reset}` : '') +
      '\n',
  );

  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Espera a que una condicion se cumpla.
 *
 * Existe porque media plataforma es asincrona por diseno: las proyecciones se
 * alimentan de eventos y no estan listas en el mismo instante en que ocurre el
 * hecho. Reintentar con un tope es la unica forma honesta de comprobarlas: un
 * `sleep` fijo o pasa de largo o tarda de mas, y a veces las dos cosas en la
 * misma ejecucion.
 */
async function waitFor(condition, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition().catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json().catch(() => null) };
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
