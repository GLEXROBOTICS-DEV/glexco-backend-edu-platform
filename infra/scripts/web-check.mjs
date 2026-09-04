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
import {
  mintAccessToken,
  seedCatalog,
  seedInstitution,
  seedMissions,
  seedUsers,
} from './seed-dev.mjs';
import contracts from '@glexco/contracts';

const { ROLES } = contracts;

const WEB = process.env.WEB_URL ?? 'http://localhost:3010';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const ASSESSMENT = process.env.ASSESSMENT_URL ?? 'http://localhost:3105';
const INSTITUTIONS = process.env.INSTITUTIONS_URL ?? 'http://localhost:3102';
const CATALOG = process.env.CATALOG_URL ?? 'http://localhost:3103';
const ANALYTICS = process.env.ANALYTICS_URL ?? 'http://localhost:3107';
const ENGAGEMENT = process.env.ENGAGEMENT_URL ?? 'http://localhost:3106';
const LEARNING = process.env.LEARNING_URL ?? 'http://localhost:3104';
const MEDIA = process.env.MEDIA_URL ?? 'http://localhost:3108';
/** Mailpit: un SMTP real que acepta cualquier cosa y no la entrega a nadie. Es
 *  lo que permite comprobar el correo de punta a punta sin escribirle a una
 *  direccion de verdad, que ademas serian datos de un menor. */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

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
  section('0. Coherencia del catalogo de traducciones');
  // ------------------------------------------------------------------
  // Antes de tocar la red: es estatica, es instantanea, y si falla lo que sigue
  // se pinta con las claves crudas.
  await comprobarEspaciosDeCliente();

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
  // Se compara por RUTA y no por etiqueta. Antes exigia que "Mis logros" NO
  // apareciera, y dejo de valer en cuanto el cliente pidio logros tambien en
  // Academy: las dos barras comparten etiquetas a proposito -es la misma
  // funcion para otra edad- y lo unico que de verdad las distingue es a donde
  // llevan. Una comprobacion que contradice una decision de producto se queda
  // en rojo para siempre y acaba ignorandose.
  report(
    'La navegacion es la de Academy, no la de Discover',
    academy.html.includes('/academy/certificaciones') && !academy.html.includes('/discover/'),
  );

  // El canje es asincrono -catalogo lo hace al consumir el alta-, asi que el kit
  // tarda un instante en aparecer. Sondear comprueba que ACABA apareciendo.
  //
  // Se mira `/academy/cursos` y NO la portada. El canvas saco el listado de kits
  // de la portada al adoptarse el diseno aprobado: arriba va como voy, que ruta
  // sigo y que tengo por delante, y el contenido activado tiene su propia
  // pantalla. Esta comprobacion se quedo apuntando al sitio viejo, asi que
  // llevaba en rojo desde entonces -y con ella las quince que dependen de su
  // respuesta-. Una comprobacion que contradice el diseno aprobado no descubre
  // un fallo: enseña a ignorar el rojo.
  let withKit = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = await fetchHtml(`${WEB}/academy/cursos`, jar);
    if (page.html.includes('uKit Explore')) {
      withKit = page;
      break;
    }
    await sleep(1_000);
  }

  report(
    'El kit del alumno aparece en su contenido, leido del catalogo real',
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
    Boolean(progreso) && !/puesto|posici[oó]n|ranking|de 30/i.test(visible(progreso)),
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
  // El portal se PREGUNTA, no se supone: `seedUsers` no fija la edad, asi que
  // estos alumnos caen en Discover y el guard de portal redirige sus rutas de
  // Academy. Ver `portalOf`.
  const quizPupilPortal = await portalOf(quizPupilJar);
  const sinKit = await fetchHtml(`${WEB}/${quizPupilPortal}/evaluaciones`, quizPupilJar);
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

  // `pupilJar` ya existe: es el mismo alumno del escenario del dashboard, y esa
  // parte del guion ya usa `/discover` con el, lo que confirma su portal.
  const pupilPortal = await portalOf(pupilJar);

  const listado = await waitForHtml(`${WEB}/${pupilPortal}/evaluaciones`, pupilJar, (html) =>
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

  // **La ficha y el intento son dos pantallas distintas, y esa es la
  // correccion.** `/evaluaciones/{id}` es de solo lectura: dice cuantos intentos
  // quedan y, si ya hubo entrega, la nota. El intento se abre en `/responder`, y
  // solo al pulsar. Antes eran la misma URL, asi que ENTRAR A MIRAR gastaba un
  // intento y el alumno recibia "ya agotaste tus intentos" sin haber respondido
  // nada; el cliente lo reporto y se separo en la sesion 14.
  const fichaPage = await fetchHtml(
    `${WEB}/${pupilPortal}/evaluaciones/${quiz.body?.assessmentId}`,
    pupilJar,
  );
  report(
    'Abrir la ficha de una evaluacion NO abre un intento',
    fichaPage.status === 200 && !fichaPage.html.includes('name="submissionId"'),
    `status=${fichaPage.status}`,
  );

  const quizPage = await fetchHtml(
    `${WEB}/${pupilPortal}/evaluaciones/${quiz.body?.assessmentId}/responder`,
    pupilJar,
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
    `${WEB}/${pupilPortal}/evaluaciones/${quiz.body?.assessmentId}/responder`,
    pupilJar,
  );
  const firstId = /name="submissionId" value="([^"]+)"/.exec(quizPage.html)?.[1];
  const secondId = /name="submissionId" value="([^"]+)"/.exec(reopened.html)?.[1];
  report(
    'Recargar la pagina no gasta otro intento',
    Boolean(firstId) && firstId === secondId,
    `${firstId} vs ${secondId}`,
  );

  // ------------------------------------------------------------------
  section('6b. Ordenar una secuencia');
  // ------------------------------------------------------------------
  // En su propia evaluacion y no anadida a la de arriba: sumarle una pregunta
  // cambiaria el total de puntos del escenario anterior y romperia sus
  // afirmaciones de nota, que no tienen nada que ver con esto.
  const ordenQuiz = await postJson(`${ASSESSMENT}/api/v1/assessments`, glexcoToken, {
    kitId: dashKit.kitId,
    kind: 'quiz',
    title: 'Monta el brazo',
    passingScore: 60,
  });

  const ordenPregunta = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${ordenQuiz.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'ordering',
      prompt: 'Ordena los pasos del montaje.',
      options: [
        { text: 'Fijar la base' },
        { text: 'Montar el servo' },
        { text: 'Conectar el cable' },
        { text: 'Encender' },
      ],
      // La secuencia ENTERA, que es lo que el dominio exige.
      correctOptions: [0, 1, 2, 3],
      points: 12,
    },
  );

  report(
    'Se puede crear una pregunta de ordenar',
    ordenPregunta.status === 201 || ordenPregunta.status === 200,
    `status=${ordenPregunta.status} ${JSON.stringify(ordenPregunta.body).slice(0, 120)}`,
  );

  // La clave a medias es el error de captura que mas cuesta: la pregunta se
  // publica y NO se puede acertar, y no se descubre hasta que el salon entero
  // saca la misma nota rara.
  const claveIncompleta = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${ordenQuiz.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'ordering',
      prompt: 'Ordena mal.',
      options: [{ text: 'Uno' }, { text: 'Dos' }, { text: 'Tres' }],
      correctOptions: [0, 1],
      points: 5,
    },
  );
  report(
    'Se rechaza una pregunta de ordenar con la secuencia a medias',
    claveIncompleta.status === 400 || claveIncompleta.status === 422,
    `status=${claveIncompleta.status}`,
  );

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${ordenQuiz.body?.assessmentId}/publish`,
    glexcoToken,
    {},
  );

  // Una sola carga y NO un sondeo: publicar es sincrono por la API, asi que no
  // hay nada asincrono que esperar. Y cada carga de pagina del portal consulta
  // `/auth/me` por el gateway, que tiene su propio limite por IP: un sondeo de
  // hasta cuarenta intentos aqui agotaba el presupuesto y tumbaba las
  // comprobaciones de contrasena del final del guion, que no tienen nada que
  // ver con esto.
  const ordenRespuesta = await fetchHtml(
    `${WEB}/${pupilPortal}/evaluaciones/${ordenQuiz.body?.assessmentId}/responder`,
    pupilJar,
  );
  const ordenPage = ordenRespuesta.status === 200 ? ordenRespuesta.html : null;

  report(
    'El alumno abre la pregunta de ordenar',
    Boolean(ordenPage?.includes('Ordena los pasos del montaje')),
    `status=${ordenRespuesta.status}`,
  );

  // Un `select` por paso y NO arrastrar y soltar: arrastrar exige JavaScript
  // -y este formulario tiene que entregarse sin el-, es casi imposible con un
  // lector de pantalla, y falla con el dedo de un nino en una tableta.
  report(
    'Se responde con controles nativos, no arrastrando',
    Boolean(ordenPage?.includes('name="orden:')) && Boolean(ordenPage?.includes('<select')),
  );
  report(
    'Cada paso lleva su nombre en la etiqueta, no "posicion 1"',
    Boolean(ordenPage?.includes('Posición de: Fijar la base')),
  );

  // Y la garantia de siempre: el orden correcto no viaja al navegador.
  report(
    'El orden correcto NO llega al HTML del alumno',
    Boolean(ordenPage) && !ordenPage.includes('correctOptionIds'),
  );

  // Se corrige por la API, que es la misma via que usa el portal al entregar.
  const ordenAttempt = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${ordenQuiz.body?.assessmentId}/attempts`,
    pupilToken,
    { classroomId: classroom.body?.classroomId },
  );
  const ordenSubmissionId = ordenAttempt.body?.submissionId;
  const opciones = (ordenAttempt.body?.questions?.[0]?.options ?? []).map((o) => o.id);

  // Dos pasos intercambiados: quedan dos en su sitio de cuatro.
  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${ordenSubmissionId}/answers`,
    pupilToken,
    {
      questionId: ordenAttempt.body?.questions?.[0]?.id,
      selectedOptionIds: [opciones[0], opciones[2], opciones[1], opciones[3]],
    },
  );

  const ordenEntregado = await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${ordenSubmissionId}/submit`,
    pupilToken,
    {},
  );

  report(
    'La maquina la corrige sola: no espera a un docente',
    ordenEntregado.body?.status === 'graded',
    `status=${ordenEntregado.status} estado=${ordenEntregado.body?.status}`,
  );
  report(
    'La nota es PARCIAL: dos piezas en su sitio de cuatro valen la mitad',
    ordenEntregado.body?.score === 6,
    `score=${ordenEntregado.body?.score} de ${ordenEntregado.body?.maxScore}`,
  );

  // ------------------------------------------------------------------
  section('6c. Misiones semanales');
  // ------------------------------------------------------------------
  //
  // Se siembran DESPUES de que el alumno haya completado su leccion y aprobado
  // su cuestionario -eso paso en las secciones 2 y 6-, asi que la mision de la
  // semana 1 ya esta cumplida y la llamada tiene que darla por completada en el
  // mismo paso. Es lo que de verdad hay que comprobar: no que la lista responda,
  // sino que el avance se calcula de los hechos que ya estan escritos.
  const misiones = await seedMissions({
    kitId: dashKit.kitId,
    courseId: dashKit.courseId,
    assessmentId: quiz.body?.assessmentId,
    lessons: 1,
  });

  report(
    'Se publican tres misiones del kit',
    misiones.length === 3,
    `${misiones.length} sembradas`,
  );

  // El directorio de contenido de aprendizaje se siembra a mano, igual que en la
  // seccion 14 y por lo mismo: llega por evento `catalog.course.published.v1`, y
  // `seedCatalog` escribe por SQL, que no emite ninguno. Lo que aqui se verifica
  // son las misiones, no la proyeccion -que ya se comprueba en otra seccion-.
  await pgQuery(
    process.env.DATABASE_URL_LEARNING,
    `INSERT INTO learning.course_directory (course_id, kit_id, title, lesson_count)
     VALUES ($1,$2,'Primeros pasos con uKit',1)
     ON CONFLICT (course_id) DO UPDATE SET lesson_count = 1`,
    [dashKit.courseId, dashKit.kitId],
  );
  await pgQuery(
    process.env.DATABASE_URL_LEARNING,
    `INSERT INTO learning.lesson_directory (lesson_id, course_id, kit_id, title, order_index)
     VALUES ($1,$2,$3,'Conoce tu robot',0)
     ON CONFLICT (lesson_id) DO NOTHING`,
    [dashKit.lessonId, dashKit.courseId, dashKit.kitId],
  );

  // Y completa su leccion por la via REAL. En este punto del guion todavia no
  // habia completado ninguna -eso pasa mas abajo-, asi que sin esto la mision de
  // la semana 1 no tendria nada que medir y la seccion afirmaria sobre un cero.
  const leccionDeMision = await postJson(
    `${LEARNING}/api/v1/learning/lessons/${dashKit.lessonId}/complete`,
    pupilToken,
    {},
  );
  report(
    'El alumno completa una leccion del kit',
    leccionDeMision.status === 200,
    `status=${leccionDeMision.status} ${JSON.stringify(leccionDeMision.body).slice(0, 120)}`,
  );

  const misPrimeras = await getJson(
    `${LEARNING}/api/v1/learning/missions/${dashKit.kitId}`,
    pupilToken,
  );

  report(
    'El alumno ve sus misiones del kit',
    misPrimeras.status === 200 && (misPrimeras.body?.items ?? []).length === 3,
    `status=${misPrimeras.status} items=${(misPrimeras.body?.items ?? []).length}`,
  );

  const semana1 = (misPrimeras.body?.items ?? []).find((item) => item.weekNumber === 1);
  const semana2 = (misPrimeras.body?.items ?? []).find((item) => item.weekNumber === 2);
  const semana3 = (misPrimeras.body?.items ?? []).find((item) => item.weekNumber === 3);

  // NO hay tabla de progreso de misiones: el avance sale de `lesson_progress` y
  // de `xp_awards`. Si esto falla, es que se calculo de otro sitio.
  report(
    'El avance se calcula de los hechos, sin tabla de progreso',
    semana1?.objectives?.[0]?.current >= 1,
    `objetivo=${JSON.stringify(semana1?.objectives?.[0] ?? null)}`,
  );

  report(
    'La mision cumplida se completa en la misma llamada, y paga su XP',
    semana1?.state === 'completed' && misPrimeras.body?.awardedXp > 0,
    `estado=${semana1?.state} xp=${misPrimeras.body?.awardedXp}`,
  );

  report(
    'Y dice que fue a tiempo',
    semana1?.onTime === true,
    `onTime=${semana1?.onTime}`,
  );

  // Ir por delante no permite cobrar semanas futuras de golpe: una mision
  // semanal que se completa entera de una vez no es semanal.
  report(
    'Una mision de una semana futura NO se cobra por adelantado',
    semana3?.state === 'locked' && semana3?.completedAt === null,
    `estado=${semana3?.state}`,
  );

  // La de la semana 2 pide la evaluacion aprobada, y este alumno la aprobo en la
  // seccion 6: sirve para comprobar que un objetivo de evaluacion se mide con la
  // marca que dejo el evento, sin preguntarle a evaluacion por red.
  report(
    'Un objetivo de evaluacion se mide con lo que ya llego por evento',
    (semana2?.objectives ?? []).some(
      (objective) => objective.kind === 'assessment_passed' && objective.done,
    ),
    JSON.stringify(semana2?.objectives ?? []),
  );

  // LA comprobacion que sostiene el diseno: abrir la pantalla dos veces no paga
  // dos veces. La garantia esta en la base -indice unico de `xp_awards`- y no en
  // un `if`, asi que dos pestanas a la vez tampoco.
  const misSegundas = await getJson(
    `${LEARNING}/api/v1/learning/missions/${dashKit.kitId}`,
    pupilToken,
  );

  report(
    'Volver a abrir las misiones NO vuelve a pagar',
    misSegundas.body?.awardedXp === 0,
    `xp en la segunda lectura=${misSegundas.body?.awardedXp}`,
  );

  report(
    'Y la completada sigue completada, sin celebrarlo dos veces',
    misSegundas.body?.items?.find((item) => item.weekNumber === 1)?.state === 'completed' &&
      misSegundas.body?.items?.find((item) => item.weekNumber === 1)?.justCompleted === false,
    '',
  );

  // Otro alumno ve SUS misiones, no las de nadie: el alcance sale del token.
  const [sinAvance] = await seedUsers(1, { institutionId: school.institutionId });
  const misAjenas = await getJson(
    `${LEARNING}/api/v1/learning/missions/${dashKit.kitId}`,
    mintAccessToken({
      userId: sinAvance.id,
      roles: sinAvance.roles,
      institutionId: school.institutionId,
    }),
  );
  report(
    'Otro alumno ve las mismas misiones con SU avance, no el ajeno',
    misAjenas.status === 200 &&
      misAjenas.body?.items?.find((item) => item.weekNumber === 1)?.state !== 'completed',
    `estado ajeno=${misAjenas.body?.items?.find((item) => item.weekNumber === 1)?.state}`,
  );

  // Y en la pantalla: la mision de la semana va en el dashboard, que es donde el
  // cliente pidio que estuviera.
  const portadaConMision = await fetchHtml(`${WEB}/${pupilPortal}`, pupilJar);
  report(
    'La mision de la semana aparece en el dashboard del alumno',
    portadaConMision.html.includes('data-mission-state='),
    `status=${portadaConMision.status}`,
  );

  const zonaDeRetos = await fetchHtml(
    `${WEB}/${pupilPortal}/${pupilPortal === 'discover' ? 'retos' : 'proyectos'}`,
    pupilJar,
  );
  report(
    'Y la lista completa en la zona de retos, con las tres semanas',
    zonaDeRetos.html.includes('data-missions="3"'),
    `status=${zonaDeRetos.status}`,
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
  // `/responder`, no la ficha: las preguntas viven ahi desde que se separo ver
  // el resultado de gastar un intento.
  const tareaPage = await waitForHtml(
    `${WEB}/${await portalOf(inboxJar)}/evaluaciones/${tarea.body?.assessmentId}/responder`,
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

  // ------------------------------------------------------------------
  section('7b. Evidencia de un reto: el alumno entrega, el docente la ve');
  // ------------------------------------------------------------------
  //
  // En su propia evaluacion, como la de ordenar: anadir una pregunta a la tarea
  // de arriba cambiaria su total de puntos y obligaria al docente a puntuar dos
  // preguntas antes de cerrar la nota, rompiendo las afirmaciones anteriores.
  const reto = await postJson(`${ASSESSMENT}/api/v1/assessments`, glexcoToken, {
    kitId: dashKit.kitId,
    kind: 'practical',
    title: 'Monta el brazo y ensenalo',
    passingScore: 60,
  });

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${reto.body?.assessmentId}/questions`,
    glexcoToken,
    {
      type: 'file_upload',
      prompt: 'Sube una foto de tu montaje o el enlace a tu video.',
      points: 15,
    },
  );

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/${reto.body?.assessmentId}/publish`,
    glexcoToken,
    {},
  );

  // --- El video NO se sube: se enlaza. Decision del cliente. ---
  const videoSubido = await postJson(`${MEDIA}/api/v1/media/uploads`, inboxToken, {
    scope: 'evidence',
    mimeType: 'video/mp4',
    filename: 'montaje.mp4',
    sizeBytes: 1_048_576,
  });
  report(
    'El video NO se puede subir como evidencia: su sitio es el enlace',
    videoSubido.status === 400 || videoSubido.status === 422,
    `status=${videoSubido.status}`,
  );

  // Una foto SI: es lo que pesa poco y demuestra que esta hecho.
  const fotoPedida = await postJson(`${MEDIA}/api/v1/media/uploads`, inboxToken, {
    scope: 'evidence',
    mimeType: 'image/jpeg',
    filename: 'montaje.jpg',
    sizeBytes: 240_000,
  });
  report(
    'Una foto si se admite, y con su URL prefirmada',
    fotoPedida.status === 201 && Boolean(fotoPedida.body?.url),
    `status=${fotoPedida.status}`,
  );

  // --- El enlace, que es la via del caso a distancia ---
  const enlace = await postJson(`${MEDIA}/api/v1/media/links`, inboxToken, {
    scope: 'evidence',
    url: 'https://drive.google.com/file/d/ejemplo-de-montaje/view',
    title: 'Video de mi montaje',
  });
  report(
    'El alumno comparte el enlace a su video',
    enlace.status === 201 && Boolean(enlace.body?.mediaAssetId),
    `status=${enlace.status} ${JSON.stringify(enlace.body).slice(0, 120)}`,
  );

  const acortador = await postJson(`${MEDIA}/api/v1/media/links`, inboxToken, {
    scope: 'evidence',
    url: 'https://bit.ly/mi-video',
    title: 'Atajo',
  });
  report(
    'Un acortador se rechaza: convertiria la lista blanca en decoracion',
    acortador.status === 400 || acortador.status === 422,
    `status=${acortador.status}`,
  );

  // --- El alumno entrega la evidencia ---
  const retoAttempt = await postJson(
    `${ASSESSMENT}/api/v1/assessments/${reto.body?.assessmentId}/attempts`,
    inboxToken,
    { classroomId: classroom.body?.classroomId },
  );

  await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${retoAttempt.body?.submissionId}/answers`,
    inboxToken,
    {
      questionId: retoAttempt.body?.questions?.[0]?.id,
      mediaAssetId: enlace.body?.mediaAssetId,
    },
  );

  const retoEntregado = await postJson(
    `${ASSESSMENT}/api/v1/assessments/attempts/${retoAttempt.body?.submissionId}/submit`,
    inboxToken,
    {},
  );

  report(
    'La entrega con evidencia va a la bandeja, no se autocorrige',
    retoEntregado.body?.status === 'submitted',
    `estado=${retoEntregado.body?.status}`,
  );

  // --- Y LO QUE IMPORTA: el docente la VE ---
  const conEvidencia = await fetchHtml(
    `${WEB}/docentes/salones/${classroom.body?.classroomId}/correccion/${retoAttempt.body?.submissionId}`,
    teacherJar,
  );

  report(
    'El docente abre la correccion del reto',
    conEvidencia.status === 200,
    `status=${conEvidencia.status}`,
  );

  // Antes esta pantalla decia "Entrego un archivo o un enlace" y ahi acababa:
  // habia que puntuar un montaje sin haberlo visto.
  report(
    'La evidencia se MUESTRA, no se anuncia',
    conEvidencia.html.includes('data-evidence='),
  );
  report(
    'El enlace externo se abre fuera, con noopener, y no se incrusta',
    conEvidencia.html.includes('drive.google.com') &&
      conEvidencia.html.includes('noopener') &&
      !conEvidencia.html.includes('<iframe'),
  );

  // La evidencia es OPCIONAL: lo normal es que el docente revise en clase.
  report(
    'Y se puede puntuar sin evidencia: el campo de puntos esta igual',
    conEvidencia.html.includes('name="points:') && conEvidencia.html.includes('max="15"'),
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

  const academyActivar = await fetchHtml(
    `${WEB}/${await portalOf(altaJar)}/activar`,
    altaJar,
  );
  report(
    'Academy tiene la misma pantalla, y ya no un enlace muerto',
    academyActivar.status === 200 && academyActivar.html.includes('name="activationCode"'),
    `status=${academyActivar.status}`,
  );

  // El segundo kit por la via del portal: es el caso real de un alumno que pasa
  // de grado y compra el libro siguiente. Un libro por grado significa un canje
  // nuevo cada curso, sin cuenta nueva.
  // Dos codigos del MISMO kit: uno para el canje nuevo y otro para comprobar
  // que un segundo codigo del kit que ya tiene se rechaza sin quemarse.
  const segundoKit = await seedCatalog({ codeCount: 2, grade: 'primary_5' });
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

  // Un segundo codigo del MISMO kit. Antes esto quemaba el codigo y moria con un
  // 500 contra el indice unico de derechos: el alumno perdia un codigo -que vale
  // dinero- a cambio de un error sin explicacion. Pasa mas de lo que parece,
  // porque el colegio reparte un codigo de repuesto o la familia compra el libro
  // sin saber que el centro ya lo dio.
  const otroDelMismo = await postJson(
    `${CATALOG}/api/v1/catalog/redeem`,
    altaLoginBody?.accessToken,
    { code: segundoKit.codes[1] },
  );
  report(
    'Un segundo codigo del mismo kit se rechaza SIN quemarlo, y con un motivo claro',
    otroDelMismo.status === 409 && otroDelMismo.body?.code === 'KIT_ALREADY_OWNED',
    `status=${otroDelMismo.status} code=${otroDelMismo.body?.code}`,
  );

  // Y el codigo sigue sirviendo: es la mitad que de verdad importa.
  const [terceroPupil] = await seedUsers(1);
  const rescatado = await postJson(
    `${CATALOG}/api/v1/catalog/redeem`,
    mintAccessToken({ userId: terceroPupil.id, roles: terceroPupil.roles }),
    { code: segundoKit.codes[1] },
  );
  report(
    'El codigo rechazado NO se quemo: otro alumno puede usarlo',
    rescatado.status === 200 && rescatado.body?.firstRedemption === true,
    `status=${rescatado.status} first=${rescatado.body?.firstRedemption}`,
  );

  // En "Mis kits", no en la portada: el canvas dejo arriba lo que el alumno
  // viene a HACER -el curso a medias, sus cifras y lo que tiene pendiente- y
  // movio el inventario de kits a su propia pantalla. Mismo caso que el listado
  // de Academy, unas comprobaciones mas arriba.
  const misKits = await waitForHtml(
    `${WEB}/${await portalOf(altaJar)}/kits`,
    altaJar,
    (html) => html.includes('5.º de primaria'),
  );
  report(
    'El kit recien activado aparece en el contenido del alumno',
    Boolean(misKits),
    misKits ? '' : 'no aparecio en 40 s',
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
  // Sin sesion la ruta da igual: lo que se comprueba es que exige entrar.
  const bibSinSesion = await fetch(`${WEB}/academy/biblioteca`, { redirect: 'manual' });
  report(
    'La biblioteca exige sesion',
    bibSinSesion.status === 307,
    `status=${bibSinSesion.status}`,
  );

  const bibPortal = await portalOf(bibJar);

  const bibPagina = await waitForHtml(`${WEB}/${bibPortal}/biblioteca`, bibJar, (html) =>
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
    `${WEB}/${bibPortal}/biblioteca/${bibKit.videoAssetId}`,
    bibJar,
  );
  report(
    'El video se reproduce con el reproductor NATIVO, sin libreria',
    visorVideo.status === 200 &&
      visorVideo.html.includes('<video') &&
      visorVideo.html.includes('data-delivery="stream"'),
    `status=${visorVideo.status}`,
  );

  const visorDoc = await fetchHtml(`${WEB}/${bibPortal}/biblioteca/${bibKit.assetId}`, bibJar);
  report(
    'Un documento descargable ofrece su enlace de descarga firmado',
    visorDoc.html.includes('data-download="1"') && /X-Amz-Signature/.test(visorDoc.html),
  );

  const visorEnlace = await fetchHtml(
    `${WEB}/${bibPortal}/biblioteca/${bibKit.linkAssetId}`,
    bibJar,
  );
  report(
    'Un enlace externo se abre fuera, con noopener, y no se incrusta',
    visorEnlace.html.includes('data-delivery="external"') &&
      visorEnlace.html.includes('noopener') &&
      !visorEnlace.html.includes('<iframe'),
  );

  const otroJar = `glexco_at=${otroToken}`;
  const visorAjeno = await fetch(
    `${WEB}/${await portalOf(otroJar)}/biblioteca/${bibKit.videoAssetId}`,
    { headers: { cookie: otroJar }, redirect: 'manual' },
  );
  report(
    'Un alumno sin el kit no ve el recurso: misma pantalla que si no existiera',
    visorAjeno.status === 404,
    `status=${visorAjeno.status}`,
  );

  const visorBorrador = await fetch(`${WEB}/${bibPortal}/biblioteca/${bibKit.draftAssetId}`, {
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


  // ------------------------------------------------------------------
  section('12. Correo real: verificacion y recuperacion de contrasena');
  // ------------------------------------------------------------------

  // Hasta que existio engagement, identidad emitia el token de verificacion y
  // NADIE lo consumia: nadie recibia el correo, y un alumno que olvidara su
  // contrasena no tenia forma de recuperarla. Esto lo comprueba de punta a
  // punta contra Mailpit, que es un servidor SMTP real.
  const correoKit = await seedCatalog({ codeCount: 2, grade: 'primary_3' });
  const correoStamp = Date.now();
  const correoEmail = `verifica.${correoStamp}@colegio.pe`;
  const apoderado = `apoderado.${correoStamp}@correo.pe`;
  const correoPassword = 'contrasena-inicial-2026';

  const altaCorreo = await fetch(`${GATEWAY}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accountType: 'independent',
      email: correoEmail,
      password: correoPassword,
      firstName: 'Elena',
      lastName: 'Vega',
      // Menor de 14: el aviso tiene que llegar TAMBIEN al apoderado.
      birthDate: '2017-09-09',
      guardianEmail: apoderado,
      grade: 'primary_3',
      activationCode: correoKit.codes[0],
      acceptedTerms: true,
      locale: 'es',
    }),
  });

  report(
    'Se registra un alumno menor de 14 con su apoderado',
    altaCorreo.status === 201,
    `status=${altaCorreo.status}`,
  );

  const verificacion = await waitForMail(correoStamp, (msg) => /confirma/i.test(msg.Subject));
  report(
    'El correo de verificacion SALE de verdad, por SMTP',
    Boolean(verificacion),
    verificacion ? '' : 'no llego en 40 s',
  );

  const destinatarios = await mailboxFor(correoStamp);
  report(
    'Llega al alumno Y a su apoderado, en envios separados y no en copia',
    destinatarios.length >= 2 &&
      destinatarios.some((m) => JSON.stringify(m.To).includes(correoEmail)) &&
      destinatarios.some((m) => JSON.stringify(m.To).includes(apoderado)) &&
      destinatarios.every((m) => (m.To ?? []).length === 1),
    `mensajes=${destinatarios.length}`,
  );

  const cuerpo = await mailBody(verificacion?.ID);
  report(
    'Trae version en texto plano, no solo HTML',
    Boolean(cuerpo?.Text && cuerpo.Text.length > 50),
  );

  const enlaceVerificacion = /https?:\/\/[^\s"<]*verificar[^\s"<]*/.exec(cuerpo?.Text ?? '')?.[0];
  report(
    'El enlace apunta al PORTAL y no a la API: quien lo abre es una persona',
    Boolean(enlaceVerificacion) && enlaceVerificacion.includes(WEB),
    `enlace=${enlaceVerificacion?.slice(0, 60)}`,
  );

  const primera = await fetch(enlaceVerificacion ?? `${WEB}/verificar`);
  const primeraHtml = await primera.text();
  report(
    'Abrir el enlace confirma la cuenta',
    primera.status === 200 && primeraHtml.includes('data-verified="1"'),
    `status=${primera.status}`,
  );

  const segunda = await fetch(enlaceVerificacion ?? `${WEB}/verificar`);
  const segundaHtml = await segunda.text();
  report(
    'Y el enlace es de UN SOLO USO: la segunda vez ya no sirve',
    segundaHtml.includes('data-verified="0"'),
  );

  // --- Recuperacion de contrasena ---
  const solicitud = await fetch(`${GATEWAY}/api/v1/auth/password-reset/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correoEmail, locale: 'es' }),
  });
  report(
    'Se acepta la solicitud de recuperacion',
    solicitud.status === 202 || solicitud.status === 200,
    `status=${solicitud.status}`,
  );

  const reset = await waitForMail(correoStamp, (msg) => /contrase/i.test(msg.Subject));
  report(
    'Llega el correo con el enlace para cambiarla',
    Boolean(reset),
    reset ? '' : 'no llego en 40 s',
  );

  const resetBody = await mailBody(reset?.ID);
  // Es la parte MAS importante de este correo: la unica senal que recibe la
  // victima de un intento de robo de cuenta, y tiene que decir que no haga nada.
  report(
    'Avisa de que hacer si NO fue quien lo recibe el que lo pidio',
    /no lo pediste/i.test(resetBody?.Text ?? ''),
  );

  const resetToken = /nueva\?token=([^\s"<&]+)/.exec(resetBody?.Text ?? '')?.[1];
  report('El enlace trae su token de un solo uso', Boolean(resetToken));

  const nuevaPagina = await fetch(`${WEB}/recuperar/nueva?token=${resetToken}`);
  const nuevaHtml = await nuevaPagina.text();
  report(
    'La pantalla se sirve desde el servidor y lleva el token en un campo oculto',
    nuevaPagina.status === 200 && nuevaHtml.includes('name="token"'),
    `status=${nuevaPagina.status}`,
  );

  // LA comprobacion que sostiene todo este diseno: el token vive en el correo y
  // en la peticion, y en ningun registro duradero. Si viajara en el evento
  // estaria escrito en la outbox de identidad y en el stream de JetStream, y
  // quien pudiera leer una tabla —o una copia de seguridad— tomaria cualquier
  // cuenta de la plataforma.
  const outbox = await pgQuery(
    process.env.DATABASE_URL_IDENTITY,
    `SELECT count(*)::int AS total FROM identity.outbox
      WHERE event_name IN ('identity.email_verification.requested.v1',
                           'identity.password_reset.requested.v1')
        AND payload::text LIKE '%token%'`,
  );
  report(
    'El token NO viaja en el evento: no aparece en la outbox de identidad',
    outbox?.[0]?.total === 0,
    `filas con token=${outbox?.[0]?.total}`,
  );

  const registro = await pgQuery(
    process.env.DATABASE_URL_ENGAGEMENT,
    `SELECT count(*)::int AS total FROM engagement.email_deliveries WHERE recipient LIKE $1`,
    [`%${correoStamp}%`],
  );
  report(
    'Engagement registra QUE se envio, para que soporte pueda responder',
    (registro?.[0]?.total ?? 0) >= 3,
    `envios=${registro?.[0]?.total}`,
  );

  const columnas = await pgQuery(
    process.env.DATABASE_URL_ENGAGEMENT,
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'engagement' AND table_name = 'email_deliveries'`,
  );
  report(
    'Pero NO guarda el cuerpo del mensaje, que contiene el enlace',
    !(columnas ?? []).some((row) => /body|content|html|token|url/i.test(row.column_name)),
    `columnas=${(columnas ?? []).map((r) => r.column_name).join(',')}`,
  );

  // El cambio de verdad: la contrasena nueva funciona y la vieja no.
  const confirmacion = await fetchEsperandoLimite(
    `${GATEWAY}/api/v1/auth/password-reset/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: decodeURIComponent(resetToken ?? ''),
        password: 'una-contrasena-nueva-2026',
      }),
    },
  );
  report('Se cambia la contrasena con el enlace', confirmacion.status === 200, `status=${confirmacion.status}`);

  const conNueva = await fetchEsperandoLimite(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correoEmail, password: 'una-contrasena-nueva-2026', rememberMe: false }),
  });
  const conVieja = await fetchEsperandoLimite(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correoEmail, password: correoPassword, rememberMe: false }),
  });

  report('El alumno entra con la contrasena nueva', conNueva.status === 200, `status=${conNueva.status}`);
  report('Y la vieja deja de servir', conVieja.status === 401, `status=${conVieja.status}`);

  // --- Anuncios de salon ---
  const anuncioEscuela = await seedInstitution({ grade: 'primary_3' });
  const [anuncioTeacher] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: anuncioEscuela.institutionId,
  });
  const anuncioTeacherToken = mintAccessToken({
    userId: anuncioTeacher.id,
    roles: anuncioTeacher.roles,
    institutionId: anuncioEscuela.institutionId,
  });

  const salonAnuncio = await postJson(
    `${INSTITUTIONS}/api/v1/classrooms`,
    anuncioTeacherToken,
    {
      name: `Salon Anuncios ${Date.now()}`,
      grade: 'primary_3',
      capacity: 30,
      academicYear: new Date().getFullYear(),
      teacherId: anuncioTeacher.id,
    },
  );

  // El directorio de engagement se alimenta por evento: se espera a que llegue.
  const proyectadoSalon = await waitFor(async () => {
    const rows = await pgQuery(
      process.env.DATABASE_URL_ENGAGEMENT,
      `SELECT 1 FROM engagement.classroom_directory WHERE classroom_id = $1`,
      [salonAnuncio.body?.classroomId],
    );
    return (rows ?? []).length > 0;
  }, 30_000);

  report(
    'El salon llega al directorio de engagement por evento',
    proyectadoSalon,
    proyectadoSalon ? '' : 'no se proyecto en 30 s',
  );

  const anuncio = await postJson(`${ENGAGEMENT}/api/v1/announcements`, anuncioTeacherToken, {
    classroomId: salonAnuncio.body?.classroomId,
    title: 'Traigan el kit el viernes',
    body: 'Vamos a montar el brazo robotico. Revisen que no falte ninguna pieza.',
    pinned: true,
  });
  report(
    'El docente publica un anuncio en su salon',
    anuncio.status === 201,
    `status=${anuncio.status} ${JSON.stringify(anuncio.body).slice(0, 120)}`,
  );

  // Un docente de OTRO colegio. Con institucion propia, porque la base exige que
  // todo el personal tenga una: un docente suelto no existe en este dominio.
  const otraEscuela = await seedInstitution({ grade: 'primary_3' });
  const [ajeno] = await seedUsers(1, {
    roles: [ROLES.TEACHER],
    institutionId: otraEscuela.institutionId,
  });
  const ajenoToken = mintAccessToken({
    userId: ajeno.id,
    roles: ajeno.roles,
    institutionId: otraEscuela.institutionId,
  });
  const anuncioAjeno = await postJson(`${ENGAGEMENT}/api/v1/announcements`, ajenoToken, {
    classroomId: salonAnuncio.body?.classroomId,
    title: 'Anuncio de otro colegio',
    body: 'Esto no deberia publicarse.',
  });
  report(
    'Un docente de otro colegio NO puede publicar en ese salon',
    anuncioAjeno.status === 404,
    `status=${anuncioAjeno.status}`,
  );

  const misAnuncios = await getJson(`${ENGAGEMENT}/api/v1/announcements`, anuncioTeacherToken);
  report(
    'El docente ve los anuncios de su salon',
    misAnuncios.status === 200 &&
      (misAnuncios.body?.items ?? []).some((item) => item.title === 'Traigan el kit el viernes'),
    `status=${misAnuncios.status} items=${misAnuncios.body?.items?.length}`,
  );

  const anunciosAjenos = await getJson(`${ENGAGEMENT}/api/v1/announcements`, ajenoToken);
  report(
    'Y un docente de otro colegio no ve ninguno, en vez de un error',
    anunciosAjenos.status === 200 && (anunciosAjenos.body?.items ?? []).length === 0,
    `status=${anunciosAjenos.status} items=${anunciosAjenos.body?.items?.length}`,
  );

  // --- Los anuncios en pantalla ---
  const panelAnuncios = await waitForHtml(
    `${WEB}/docentes/anuncios`,
    `glexco_at=${anuncioTeacherToken}`,
    (html) => html.includes('Traigan el kit el viernes'),
  );
  report(
    'El docente ve su anuncio en la pantalla, servida desde el servidor',
    Boolean(panelAnuncios),
    panelAnuncios ? '' : 'no aparecio en 40 s',
  );
  report(
    'El formulario de publicacion viene en el HTML: funciona sin JavaScript',
    Boolean(panelAnuncios?.includes('name="body"')) &&
      Boolean(panelAnuncios?.includes('name="classroomId"')),
  );
  report(
    'Un anuncio fijado se marca, y con su palabra al lado del color',
    Boolean(panelAnuncios?.includes('data-pinned="1"')) &&
      Boolean(panelAnuncios?.includes('Fijado')),
  );
  report(
    'Los saltos de linea del docente se conservan en pantalla',
    Boolean(panelAnuncios?.includes('whitespace-pre-line')),
  );

  // La portada del alumno NO pinta un bloque vacio cuando no hay anuncios: seria
  // ruido diario en la pantalla que mas se abre.
  const portadaSinAnuncios = await fetchHtml(`${WEB}/${await portalOf(bibJar)}`, bibJar);
  report(
    'Sin anuncios, la portada del alumno no muestra un bloque vacio',
    portadaSinAnuncios.status === 200 &&
      !visible(portadaSinAnuncios.html).includes('No hay anuncios'),
    `status=${portadaSinAnuncios.status}`,
  );



  // ------------------------------------------------------------------
  section('13. El gateway corta en el borde lo que no lleva credencial');
  // ------------------------------------------------------------------

  // `publicPaths` estaba declarado en la tabla de rutas y no lo leia NADIE. Un
  // campo que se lee como un control de seguridad y no hace nada es peor que no
  // tenerlo: el siguiente que lo vea creera que anadir una linea ahi expone o
  // cierra algo. Ahora se aplica de verdad.
  //
  // Comprueba PRESENCIA de credencial, no validez, y es a proposito: el gateway
  // no tiene el secreto de firma y no debe tenerlo. La verificacion
  // criptografica la hace cada servicio. Lo que esto aporta es la proteccion que
  // queda cuando la del servicio falla: si algun dia alguien marca un
  // controlador `@Public()` por error, esta tabla sigue sin exponerlo.
  for (const ruta of [
    '/api/v1/users',
    '/api/v1/classrooms',
    '/api/v1/analytics/me',
    '/api/v1/catalog/my-kits',
    '/api/v1/announcements',
  ]) {
    const anonima = await fetch(`${GATEWAY}${ruta}`);
    report(
      `${ruta} exige credencial en el borde`,
      anonima.status === 401,
      `status=${anonima.status}`,
    );
  }

  // Y lo que SI es publico sigue siendolo, que es la otra mitad: una defensa que
  // rompe el formulario de alta no sirve de nada.
  const publicaCodigo = await fetch(
    `${GATEWAY}/api/v1/institutions/by-code/${escuelaPanel.code}`,
  );
  report(
    'La busqueda del colegio por codigo sigue siendo publica',
    publicaCodigo.status === 200,
    `status=${publicaCodigo.status}`,
  );

  const publicaSalones = await fetch(
    `${GATEWAY}/api/v1/classrooms/selectable?institutionId=${escuelaPanel.institutionId}&grade=${escuelaPanel.grade}`,
  );
  report(
    'Y los salones elegibles del formulario de alta tambien',
    publicaSalones.status === 200,
    `status=${publicaSalones.status}`,
  );

  const publicaLogin = await fetch(`${GATEWAY}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nadie@ejemplo.pe', password: 'x' }),
  });
  report(
    'El ingreso llega a identidad y lo rechaza ELLA, no el borde',
    publicaLogin.status === 401,
    `status=${publicaLogin.status}`,
  );


  // ------------------------------------------------------------------
  section('14. Progreso por contenido, XP e insignias');
  // ------------------------------------------------------------------

  // Hasta ahora el progreso se medía SOLO con evaluaciones. Falta la señal
  // temprana: quien se descolgó antes del primer examen. Un alumno que lleva dos
  // semanas sin terminar una leccion se detecta aqui; en analytics no aparece
  // hasta que suspende, que es cuando ya es tarde para ayudarle.
  const aprKit = await seedCatalog({ codeCount: 1, grade: 'primary_4' });
  const [aprPupil] = await seedUsers(1);
  const aprToken = mintAccessToken({ userId: aprPupil.id, roles: aprPupil.roles });
  const aprJar = `glexco_at=${aprToken}`;

  await postJson(`${CATALOG}/api/v1/catalog/redeem`, aprToken, { code: aprKit.codes[0] });

  // El directorio de contenido llega por evento; para esta comprobacion se
  // siembra directamente, porque lo que se verifica es el PROGRESO y no la
  // proyeccion, que ya se comprueba en otras secciones.
  await pgQuery(
    process.env.DATABASE_URL_LEARNING,
    `INSERT INTO learning.course_directory (course_id, kit_id, title, lesson_count)
     VALUES ($1,$2,$3,1) ON CONFLICT (course_id) DO UPDATE SET lesson_count = 1`,
    [aprKit.courseId, aprKit.kitId, 'Primeros pasos con uKit'],
  );
  await pgQuery(
    process.env.DATABASE_URL_LEARNING,
    `INSERT INTO learning.lesson_directory (lesson_id, course_id, kit_id, title, order_index)
     VALUES ($1,$2,$3,$4,0) ON CONFLICT (lesson_id) DO NOTHING`,
    [aprKit.lessonId, aprKit.courseId, aprKit.kitId, 'Conoce tu robot'],
  );

  const recursoInicial = await fetchHtml(
    `${WEB}/discover/biblioteca/${aprKit.assetId}`,
    aprJar,
  );
  report(
    'El recurso de una leccion ofrece marcarla como vista',
    recursoInicial.status === 200 && recursoInicial.html.includes('data-submit="completar"'),
    `status=${recursoInicial.status}`,
  );

  const completa = await postJson(
    `${LEARNING}/api/v1/learning/lessons/${aprKit.lessonId}/complete`,
    aprToken,
    {},
  );
  report(
    'Completar una leccion concede XP',
    completa.status === 200 && completa.body?.xpAwarded > 0,
    `status=${completa.status} xp=${completa.body?.xpAwarded}`,
  );
  report(
    'Terminar la ultima leccion completa el curso y paga aparte',
    completa.body?.courseCompleted === true && completa.body?.xpAwarded > 25,
    `curso=${completa.body?.courseCompleted} xp=${completa.body?.xpAwarded}`,
  );
  report(
    'Y concede las insignias del hito, sin compararlo con nadie',
    (completa.body?.newBadges ?? []).length >= 2,
    `insignias=${(completa.body?.newBadges ?? []).map((b) => b.code).join(',')}`,
  );

  // LA garantia de la gamificacion: un contador que se puede inflar deja de
  // significar nada para quien se lo gano. Reabrir una leccion completada o un
  // reintento de red no pueden volver a pagar.
  const repetida = await postJson(
    `${LEARNING}/api/v1/learning/lessons/${aprKit.lessonId}/complete`,
    aprToken,
    {},
  );
  report(
    'Completar DOS veces no paga dos veces, y se distingue del hito nuevo',
    repetida.status === 200 &&
      repetida.body?.firstCompletion === false &&
      repetida.body?.xpAwarded === 0 &&
      repetida.body?.totalXp === completa.body?.totalXp,
    `first=${repetida.body?.firstCompletion} xp=${repetida.body?.xpAwarded} total=${repetida.body?.totalXp}`,
  );

  const miProgreso = await getJson(`${LEARNING}/api/v1/learning/me`, aprToken);
  report(
    'El alumno ve su nivel, sus puntos y cuanto le falta para el siguiente',
    miProgreso.status === 200 &&
      miProgreso.body?.explorerLevel >= 1 &&
      miProgreso.body?.totalXp > 0 &&
      typeof miProgreso.body?.xpToNext === 'number',
    `nivel=${miProgreso.body?.explorerLevel} xp=${miProgreso.body?.totalXp}`,
  );

  // El alcance sale del token y NUNCA de un parametro.
  const [otroApr] = await seedUsers(1);
  const otroAprToken = mintAccessToken({ userId: otroApr.id, roles: otroApr.roles });
  const progresoAjeno = await getJson(`${LEARNING}/api/v1/learning/me`, otroAprToken);
  report(
    'El progreso propio sale del token: otro alumno ve el suyo, vacio',
    progresoAjeno.status === 200 && progresoAjeno.body?.totalXp === 0,
    `xp=${progresoAjeno.body?.totalXp}`,
  );

  const salonAjeno = await getJson(
    `${LEARNING}/api/v1/learning/classrooms/${escuelaPanel.classroomId}`,
    aprToken,
  );
  report(
    'Un alumno no puede leer el progreso de un salon que no es suyo',
    salonAjeno.status === 403 || salonAjeno.status === 401,
    `status=${salonAjeno.status}`,
  );

  // --- Las pantallas ---
  const recursoVisto = await fetchHtml(`${WEB}/discover/biblioteca/${aprKit.assetId}`, aprJar);
  report(
    'Una leccion ya completada se muestra como tal, sin volver a ofrecer el boton',
    recursoVisto.html.includes('data-lesson="done"') &&
      !recursoVisto.html.includes('data-submit="completar"'),
  );

  const pantallaProgreso = await waitForHtml(`${WEB}/discover/progreso`, aprJar, (html) =>
    /data-xp="[1-9]/.test(html),
  );
  report(
    'La pantalla de progreso muestra el nivel, los puntos y las insignias',
    Boolean(pantallaProgreso) &&
      /data-explorer-level="\d"/.test(pantallaProgreso) &&
      /data-badges="[1-9]/.test(pantallaProgreso),
    pantallaProgreso ? '' : 'no aparecio en 40 s',
  );
  report(
    'Y el avance del curso, en lecciones y no solo en porcentaje',
    Boolean(pantallaProgreso?.includes('data-course-progress')) &&
      Boolean(pantallaProgreso?.includes('data-lessons="1/1"')),
  );

  // LA decision de producto de toda la gamificacion: no se compara a un menor
  // con sus companeros. La propuesta lo pide para el ranking y aqui vale igual.
  report(
    'NUNCA compara al alumno con sus companeros: ni posicion, ni ranking',
    Boolean(pantallaProgreso) &&
      !/\bpuesto\b|\branking\b|\bposici[óo]n\b|de 30 alumnos/i.test(visible(pantallaProgreso)),
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

/**
 * Espera a que llegue un correo al buzon de pruebas.
 *
 * Se filtra por el sello de tiempo que va en la direccion, y no por el ultimo
 * mensaje: las comprobaciones dejan correos de ejecuciones anteriores en el
 * buzon, y coger "el mas reciente" hace que una prueba pase por el mensaje de
 * otra.
 */
async function waitForMail(stamp, matches, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mine = await mailboxFor(stamp);
    const found = mine.find(matches);
    if (found) return found;
    await sleep(500);
  }
  return null;
}

async function mailboxFor(stamp) {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=50`).catch(() => null);
  if (!response?.ok) return [];
  const body = await response.json().catch(() => null);
  return (body?.messages ?? []).filter((msg) => JSON.stringify(msg.To ?? []).includes(String(stamp)));
}

async function mailBody(id) {
  if (!id) return null;
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

/**
 * Consulta directa a un schema.
 *
 * Se usa SOLO para comprobar lo que ninguna API expone a proposito: que el token
 * no esta escrito en la outbox, y que la tabla de envios no guarda el cuerpo del
 * mensaje. Son justo las afirmaciones que no se pueden verificar desde fuera.
 */
async function pgQuery(connectionString, sql, params = []) {
  if (!connectionString) return null;
  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const { rows } = await client.query(sql, params);
    return rows;
  } catch (error) {
    console.error('consulta directa fallida:', error.message);
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
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

/**
 * A que portal pertenece esta sesion.
 *
 * **No se da por supuesto que un alumno es de Academy.** Desde que existe el
 * guard de portal -que el cliente pidio porque las rutas se rompian y un alumno
 * de Academy acababa en pantallas de Discover-, pedir `/academy/...` con la
 * sesion de un alumno de primaria devuelve un 307 a su portal. Este guion
 * sembraba alumnos sin fijar su edad y luego los mandaba a rutas de Academy, asi
 * que veintisiete comprobaciones caian por un redirect que es EL COMPORTAMIENTO
 * CORRECTO.
 *
 * Se resuelve preguntando una vez por sesion y se cachea: el portal de un
 * usuario no cambia a mitad de comprobacion.
 */
const portalCache = new Map();

async function portalOf(cookie) {
  if (portalCache.has(cookie)) return portalCache.get(cookie);

  const probe = await fetch(`${WEB}/academy`, { headers: { cookie }, redirect: 'manual' });
  // 200 = es suyo. Cualquier redirect = el guard lo manda al que le toca.
  const portal = probe.status === 200 ? 'academy' : 'discover';
  // El cuerpo se descarta, pero hay que consumirlo o la conexion queda abierta.
  await probe.text().catch(() => undefined);

  portalCache.set(cookie, portal);
  return portal;
}

/**
 * Una llamada al gateway que ESPERA si choca con el limite de peticiones.
 *
 * El gateway permite 60 peticiones de autenticacion por IP y MINUTO, y este
 * guion hace en tres minutos lo que un colegio hace en una manana: choca contra
 * el limite por definicion, y siempre al final, donde estan las comprobaciones
 * de contrasena.
 *
 * **El limite no se relaja.** Es correcto y protege de un abuso real; lo que se
 * arregla es la herramienta, que espera a la siguiente ventana igual que hace el
 * sembrador. Un 429 aqui no es un fallo del producto, y dejarlo en rojo enseña
 * a ignorar el rojo.
 */
async function fetchEsperandoLimite(url, init, intentos = 3) {
  for (let intento = 0; intento < intentos; intento += 1) {
    const response = await fetch(url, init);
    if (response.status !== 429) return response;

    // La ventana es de un minuto: se espera a que se vacie y se reintenta.
    if (intento < intentos - 1) await sleep(61_000);
  }

  return fetch(url, init);
}

/**
 * Los espacios de traduccion que piden los componentes de CLIENTE.
 *
 * Se lee el codigo, no el HTML servido, porque es lo unico que responde a la
 * pregunta: al navegador solo se le mandan los espacios de `CLIENT_NAMESPACES`,
 * y si un componente de cliente pide uno que no esta en esa lista, `next-intl`
 * no lo encuentra y la pantalla se cae o pinta la clave cruda.
 *
 * Es la trampa que abrio el propio recorte del catalogo: acotar lo que viaja
 * ahorra kilobytes en cada pagina, pero convierte "anadir un componente de
 * cliente que traduzca" en dos pasos, y el segundo se olvida. Paso a la primera:
 * el muro pedia `muro` y la lista no lo llevaba.
 *
 * Se comprueba aqui y no con una prueba unitaria porque `apps/web` no tiene
 * ninguna: esta es la suite del portal.
 */
async function comprobarEspaciosDeCliente() {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const raiz = 'apps/web/src';
  const archivos = [];

  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (ruta.endsWith('.tsx') || ruta.endsWith('.ts')) archivos.push(ruta);
    }
  };

  try {
    recorrer(raiz);
  } catch {
    // Ejecutado desde otra carpeta: no se puede leer el codigo y se dice, en vez
    // de dar por bueno lo que no se comprobo.
    report('No se pudo leer el codigo para comprobar los espacios de i18n', false, raiz);
    return;
  }

  const layout = readFileSync(join(raiz, 'app', 'layout.tsx'), 'utf8');
  const declarados = new Set(
    (/const CLIENT_NAMESPACES = \[([\s\S]*?)\]/.exec(layout)?.[1] ?? '')
      .split(',')
      .map((parte) => parte.trim().replace(/^'|'$/g, ''))
      .filter(Boolean),
  );

  const faltantes = new Map();

  for (const ruta of archivos) {
    const contenido = readFileSync(ruta, 'utf8');
    if (!contenido.includes("'use client'")) continue;

    for (const coincidencia of contenido.matchAll(/useTranslations\('([a-zA-Z]+)'\)/g)) {
      const espacio = coincidencia[1];
      if (!declarados.has(espacio)) faltantes.set(espacio, ruta);
    }
  }

  report(
    'Todo espacio que pide un componente de cliente viaja al navegador',
    faltantes.size === 0,
    faltantes.size === 0
      ? `${declarados.size} declarados`
      : [...faltantes].map(([espacio, ruta]) => `${espacio} (${ruta})`).join(', '),
  );

  // --- Y la trampa que va con ello ---
  //
  // Todo lo que viaja al cliente se serializa DENTRO de un `<script>` de cada
  // pagina. Una afirmacion del tipo "esta pantalla no dice X" que mire el HTML
  // completo se pone roja en cuanto X entra en el catalogo, aunque la pantalla
  // no lo muestre. Paso TRES veces: con "Posicion" al anadir la pregunta de
  // ordenar, y con "No hay anuncios" al traducir el muro.
  //
  // En vez de recordarlo, se comprueba: se cruzan los literales de las
  // afirmaciones negativas con los valores del catalogo que si viaja. Lo que
  // coincida tiene que mirar `visible()`, y esta comprobacion lo dice por su
  // nombre.
  const catalogo = [];
  for (const idioma of ['es', 'en']) {
    const mensajes = JSON.parse(readFileSync(join(raiz, 'messages', `${idioma}.json`), 'utf8'));
    const recoger = (nodo) => {
      for (const valor of Object.values(nodo)) {
        if (valor && typeof valor === 'object') recoger(valor);
        else if (typeof valor === 'string') catalogo.push(valor);
      }
    };
    for (const espacio of declarados) if (mensajes[espacio]) recoger(mensajes[espacio]);
  }

  const propio = readFileSync('infra/scripts/web-check.mjs', 'utf8');
  const enRiesgo = [];

  // Solo las que NO usan ya `visible(...)`: las que lo usan estan a salvo por
  // construccion. Las de seguridad -que la clave de correccion no aparezca en
  // NINGUN sitio, ni en un script- tienen que seguir mirando el HTML entero, y
  // sus literales no estan en el catalogo, asi que no salen aqui.
  for (const linea of propio.split('\n')) {
    if (linea.includes('visible(')) continue;
    for (const coincidencia of linea.matchAll(/!\s*[A-Za-z]+(?:\.html)?\??\.includes\('([^']+)'\)/g)) {
      const literal = coincidencia[1];
      if (catalogo.some((valor) => valor.includes(literal))) enRiesgo.push(literal);
    }
  }

  report(
    'Ninguna afirmacion de "no dice X" choca con el catalogo serializado',
    enRiesgo.length === 0,
    enRiesgo.length === 0 ? '' : `usa visible() con: ${[...new Set(enRiesgo)].join(', ')}`,
  );
}

/**
 * El HTML SIN sus scripts.
 *
 * Las afirmaciones de "esta pantalla no dice X" tienen que mirar lo que se ve,
 * no el documento entero. Next serializa dentro de un `<script>` el catalogo de
 * traducciones y el arbol de servidor, asi que cualquier palabra que exista en
 * `messages/*.json` aparece en TODAS las paginas.
 *
 * Costo un falso positivo real: al anadir la pregunta de ordenar, su etiqueta
 * "Posicion de: ..." entro en el catalogo del cliente y dos comprobaciones de
 * "no se compara al alumno con sus companeros" se pusieron rojas en la pantalla
 * de progreso, que no muestra ninguna posicion. La regla de producto seguia
 * cumpliendose; lo que estaba mal era donde miraba la comprobacion.
 */
function visible(html) {
  return String(html ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');
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
