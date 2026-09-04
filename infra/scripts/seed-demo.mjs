#!/usr/bin/env node
/**
 * Siembra un colegio de demostracion completo.
 *
 * **Para que sirve.** Una plataforma recien desplegada esta vacia, y vacia no se
 * puede ensenar ni probar: no hay a quien iniciar sesion, ni kit que abrir, ni
 * dashboard que mirar. Esto crea un colegio entero -personas, contenido,
 * evaluaciones y calificaciones- de modo que cada pantalla tenga algo real que
 * mostrar desde el primer minuto.
 *
 * **Todo es reemplazable.** El personal de GLEXCO puede borrarlo, editarlo o
 * anadir lo suyo desde el portal: no hay nada marcado como intocable ni ninguna
 * fila que el producto trate distinto por venir de aqui.
 *
 * **Como esta construido, y por que asi.** Las personas, la institucion y el
 * catalogo se escriben directamente en la base: darlos de alta por HTTP chocaria
 * con los limites de fuerza bruta -diez registros por IP y hora-, que son
 * correctos y no se van a relajar para que una herramienta tenga la vida mas
 * facil. Todo lo demas -matriculas, canjes, evaluaciones, entregas y
 * correcciones- pasa por la API de verdad, con tokens firmados, para que los
 * eventos se publiquen y las proyecciones de analitica y de progreso se
 * alimenten solas. Sembrar esas tablas a mano produciria dashboards que se ven
 * bien y que no se corresponden con nada.
 *
 * Uso (dentro de Railway, con la cadena de administrador):
 *   ADMIN_DATABASE_URL=... GATEWAY_URL=https://... DEMO_PASSWORD=...
 *   node infra/scripts/seed-demo.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import contracts from '@glexco/contracts';

const { ROLE_PERMISSIONS } = contracts;

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const API = `${GATEWAY}/api/v1`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'GlexcoDemo2026!';
const PEPPER = process.env.ACTIVATION_CODE_PEPPER ?? '';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
if (!ADMIN_URL) {
  console.error('Falta ADMIN_DATABASE_URL.');
  process.exit(1);
}


/**
 * Identificador estable a partir de un nombre.
 *
 * **Es lo que hace que este sembrador se pueda ejecutar dos veces.** Con UUID al
 * azar, la segunda pasada creaba kits nuevos, los `ON CONFLICT` saltaban la
 * insercion y las claves foraneas apuntaban a filas que no existian: el fallo
 * aparecia tres tablas mas adelante y no decia nada de la causa.
 *
 * Derivado de un hash, asi que el mismo nombre da siempre el mismo id y volver a
 * sembrar actualiza en lugar de duplicar.
 */
function idFor(kind, key) {
  const hex = createHash('sha256').update(`glexco-demo:${kind}:${key}`).digest('hex');
  // Se fuerza la version 4 y la variante para que sea un UUID valido: PostgreSQL
  // rechaza la columna `uuid` si no lo es.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// El colegio de demostracion
// ---------------------------------------------------------------------------

const INSTITUTION = {
  id: idFor('institution', 'DEMO-SMP'),
  code: 'DEMO-SMP',
  name: 'Colegio San Martín de Porres',
  shortName: 'San Martín',
  city: 'Lima',
};

/**
 * Los kits, con su contenido.
 *
 * Los tutoriales en video son ENLACES EXTERNOS a YouTube y no archivos en el
 * almacen. Es deliberado para una demostracion: un MP4 de relleno no se puede
 * generar de forma honesta, y un archivo que dice ser video y no lo es deja al
 * reproductor en negro, que se lee como que la plataforma esta rota. Un enlace
 * externo se abre fuera, funciona, y es ademas uno de los tres caminos de
 * entrega reales del producto.
 */
/**
 * Pagina oficial de cada robot en UBTECH.
 *
 * Los tutoriales sembrados apuntan aqui mientras no haya video propio. Es un
 * relleno, pero un relleno HONESTO: quien abra un tutorial de la demo acaba en
 * la ficha real del robot que tiene delante, no en un enlace de broma ni en un
 * 404. Un enlace muerto en una demo se lee como que la plataforma esta rota.
 *
 * URLs comprobadas contra el sitio oficial. Si UBTECH reorganiza su web hay que
 * revisarlas: no hay forma de detectar aqui que una empezo a devolver 404.
 */
const UBTECH_PAGES = {
  ukit: 'https://www.ubtrobot.com/en/ai-education/products/ukit-explore',
  ukit_ai: 'https://www.ubtrobot.com/en/ai-education/products/ukit-ai',
  ugot: 'https://www.ubtrobot.com/en/ai-education/products/ugot',
  yanshee: 'https://www.ubtrobot.com/en/ai-education/products/yanshee',
};

/** El enlace del kit, o el sitio de educacion si su robot no esta en la tabla. */
function ubtechPageFor(platform) {
  return UBTECH_PAGES[platform] ?? 'https://www.ubtrobot.com/en/ai-education';
}

const KITS = [
  {
    id: idFor('kit', 'UKIT-EXPLORE-P4'),
    code: 'UKIT-EXPLORE-P4',
    name: 'uKit Explore — 4.º de primaria',
    description: 'Construccion y programacion por bloques con el uKit Explore.',
    program: 'discover',
    grade: 'primary_4',
    platforms: ['ukit'],
    course: {
      id: idFor('course', 'ukit-p4'),
      title: 'Primeros pasos con uKit',
      lessons: [
        { id: idFor('lesson', 'Conoce las piezas de tu kit'), title: 'Conoce las piezas de tu kit', minutes: 15 },
        { id: idFor('lesson', 'Tu primer motor en movimiento'), title: 'Tu primer motor en movimiento', minutes: 20 },
        { id: idFor('lesson', 'Montamos el brazo robotico'), title: 'Montamos el brazo robotico', minutes: 25 },
      ],
    },
  },
  {
    id: idFor('kit', 'UGOT-P6'),
    code: 'UGOT-P6',
    name: 'uGot — 6.º de primaria',
    description: 'Robotica movil y sensores con el uGot.',
    program: 'discover',
    grade: 'primary_6',
    platforms: ['ugot'],
    course: {
      id: idFor('course', 'ugot-p6'),
      title: 'uGot en movimiento',
      lessons: [
        { id: idFor('lesson', 'El robot que ve'), title: 'El robot que ve', minutes: 18 },
        { id: idFor('lesson', 'Sigue la linea'), title: 'Sigue la linea', minutes: 22 },
      ],
    },
  },
  {
    id: idFor('kit', 'YANSHEE-S2'),
    code: 'YANSHEE-S2',
    name: 'Yanshee — 2.º de secundaria',
    description: 'Robotica humanoide y Python con Yanshee.',
    program: 'academy',
    grade: 'secondary_2',
    platforms: ['yanshee'],
    course: {
      id: idFor('course', 'yanshee-s2'),
      title: 'Programando a Yanshee con Python',
      lessons: [
        { id: idFor('lesson', 'Del bloque al codigo'), title: 'Del bloque al codigo', minutes: 30 },
        { id: idFor('lesson', 'Vision artificial basica'), title: 'Vision artificial basica', minutes: 35 },
        { id: idFor('lesson', 'Tu primer proyecto propio'), title: 'Tu primer proyecto propio', minutes: 40 },
      ],
    },
  },
];

const CLASSROOMS = [
  { id: idFor('classroom', '4A'), name: '4.º A', grade: 'primary_4', kit: 0 },
  { id: idFor('classroom', '6B'), name: '6.º B', grade: 'primary_6', kit: 1 },
  { id: idFor('classroom', '2S'), name: '2.º de secundaria A', grade: 'secondary_2', kit: 2 },
];

const STAFF = [
  { key: 'glexco', first: 'Equipo', last: 'GLEXCO', role: 'platform_owner', institution: null },
  { key: 'director', first: 'Carmen', last: 'Delgado', role: 'institution_admin', institution: true },
  { key: 'docente1', first: 'Luis', last: 'Ramirez', role: 'teacher', institution: true },
  { key: 'docente2', first: 'Ana', last: 'Quispe', role: 'teacher', institution: true },
  { key: 'docente3', first: 'Jorge', last: 'Mendoza', role: 'teacher', institution: true },
];

const STUDENT_NAMES = [
  ['Mateo', 'Rojas'], ['Valentina', 'Torres'], ['Diego', 'Flores'], ['Camila', 'Vargas'],
  ['Sebastian', 'Castro'], ['Luciana', 'Herrera'], ['Joaquin', 'Medina'], ['Emilia', 'Salazar'],
  ['Gabriel', 'Paredes'], ['Isabella', 'Cordova'], ['Thiago', 'Nunez'], ['Renata', 'Aguilar'],
];

// ---------------------------------------------------------------------------

const admin = new pg.Client({
  connectionString: ADMIN_URL,
  ssl: ADMIN_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

/**
 * Como se ejecuta esto en Railway.
 *
 * Como "comando previo al despliegue" del servicio de identidad, que es el
 * unico sitio desde el que se alcanza PostgreSQL sin exponerlo a internet.
 *
 * Dos trampas, las dos comprobadas a base de perder despliegues:
 *
 * 1. **El comando previo NO pasa por un interprete.** Encadenar con `&&` no
 *    funciona: se ejecuta el primero y el resto se ignora en silencio, con el
 *    despliegue marcado como correcto. Hay que poner UNA sola orden.
 * 2. **`railway redeploy` no recoge un comando previo nuevo.** Reutiliza la
 *    instantanea de configuracion del despliegue anterior, asi que hay que
 *    provocar una construccion de verdad -un commit que toque alguna de las
 *    rutas vigiladas del servicio- para que el cambio surta efecto.
 *
 * Al terminar hay que BORRAR las cuatro variables temporales: la credencial de
 * administrador de PostgreSQL no debe vivir en un servicio de aplicacion, y la
 * pimienta permite reconstruir el hash de cualquier codigo de activacion.
 */
async function main() {
  await admin.connect();
  console.log('Sembrando el colegio de demostracion...\n');

  const argon2 = await import('@node-rs/argon2');
  // El hash lleva sus propios parametros dentro, asi que verificarlo despues no
  // depende de que estos coincidan con los del servicio.
  const passwordHash = await argon2.hash(PASSWORD, {
    algorithm: 2, // argon2id
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  await dedupeDemo();

  const people = await seedPeople(passwordHash);
  await seedInstitution(people);
  await archiveOrphanInstitutions(people);
  await seedCatalog();
  const codes = await seedCodes();
  await publishCourses(people);

  console.log('\nDatos base escritos. Ahora se usa la API real...\n');

  await enrollStudents(people);
  await redeemCodes(people, codes);
  const assessments = await seedAssessments(people);
  await seedSubmissions(people, assessments);
  await seedProgress(people);
  await seedAnnouncements(people);

  printAccounts(people);
}

// ---------------------------------------------------------------------------
// Escritura directa: personas, institucion y catalogo
// ---------------------------------------------------------------------------

/**
 * Crea la institucion POR LA API.
 *
 * Es lo unico que emite `institution.created`, y de ese evento cuelga el
 * directorio de analitica: sin el, el panel de GLEXCO lista la cartera de
 * clientes por identificador en vez de por nombre.
 *
 * Va DESPUES del administrador de plataforma -que hace falta para firmar el
 * token- y ANTES del resto del personal, que se crea ya con el id real del
 * colegio. Al reves, todos quedarian apuntando a una institucion que no existe.
 */
async function createInstitution(glexco) {
  const created = await api('/institutions', {
    method: 'POST',
    body: {
      code: INSTITUTION.code,
      name: INSTITUTION.name,
      shortName: INSTITUTION.shortName,
      educationLevels: ['primary', 'secondary'],
      responsibleName: 'Carmen Delgado',
      contactEmail: 'direccion@demo.glexco.pe',
      city: INSTITUTION.city,
    },
    as: token(glexco.id, ['platform_owner'], null),
  });

  if (created.status === 201) {
    INSTITUTION.id = created.body.institutionId;
    return;
  }

  // Ya existia: se adopta su identificador. Suponer el nuestro dejaria a todo lo
  // que cuelga de el apuntando a una fila que no esta.
  const existing = await admin.query(
    'SELECT id FROM institutions.institutions WHERE code = $1',
    [INSTITUTION.code],
  );
  if (existing.rows[0]) INSTITUTION.id = existing.rows[0].id;
  else console.log(`  ! institucion: ${created.status} ${JSON.stringify(created.body).slice(0, 120)}`);
}

/**
 * Limpia lo que las siembras anteriores duplicaron.
 *
 * Hasta ahora este guion creaba salones, evaluaciones y anuncios por la API sin
 * comprobar antes si ya existian, y la API no lo impide -y hace bien: dos "4.o
 * A" de anos distintos son dos salones legitimos, y un docente puede querer dos
 * versiones del mismo examen-. El resultado era que cada ejecucion anadia una
 * copia: la demo acabo con veinte anuncios identicos en la portada del alumno y
 * cuatro veces la misma evaluacion en "proximas actividades". Eso no se lee como
 * "se sembro dos veces", se lee como que la plataforma esta rota.
 *
 * Las guardas nuevas evitan que vuelva a pasar; esto limpia lo que ya paso.
 *
 * Tres reglas para no perder nada real:
 *
 * - Solo toca la institucion de DEMOSTRACION y solo los titulos exactos que
 *   este guion escribe. No es un deduplicador general.
 * - Se queda con la copia que TIENE datos colgando -matriculas, entregas- y no
 *   con la mas antigua. Al reves se archivaria justo la que el alumno usa.
 * - Archiva en vez de borrar donde hay historial. Un anuncio duplicado si se
 *   borra, porque no cuelga nada de el y su gemelo dice exactamente lo mismo.
 */
async function dedupeDemo() {
  // Salones repetidos: se conserva el que mas alumnos matriculados tiene.
  const classrooms = await admin.query(
    `WITH ranked AS (
       SELECT c.id, c.name,
              row_number() OVER (
                PARTITION BY c.name
                ORDER BY (SELECT count(*) FROM institutions.enrollments e
                           WHERE e.classroom_id = c.id AND e.status = 'active') DESC,
                         c.created_at ASC
              ) AS rn
         FROM institutions.classrooms c
        WHERE c.institution_id = $1 AND c.status = 'active'
     )
     UPDATE institutions.classrooms SET status = 'archived', updated_at = now()
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING id`,
    [INSTITUTION.id],
  );

  // Evaluaciones repetidas del banco de GLEXCO: se conserva la que mas entregas
  // acumula, que es la que aparece en los dashboards.
  const assessments = await admin.query(
    `WITH ranked AS (
       SELECT a.id,
              row_number() OVER (
                PARTITION BY a.kit_id, a.title
                ORDER BY (SELECT count(*) FROM assessment.submissions s
                           WHERE s.assessment_id = a.id) DESC,
                         a.created_at ASC
              ) AS rn
         FROM assessment.assessments a
        WHERE a.origin = 'glexco' AND a.title LIKE 'Evaluacion de %' AND a.status <> 'archived'
     )
     UPDATE assessment.assessments SET status = 'archived', updated_at = now()
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING id`,
  );

  // Anuncios repetidos: aqui si se borra. No cuelga nada de un anuncio y su
  // gemelo dice literalmente lo mismo, asi que archivarlo solo dejaria basura.
  const announcements = await admin.query(
    `WITH ranked AS (
       SELECT id,
              row_number() OVER (
                PARTITION BY classroom_id, title ORDER BY created_at ASC
              ) AS rn
         FROM engagement.announcements
        WHERE institution_id = $1
     )
     DELETE FROM engagement.announcements
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
      RETURNING id`,
    [INSTITUTION.id],
  );

  const total = classrooms.rowCount + assessments.rowCount + announcements.rowCount;
  if (total > 0) {
    console.log(
      `  duplicados       ${classrooms.rowCount} salones y ${assessments.rowCount} evaluaciones archivados, ${announcements.rowCount} anuncios borrados`,
    );
  }
}

async function seedPeople(passwordHash) {
  const people = { staff: {}, students: [] };

  for (const person of STAFF) {
    const email = `${person.key}@demo.glexco.pe`;
    const id = idFor('user', email);

    await admin.query(
      `INSERT INTO identity.users
         (id, email, first_name, last_name, password_hash, roles, institution_id,
          status, account_type, email_verified, locale, birth_date, accepted_terms_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active','staff',true,'es',$8, now(),1)
       -- La contrasena SI se actualiza al resembrar. Con DO NOTHING, el
       -- sembrador imprimia unas credenciales y la base guardaba otras: la
       -- herramienta cuyo unico producto util son esas credenciales las
       -- reportaba mal, que es la peor forma posible de fallar.
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [
        id,
        email,
        person.first,
        person.last,
        passwordHash,
        [person.role],
        person.institution ? INSTITUTION.id : null,
        '1985-01-01',
      ],
    );

    // Se adopta el id que ya exista. Sin esto, el sembrador calcula un id
    // determinista, el INSERT lo salta por conflicto de correo, y a partir de
    // ahi todas las llamadas se hacen en nombre de un usuario FANTASMA: el token
    // es valido -lo firmamos nosotros- pero apunta a alguien que no esta en la
    // base, asi que el progreso y las notas se guardan donde nadie las lee.
    const existingUser = await admin.query('SELECT id FROM identity.users WHERE email = $1', [email]);
    const realId = existingUser.rows[0]?.id ?? id;

    people.staff[person.key] = { id: realId, email, ...person };
    console.log(`  ${person.role.padEnd(18)} ${email}`);

    // En cuanto existe el administrador de plataforma se crea el colegio: el
    // resto del personal se da de alta ya con su identificador real.
    if (person.key === 'glexco') await createInstitution(people.staff.glexco);
  }

  // Los alumnos se reparten entre los tres salones.
  STUDENT_NAMES.forEach((name, index) => {
    const email = `alumno${index + 1}@demo.glexco.pe`;
    people.students.push({
      id: idFor('user', email),
      email,
      first: name[0],
      last: name[1],
      classroom: index % CLASSROOMS.length,
    });
  });

  for (const student of people.students) {
    const classroom = CLASSROOMS[student.classroom];
    const esPrimaria = classroom.grade.startsWith('primary');
    await admin.query(
      // El grado NO es columna de `users`: vive en la matricula del salon, que
      // es donde tiene sentido -un alumno cambia de grado cada curso, y su
      // cuenta no-.
      // El apoderado es obligatorio en menores de 14 y la base lo hace valer con
      // una restriccion, no solo el codigo. Los de primaria lo llevan; los de
      // secundaria de este colegio ya pasan de esa edad.
      `INSERT INTO identity.users
         (id, email, first_name, last_name, password_hash, roles, institution_id,
          status, account_type, email_verified, locale, birth_date, guardian_email,
          accepted_terms_at, version)
       VALUES ($1,$2,$3,$4,$5,ARRAY['student'],$6,'active','institutional',true,'es',$7,$8, now(),1)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [
        student.id,
        student.email,
        student.first,
        student.last,
        passwordHash,
        INSTITUTION.id,
        esPrimaria ? '2016-03-15' : '2009-08-20',
        esPrimaria ? `apoderado.${student.email}` : null,
      ],
    );
  }
  // Mismo criterio que con el personal: el id real manda sobre el calculado.
  for (const student of people.students) {
    const row = await admin.query('SELECT id FROM identity.users WHERE email = $1', [student.email]);
    if (row.rows[0]) student.id = row.rows[0].id;
  }

  console.log(`  ${'alumnos'.padEnd(18)} ${people.students.length} cuentas`);

  return people;
}

/**
 * Archiva colegios de demostracion huerfanos.
 *
 * Una siembra antigua creo la institucion con otro codigo, asi que ahora
 * conviven dos: el panel de GLEXCO lista dos colegios donde hay uno, y cada
 * docente ve su salon por duplicado. La institucion actual se adopta por CODIGO
 * -`DEMO-SMP`-, asi que la vieja se queda ahi para siempre sin que nada la
 * vuelva a tocar.
 *
 * El criterio es deliberadamente estrecho: solo se archiva una institucion si
 * **todos** sus salones son de los tres docentes de demostracion. Con "alguno"
 * bastaria para archivar un colegio real en el que uno de estos docentes diera
 * clase, y archivar el colegio de otro es un desastre, no un descuido.
 *
 * Se archiva y no se borra: sus matriculas y entregas siguen siendo ciertas, y
 * borrarlas se llevaria por delante el historial de doce alumnos.
 */
async function archiveOrphanInstitutions(people) {
  const teacherIds = [people.staff.docente1.id, people.staff.docente2.id, people.staff.docente3.id];

  const orphans = await admin.query(
    `SELECT i.id
       FROM institutions.institutions i
      WHERE i.id <> $1
        AND i.status = 'active'
        AND EXISTS (SELECT 1 FROM institutions.classrooms c
                     WHERE c.institution_id = i.id AND c.teacher_id = ANY($2::uuid[]))
        AND NOT EXISTS (SELECT 1 FROM institutions.classrooms c
                         WHERE c.institution_id = i.id AND NOT (c.teacher_id = ANY($2::uuid[])))`,
    [INSTITUTION.id, teacherIds],
  );

  if (orphans.rowCount === 0) return;

  const ids = orphans.rows.map((r) => r.id);

  // Los salones tambien: si quedaran activos, el docente seguiria viendo su
  // salon duplicado aunque el colegio ya no aparezca en ningun panel.
  await admin.query(
    `UPDATE institutions.classrooms SET status = 'archived', updated_at = now()
      WHERE institution_id = ANY($1::uuid[]) AND status = 'active'`,
    [ids],
  );
  await admin.query(
    `UPDATE institutions.institutions SET status = 'archived', updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  console.log(`  huerfanos        ${ids.length} institucion(es) de siembras anteriores archivadas`);
}

async function seedInstitution(people) {
  // La institucion ya la creo `createInstitution` por la API. Aqui queda lo que
  // no tiene endpoint propio: la licencia y el directorio de docentes.

  await admin.query(
    `INSERT INTO institutions.licenses (id, institution_id, seats, starts_at, expires_at, granted_by)
     VALUES ($1,$2,500, now() - interval '30 days', now() + interval '335 days', $3)
     ON CONFLICT DO NOTHING`,
    [idFor('license', INSTITUTION.code), INSTITUTION.id, people.staff.glexco.id],
  );

  const teachers = [people.staff.docente1, people.staff.docente2, people.staff.docente3];

  for (const [index, classroom] of CLASSROOMS.entries()) {
    const teacher = teachers[index];
    classroom.teacherId = teacher.id;

    // El directorio de docentes: sin el, la bandeja de correccion diria
    // "a3f1-... entrego su examen" en vez del nombre.
    await admin.query(
      `INSERT INTO institutions.teacher_directory (user_id, institution_id, full_name, email)
       VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING`,
      [teacher.id, INSTITUTION.id, `${teacher.first} ${teacher.last}`, teacher.email],
    );

    // El salon se crea POR LA API y no en la base, a diferencia de todo lo
    // demas de este bloque. Es la unica forma de que se publique
    // `classroom.created`, y de ese evento cuelgan tres directorios: el de la
    // bandeja de correccion, el que decide quien puede publicar un anuncio y el
    // que atribuye el progreso a un salon. Escribiendo la fila a mano, el salon
    // existe y a la vez no existe para media plataforma.
    const as = token(teacher.id, ['teacher'], INSTITUTION.id);

    // Se comprueba ANTES de crear, y no despues del error. La API acepta dos
    // salones con el mismo nombre -es legitimo: dos "4.o A" de anos distintos-,
    // asi que cada siembra creaba uno nuevo y la demo acababa con la lista
    // llena de salones identicos y los alumnos repartidos entre ellos.
    const existing = await admin.query(
      'SELECT id FROM institutions.classrooms WHERE institution_id = $1 AND name = $2 LIMIT 1',
      [INSTITUTION.id, classroom.name],
    );
    if (existing.rows[0]) {
      classroom.id = existing.rows[0].id;
      continue;
    }

    const created = await api('/classrooms', {
      method: 'POST',
      body: {
        name: classroom.name,
        grade: classroom.grade,
        capacity: 35,
        academicYear: new Date().getFullYear(),
        teacherId: teacher.id,
      },
      as,
    });

    if (created.status === 201) {
      classroom.id = created.body.classroomId;
    } else {
      // Ya existia de una siembra anterior: se adopta el que hay.
      const found = await admin.query(
        'SELECT id FROM institutions.classrooms WHERE institution_id = $1 AND name = $2',
        [INSTITUTION.id, classroom.name],
      );
      if (found.rows[0]) classroom.id = found.rows[0].id;
      else console.log(`  ! salon ${classroom.name}: ${created.status} ${JSON.stringify(created.body).slice(0, 120)}`);
    }
  }

  console.log(`  ${'institucion'.padEnd(18)} ${INSTITUTION.name} (${INSTITUTION.code})`);
  console.log(`  ${'salones'.padEnd(18)} ${CLASSROOMS.map((c) => c.name).join(', ')}`);
}

async function seedCatalog() {
  for (const kit of KITS) {
    await admin.query(
      `INSERT INTO catalog.kits (id, code, name, description, program, grade, robot_platforms, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published')
       ON CONFLICT (code) DO NOTHING`,
      [kit.id, kit.code, kit.name, kit.description, kit.program, kit.grade, kit.platforms],
    );

    // Mismo criterio que con la institucion: se adopta el id que ya exista. Y
    // se hace ANTES de insertar el curso: hacerlo despues crea un curso nuevo y
    // luego adopta otro, con lo que cada siembra deja un duplicado mas.
    const found = await admin.query('SELECT id FROM catalog.kits WHERE code = $1', [kit.code]);
    if (found.rows[0]) kit.id = found.rows[0].id;

    const foundCourse = await admin.query(
      'SELECT id FROM catalog.courses WHERE kit_id = $1 ORDER BY order_index LIMIT 1',
      [kit.id],
    );
    if (foundCourse.rows[0]) kit.course.id = foundCourse.rows[0].id;

    await admin.query(
      `INSERT INTO catalog.courses
         (id, kit_id, title, description, robot_platform, order_index, status, estimated_minutes)
       VALUES ($1,$2,$3,'',$4,0,'in_review',$5)
       ON CONFLICT (id) DO NOTHING`,
      [
        kit.course.id,
        kit.id,
        kit.course.title,
        kit.platforms[0],
        kit.course.lessons.reduce((sum, l) => sum + l.minutes, 0),
      ],
    );

    const moduleId = idFor('module', kit.code);
    await admin.query(
      `INSERT INTO catalog.modules (id, course_id, title, order_index)
       VALUES ($1,$2,'Modulo 1',0) ON CONFLICT (id) DO NOTHING`,
      [moduleId, kit.course.id],
    );

    for (const [index, lesson] of kit.course.lessons.entries()) {
      await admin.query(
        `INSERT INTO catalog.lessons
           (id, course_id, module_id, title, description, order_index, status, estimated_minutes)
         VALUES ($1,$2,$3,$4,'',$5,'published',$6)
         ON CONFLICT (id) DO NOTHING`,
        [lesson.id, kit.course.id, moduleId, lesson.title, index, lesson.minutes],
      );

      // Un tutorial en video por leccion, como enlace externo. Ver la nota de
      // KITS: un archivo que dice ser video y no lo es deja el reproductor en
      // negro, y eso se lee como que la plataforma esta rota.
      await admin.query(
        `INSERT INTO catalog.content_assets
           (id, kit_id, lesson_id, title, description, type, storage_kind, storage_ref,
            bucket, locale, status, order_index, downloadable, duration_seconds)
         VALUES ($1,$2,$3,$4,$5,'video','external_link',$6,NULL,'es','published',$7,false,$8)
         -- DO UPDATE y no DO NOTHING: el enlace del tutorial es justo lo que se
         -- corrige entre siembras, y con DO NOTHING una demo ya sembrada se
         -- quedaba con el enlace viejo para siempre por mucho que se arreglara
         -- aqui.
         ON CONFLICT (id) DO UPDATE SET
           title       = EXCLUDED.title,
           description = EXCLUDED.description,
           storage_ref = EXCLUDED.storage_ref`,
        [
          idFor('asset-video', lesson.id),
          kit.id,
          lesson.id,
          `Tutorial: ${lesson.title}`,
          'Ficha oficial del robot en UBTECH, como relleno. El equipo de GLEXCO la reemplaza por su propio video.',
          ubtechPageFor(kit.platforms[0]),
          index * 2,
          lesson.minutes * 60,
        ],
      );

      // Y una ficha descargable, para que el camino de la descarga firmada
      // tambien tenga algo que ensenar.
      await admin.query(
        `INSERT INTO catalog.content_assets
           (id, kit_id, lesson_id, title, description, type, storage_kind, storage_ref,
            bucket, locale, status, order_index, downloadable)
         VALUES ($1,$2,$3,$4,$5,'worksheet','object_storage',$6,'glexco-documents','es','published',$7,true)
         ON CONFLICT (id) DO NOTHING`,
        [
          idFor('asset-ficha', lesson.id),
          kit.id,
          lesson.id,
          `Ficha de trabajo: ${lesson.title}`,
          'Ficha de demostracion. Reemplazable desde el panel de GLEXCO.',
          `kits/${kit.id}/fichas/${lesson.id}.pdf`,
          index * 2 + 1,
        ],
      );
    }

    console.log(`  ${'kit'.padEnd(18)} ${kit.name}`);
  }
}

/**
 * Publica los cursos POR LA API.
 *
 * Los cursos nacen en revision y se publican aqui, no con un `status` escrito a
 * mano en la base. Es lo unico que emite `course.published`, y de ese evento
 * cuelga el directorio de `learning`: sin el, su tabla de lecciones se queda
 * vacia, el progreso por contenido no se puede registrar y el alumno nunca gana
 * XP por completar una leccion. Escribir 'published' directamente deja el curso
 * visible y a la vez invisible para el servicio que mide el progreso.
 */
async function publishCourses(people) {
  const as = token(people.staff.glexco.id, ['platform_owner'], null);
  let count = 0;

  for (const kit of KITS) {
    // Publicar es idempotente: si el curso YA estaba publicado, la operacion
    // responde 200 y no emite nada -correcto para un panel, inutil aqui-. Para
    // que el evento vuelva a salir hay que pasar por revision y publicar otra
    // vez.
    //
    // Es el problema clasico de una proyeccion nueva frente a datos viejos:
    // `learning` no puede enterarse de un curso que se publico antes de que el
    // servicio existiera. La solucion definitiva es un comando de reconstruccion;
    // este rodeo cubre la demostracion sin inventarse uno a medias.
    const toReview = await api(`/catalog/content/${kit.course.id}/status`, {
      method: 'POST',
      body: { target: 'course', status: 'in_review' },
      as,
    });
    void toReview;

    const result = await api(`/catalog/content/${kit.course.id}/status`, {
      method: 'POST',
      body: { target: 'course', status: 'published' },
      as,
    });
    if (result.status === 200) count += 1;
    else console.log(`  ! publicar ${kit.code}: ${result.status} ${JSON.stringify(result.body).slice(0, 120)}`);
  }

  console.log(`  ${'cursos publicados'.padEnd(18)} ${count}/${KITS.length}`);
}

/**
 * Codigos de activacion del colegio de demostracion.
 *
 * **Deterministas, y en una demostracion eso es correcto.** El codigo real es un
 * secreto con valor economico y se genera al azar; estos existen para que alguien
 * pueda probar el formulario de alta, y si cambiaran en cada siembra la
 * documentacion que los cita quedaria obsoleta al instante. Se derivan del mismo
 * hash que los identificadores, asi que resembrar no duplica ni invalida nada.
 *
 * En produccion de verdad, los codigos los genera `catalog` con entropia real:
 * esta funcion no toca ese camino.
 */
async function seedCodes() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = {};

  for (const kit of KITS) {
    const batchId = idFor('batch', kit.code);
    await admin.query(
      `INSERT INTO catalog.code_batches (id, kit_id, grade, total, reference, created_by, distributed_to)
       VALUES ($1,$2,$3,30,'demostracion',$4,$5) ON CONFLICT (id) DO NOTHING`,
      [batchId, kit.id, kit.grade, '00000000-0000-4000-8000-000000000000', INSTITUTION.id],
    );

    // El lote se escribe a mano -para que los codigos sean deterministas y la
    // documentacion no caduque en cada siembra-, pero su EVENTO hay que
    // encolarlo igual. Sin el, la analitica nunca suma los codigos emitidos y el
    // panel de GLEXCO acaba diciendo "10 de 0 emitidos": cuenta los canjes, que
    // si llegan por evento, contra un total que se quedo en cero.
    //
    // Es el mismo fallo que ya tenian la institucion y los salones, y por eso
    // aquellos se crean por la API. Aqui no se puede, asi que se encola el
    // evento en la outbox del catalogo y el relay lo publica como cualquier
    // otro. Escribir en la outbox es exactamente lo que hace un caso de uso.
    await admin.query(
      `INSERT INTO catalog.outbox
         (event_id, event_name, aggregate_type, aggregate_id, aggregate_version, payload, metadata)
       VALUES ($1,'catalog.activation_code.batch_generated.v1','CodeBatch',$2,1,$3,'{}'::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        idFor('batch-event', kit.code),
        batchId,
        JSON.stringify({
          batchId,
          kitId: kit.id,
          grade: kit.grade,
          total: 30,
          distributedTo: INSTITUTION.id,
          reference: 'demostracion',
          expiresAt: null,
        }),
      ],
    );

    codes[kit.id] = [];
    for (let i = 0; i < 30; i += 1) {
      const seed = createHash('sha256').update(`glexco-demo:code:${kit.code}:${i}`).digest();
      let body = '';
      for (let c = 0; c < 12; c += 1) {
        body += ALPHABET[seed[c] % ALPHABET.length];
      }
      const code = `GLX${body}`;
      // El orden importa: catalogo hashea `pepper:codigo`, no al reves. Con el
      // orden cambiado el codigo no se encuentra y el canje responde
      // "codigo invalido", que es un mensaje correcto para un fallo que no lo es.
      const hash = createHash('sha256').update(`${PEPPER}:${code}`).digest('hex');

      await admin.query(
        `INSERT INTO catalog.activation_codes (id, code_hash, code_suffix, batch_id, kit_id, grade)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [idFor('code', `${kit.code}:${i}`), hash, code.slice(-4), batchId, kit.id, kit.grade],
      );
      codes[kit.id].push(code);
    }
  }

  console.log(`  ${'codigos'.padEnd(18)} 30 por kit (90 en total)`);
  return codes;
}

// ---------------------------------------------------------------------------
// Por la API real: matriculas, canjes, evaluaciones y calificaciones
// ---------------------------------------------------------------------------

/**
 * Token firmado para actuar en nombre de alguien.
 *
 * Se firma en vez de iniciar sesion por HTTP porque el ingreso tiene su propio
 * limite por IP y aqui hacen falta veinte actores distintos en el mismo minuto.
 * El secreto es el mismo que verifican los servicios, asi que el token es
 * indistinguible de uno real: no se esta esquivando ninguna comprobacion de
 * autorizacion, solo el formulario.
 */
function token(userId, roles, institutionId) {
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
    process.env.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: 3600,
      issuer: process.env.JWT_ISSUER ?? 'glexco',
      audience: process.env.JWT_AUDIENCE ?? 'glexco-api',
    },
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Llamada a la API, con espera ante el limite de peticiones.
 *
 * El gateway limita por IP, y esta herramienta hace en un minuto lo que un
 * colegio hace en un trimestre: choca contra el limite por definicion. **No se
 * relaja el limite** -es correcto y protege de un abuso real-; se respeta el
 * `retryAfterSeconds` que el propio backend indica, que es justo para lo que
 * viaja en la respuesta.
 */
async function api(path, { method = 'GET', body, as, attempt = 0 } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(as ? { authorization: `Bearer ${as}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // Un `fetch failed` a secas no dice cual de los nueve servicios no responde,
    // y con nueve procesos adivinar cuesta mas que el propio fallo.
    return {
      status: 0,
      body: { error: `no se pudo contactar con ${API}${path}: ${error?.cause?.code ?? error.message}` },
    };
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (response.status === 429 && attempt < 6) {
    const wait = (parsed?.details?.retryAfterSeconds ?? 5) * 1000;
    await sleep(wait + 500);
    return api(path, { method, body, as, attempt: attempt + 1 });
  }

  return { status: response.status, body: parsed };
}

async function enrollStudents(people) {
  let count = 0;
  for (const student of people.students) {
    const classroom = CLASSROOMS[student.classroom];
    const teacher = Object.values(people.staff).find((s) => s.id === classroom.teacherId);
    const as = token(teacher.id, ['teacher'], INSTITUTION.id);

    const result = await api(`/classrooms/${classroom.id}/enrollments`, {
      method: 'POST',
      body: { studentId: student.id },
      as,
    });
    if (result.status === 201 || result.status === 200) count += 1;
  }
  console.log(`  matriculas       ${count}/${people.students.length}`);
}

async function redeemCodes(people, codes) {
  let count = 0;

  for (const [index, student] of people.students.entries()) {
    const classroom = CLASSROOMS[student.classroom];
    const kit = KITS[classroom.kit];
    const as = token(student.id, ['student'], INSTITUTION.id);

    // El codigo se asigna por POSICION y no sacandolo de una pila: asi el mismo
    // alumno recibe siempre el mismo codigo y resembrar es idempotente -el canje
    // repetido del mismo alumno responde 200 y no gasta nada-. Con una pila, el
    // reparto cambia entre ejecuciones y los codigos de la vuelta anterior
    // quedan quemados por otra persona.
    const pool = codes[kit.id];
    let redeemed = false;
    let lastError = '';

    // Se prueban unos pocos: si el primero quedo quemado por una siembra a
    // medias, el alumno no se queda sin kit por eso.
    for (let attempt = 0; attempt < 3 && !redeemed; attempt += 1) {
      const code = pool[index + attempt * people.students.length];
      if (!code) break;

      const result = await api('/catalog/redeem', { method: 'POST', body: { code }, as });

      // 200 es un canje nuevo; KIT_ALREADY_OWNED significa que el alumno ya
      // tiene ese kit de una siembra anterior. Lo que este sembrador persigue es
      // que TENGA el kit, no que ocurra un canje: tratar el segundo caso como
      // fallo haria que resembrar pareciera roto cuando esta bien.
      if (result.status === 200 || result.body?.code === 'KIT_ALREADY_OWNED') {
        redeemed = true;
        count += 1;
      } else {
        lastError = `${result.status} ${result.body?.code ?? ''}`;
      }
    }

    if (!redeemed) {
      console.log(`  ! ${student.email} se quedo sin kit: ${lastError}`);
    }
  }

  console.log(`  canjes           ${count}/${people.students.length}`);
}

async function seedAssessments(people) {
  const created = [];
  const glexco = token(people.staff.glexco.id, ['platform_owner'], null);

  for (const kit of KITS) {
    const title = `Evaluacion de ${kit.course.title}`;

    // Igual que con los salones: la API no impide dos evaluaciones del mismo
    // titulo -y hace bien, un docente puede querer dos versiones-, asi que sin
    // esta comprobacion cada siembra anadia una copia y el alumno veia cuatro
    // veces la misma evaluacion en "proximas actividades".
    const already = await admin.query(
      'SELECT id FROM assessment.assessments WHERE kit_id = $1 AND title = $2 LIMIT 1',
      [kit.id, title],
    );
    if (already.rows[0]) {
      created.push({ id: already.rows[0].id, kitId: kit.id });
      console.log(`  evaluacion       ${kit.code} (ya existia)`);
      continue;
    }

    const assessment = await api('/assessments', {
      method: 'POST',
      body: {
        kitId: kit.id,
        title,
        description: 'Evaluacion del banco de GLEXCO. Igual para todos los colegios.',
        kind: 'quiz',
        passingScore: 60,
        maxAttempts: 3,
      },
      as: glexco,
    });

    if (assessment.status !== 201) {
      console.log(`  ! evaluacion de ${kit.code}: ${assessment.status} ${JSON.stringify(assessment.body).slice(0, 120)}`);
      continue;
    }

    const id = assessment.body.assessmentId;
    for (const question of QUESTIONS) {
      await api(`/assessments/${id}/questions`, { method: 'POST', body: question, as: glexco });
    }
    await api(`/assessments/${id}/publish`, { method: 'POST', body: {}, as: glexco });

    created.push({ id, kitId: kit.id });
    console.log(`  evaluacion       ${kit.code}`);
  }

  return created;
}

const QUESTIONS = [
  {
    type: 'single_choice',
    prompt: '¿Cual de estas piezas convierte energia electrica en movimiento?',
    options: [{ text: 'El sensor' }, { text: 'El servomotor' }, { text: 'La bateria' }],
    correctOptions: [1],
    points: 10,
    explanation: 'El servomotor transforma la corriente en giro controlado.',
  },
  {
    type: 'single_choice',
    prompt: '¿Que hace un sensor de linea?',
    options: [
      { text: 'Detecta el contraste entre claro y oscuro' },
      { text: 'Mide la temperatura' },
      { text: 'Emite sonido' },
    ],
    correctOptions: [0],
    points: 10,
    explanation: 'Distingue la linea del fondo por la luz que refleja.',
  },
  {
    type: 'multiple_choice',
    prompt: 'Selecciona todo lo que hace falta para que el robot avance.',
    options: [
      { text: 'Una fuente de energia' },
      { text: 'Un motor' },
      { text: 'Una camara' },
      { text: 'Instrucciones programadas' },
    ],
    correctOptions: [0, 1, 3],
    points: 20,
  },
];

async function seedSubmissions(people, assessments) {
  let graded = 0;

  for (const [index, student] of people.students.entries()) {
    const classroom = CLASSROOMS[student.classroom];
    const kit = KITS[classroom.kit];
    const assessment = assessments.find((a) => a.kitId === kit.id);
    if (!assessment) continue;

    const as = token(student.id, ['student'], INSTITUTION.id);

    const attempt = await api(`/assessments/${assessment.id}/attempts`, {
      method: 'POST',
      body: { classroomId: classroom.id },
      as,
    });
    if (attempt.status !== 201 && attempt.status !== 200) {
      console.log(`  ! intento de ${student.email}: ${attempt.status}`);
      continue;
    }

    const submissionId = attempt.body.submissionId;
    const questions = attempt.body.questions ?? [];

    // Nivel repartido a proposito. Sin dispersion, el panel del docente ensena
    // una media y nada mas, y la dispersion es justo lo que distingue un salon
    // que va bien de uno partido en dos.
    const skill = [1, 0.9, 0.7, 0.45, 1, 0.8, 0.6, 0.35, 0.95, 0.75, 0.5, 0.85][index] ?? 0.7;

    for (const [qIndex, question] of questions.entries()) {
      const options = question.options ?? [];
      const correct = qIndex === 0 ? [1] : qIndex === 1 ? [0] : [0, 1, 3];
      const chosen = Math.random() < skill ? correct : [0];

      const selectedOptionIds = chosen
        .map((i) => options[i]?.optionId ?? options[i]?.id)
        .filter(Boolean);

      if (selectedOptionIds.length === 0) continue;

      // Cada respuesta se guarda por separado, que es como funciona de verdad:
      // el alumno responde a lo largo del intento y entrega al final.
      await api(`/assessments/attempts/${submissionId}/answers`, {
        method: 'POST',
        body: { questionId: question.questionId ?? question.id, selectedOptionIds },
        as,
      });
    }

    const submitted = await api(`/assessments/attempts/${submissionId}/submit`, {
      method: 'POST',
      as,
    });
    if (submitted.status === 200) graded += 1;
    else console.log(`  ! entrega de ${student.email}: ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 100)}`);
  }

  console.log(`  entregas         ${graded}/${people.students.length} corregidas`);
}

/**
 * Espera a que `learning` conozca las lecciones.
 *
 * El directorio se alimenta del evento `course.published`, que viaja por la
 * outbox y NATS: cuando la publicacion responde, la proyeccion todavia no
 * existe. Sin esperar aqui, los alumnos intentan completar lecciones que el
 * servicio aun no conoce, la llamada responde 200 con `firstCompletion: false`
 * -no es un error, simplemente no habia nada que completar- y el sembrador
 * termina informando de un progreso que no se guardo en ningun sitio.
 */
async function waitForLessonDirectory(people) {
  const student = people.students[0];
  const lesson = KITS[CLASSROOMS[student.classroom].kit].course.lessons[0];
  const as = token(student.id, ['student'], INSTITUTION.id);

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await api(`/learning/lessons/${lesson.id}/start`, {
      method: 'POST',
      body: { classroomId: CLASSROOMS[student.classroom].id },
      as,
    });
    if (result.status === 200) return true;
    await sleep(1500);
  }

  console.log('  ! learning no proyecto las lecciones en 60 s');
  return false;
}

async function seedProgress(people) {
  if (!(await waitForLessonDirectory(people))) return;

  // Se REPONE el progreso de los alumnos de demostracion en vez de anadirse al
  // que hubiera. Un sembrador tiene que dejar un estado CONOCIDO: sin esto, la
  // segunda ejecucion encuentra las lecciones ya completadas, no completa nada,
  // e informa de cero progreso aunque los datos esten bien -o peor, deja un
  // reparto distinto del que dice haber creado-.
  //
  // Solo se borra lo de las lecciones. El XP de las evaluaciones llega por
  // evento y no se puede volver a emitir, asi que borrarlo lo perderia para
  // siempre.
  const ids = people.students.map((student) => student.id);
  await admin.query('DELETE FROM learning.lesson_progress WHERE student_id = ANY($1::uuid[])', [ids]);
  await admin.query(
    `DELETE FROM learning.xp_awards
      WHERE student_id = ANY($1::uuid[]) AND reason IN ('lesson_completed','course_completed')`,
    [ids],
  );
  await admin.query('DELETE FROM learning.badges WHERE student_id = ANY($1::uuid[])', [ids]);

  let done = 0;
  const problemas = [];

  for (const student of people.students) {
    const classroom = CLASSROOMS[student.classroom];
    const kit = KITS[classroom.kit];
    const as = token(student.id, ['student'], INSTITUTION.id);

    // No todos completan lo mismo: la lista de "quien se descolgo" solo sirve si
    // hay alguien que efectivamente se quedo atras. El reparto es determinista
    // -por posicion- para que resembrar no cambie quien va bien y quien no.
    const index = people.students.indexOf(student);
    const ratio = [1, 0.67, 0.34, 1, 0.67, 0.34, 1, 0.34, 0.67, 1, 0.34, 0.67][index] ?? 0.5;
    const howMany = Math.max(1, Math.round(kit.course.lessons.length * ratio));

    for (const lesson of kit.course.lessons.slice(0, howMany)) {
      const started = await api(`/learning/lessons/${lesson.id}/start`, {
        method: 'POST',
        body: { classroomId: classroom.id },
        as,
      });
      const result = await api(`/learning/lessons/${lesson.id}/complete`, {
        method: 'POST',
        body: { secondsSpent: lesson.minutes * 60 },
        as,
      });
      // Solo cuenta lo que de verdad se completo por primera vez: contar los 200
      // a secas informaria de un progreso que no ocurrio.
      if (result.status === 200 && result.body?.firstCompletion) done += 1;
      else if (problemas.length < 3) {
        problemas.push(
          `${student.email} ${lesson.id.slice(0, 8)}: inicio=${started.status} completar=${result.status} first=${result.body?.firstCompletion}`,
        );
      }
    }
  }
  for (const problema of problemas) console.log(`  ! ${problema}`);
  console.log(`  progreso         ${done} lecciones completadas`);
}

async function seedAnnouncements(people) {
  const mensajes = [
    { title: 'Traigan el kit el viernes', body: 'Vamos a montar el brazo robotico.\nRevisen que no falte ninguna pieza.', pinned: true },
    { title: 'Recordatorio de la evaluacion', body: 'La evaluacion de la unidad cierra el domingo.' },
  ];

  let count = 0;
  for (const [index, classroom] of CLASSROOMS.entries()) {
    const teacher = Object.values(people.staff).find((s) => s.id === classroom.teacherId);
    const as = token(teacher.id, ['teacher'], INSTITUTION.id);

    for (const mensaje of mensajes) {
      // Sin esto, cada siembra anadia dos anuncios mas por salon: la portada del
      // alumno acabo con veinte copias del mismo aviso, que es justo lo que hace
      // que una demo parezca rota.
      const repeated = await admin.query(
        'SELECT id FROM engagement.announcements WHERE classroom_id = $1 AND title = $2 LIMIT 1',
        [classroom.id, mensaje.title],
      );
      if (repeated.rows[0]) continue;

      const result = await api('/announcements', {
        method: 'POST',
        body: { classroomId: classroom.id, ...mensaje },
        as,
      });
      if (result.status === 201) count += 1;
      else if (count === 0) {
        console.log(`  ! anuncio: ${result.status} ${JSON.stringify(result.body).slice(0, 140)}`);
      }
    }
    void index;
  }
  console.log(`  anuncios         ${count}`);
}

function printAccounts(people) {
  console.log('\n============================================================');
  console.log('  CUENTAS DE DEMOSTRACION');
  console.log('============================================================\n');
  console.log(`  Contrasena (todas):  ${PASSWORD}\n`);

  console.log('  GLEXCO (plataforma)');
  console.log(`    ${people.staff.glexco.email}\n`);
  console.log('  Direccion del colegio');
  console.log(`    ${people.staff.director.email}\n`);
  console.log('  Docentes');
  for (const key of ['docente1', 'docente2', 'docente3']) {
    const t = people.staff[key];
    const classroom = CLASSROOMS.find((c) => c.teacherId === t.id);
    console.log(`    ${t.email.padEnd(30)} ${t.first} ${t.last} — ${classroom?.name ?? ''}`);
  }
  console.log('\n  Alumnos');
  for (const student of people.students) {
    const classroom = CLASSROOMS[student.classroom];
    console.log(`    ${student.email.padEnd(30)} ${student.first} ${student.last} — ${classroom.name}`);
  }
  console.log(`\n  Codigo del colegio (formulario de alta):  ${INSTITUTION.code}`);
  console.log('\n============================================================\n');
}

main()
  .then(() => admin.end())
  .catch(async (error) => {
    console.error('\nFallo la siembra:', error.message);
    await admin.end().catch(() => undefined);
    process.exit(1);
  });
