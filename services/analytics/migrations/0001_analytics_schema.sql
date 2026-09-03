-- Servicio de analitica — esquema inicial.
--
-- Este schema NO es una fuente de verdad: es una PROYECCION DE LECTURA. Todo lo
-- que hay aqui se puede reconstruir reprocesando los eventos de los otros
-- servicios, y esa es exactamente la propiedad que lo hace seguro de tocar.
--
-- Por que proyecciones y no consultas en vivo:
--
-- 1. Un dashboard que consultara los schemas de evaluacion, catalogo e
--    instituciones a la vez rompe el aislamiento entre bounded contexts: el
--    JOIN cruzado ata los tres servicios y ninguno puede cambiar su esquema sin
--    romper los informes.
-- 2. Con la escala objetivo (~8M registrados) una agregacion en vivo sobre
--    millones de entregas no responde en el tiempo de una peticion web. El
--    panel del director tiene que abrir en menos de un segundo o no se usa.
-- 3. Los numeros de un dashboard pueden ir unos segundos por detras de la
--    verdad sin consecuencia alguna. Ninguna decision de negocio los consulta:
--    se MIRAN. Eso es lo que autoriza la proyeccion.

SET search_path TO analytics, public;

-- ---------------------------------------------------------------------------
-- student_assessment_facts
-- ---------------------------------------------------------------------------
-- Una fila por (alumno, evaluacion): su MEJOR intento. No se guardan todos los
-- intentos porque ningun dashboard pregunta por el segundo intento de nadie; lo
-- que se mide es lo que el alumno acabo demostrando.
--
-- La tabla es deliberadamente ancha y desnormalizada: `origin`, `kit_id`,
-- `institution_id` y `classroom_id` se copian aunque se pudieran deducir. Un
-- dashboard filtra siempre por esas cuatro columnas a la vez, y resolverlas con
-- JOIN en cada consulta anularia el motivo de tener proyecciones.
CREATE TABLE IF NOT EXISTS student_assessment_facts (
  student_id       uuid NOT NULL,
  assessment_id    uuid NOT NULL,

  institution_id   uuid,
  classroom_id     uuid,
  kit_id           uuid NOT NULL,

  -- 'glexco' o 'institution'. Es la columna que decide si un dato es
  -- COMPARABLE entre colegios: solo lo son las evaluaciones de GLEXCO, porque
  -- las del docente puede hacerlas mas faciles y subir su media.
  origin           text NOT NULL CHECK (origin IN ('glexco', 'institution')),
  kind             text NOT NULL,

  best_score       integer NOT NULL,
  max_score        integer NOT NULL,
  -- Se guarda calculado para no repetir la division en cada consulta ni
  -- arriesgarse a dividir por cero en veinte sitios distintos.
  best_percentage  numeric(5,2) NOT NULL,
  passed           boolean NOT NULL,

  -- El PRIMER porcentaje, que es lo que permite medir progreso. Sin el, solo se
  -- puede medir nota, y nota no es aprendizaje: un alumno que empieza en 8 y
  -- acaba en 8 no aprendio nada, y uno que sube de 3 a 6 aprendio mucho.
  first_percentage numeric(5,2) NOT NULL,
  attempts         integer NOT NULL DEFAULT 1 CHECK (attempts > 0),

  first_graded_at  timestamptz NOT NULL,
  last_graded_at   timestamptz NOT NULL,

  PRIMARY KEY (student_id, assessment_id)
);

-- Dashboard del alumno.
CREATE INDEX IF NOT EXISTS facts_student_idx
  ON student_assessment_facts (student_id, last_graded_at DESC);

-- Dashboard del salon y del docente. Es la consulta mas frecuente del panel.
CREATE INDEX IF NOT EXISTS facts_classroom_idx
  ON student_assessment_facts (classroom_id, origin, assessment_id)
  WHERE classroom_id IS NOT NULL;

-- Dashboard de institucion y de GLEXCO por institucion.
CREATE INDEX IF NOT EXISTS facts_institution_idx
  ON student_assessment_facts (institution_id, origin, kit_id)
  WHERE institution_id IS NOT NULL;

-- Señal para el equipo academico: que kits van mal en TODAS partes. Parcial
-- sobre las de GLEXCO porque son las unicas comparables entre colegios.
CREATE INDEX IF NOT EXISTS facts_kit_glexco_idx
  ON student_assessment_facts (kit_id, best_percentage)
  WHERE origin = 'glexco';

-- ---------------------------------------------------------------------------
-- question_miss_facts
-- ---------------------------------------------------------------------------
-- Cuantas veces se falla cada pregunta, por salon. Es el dato mas accionable
-- que existe para un docente: no le dice "el salon va mal", le dice QUE volver
-- a explicar.
--
-- Se agrega por contador en vez de guardar cada respuesta: lo que se pregunta
-- es "cuantos fallaron la pregunta 4", nunca "que marco Juan en la 4" -eso lo
-- responde el servicio de evaluacion, que es su dueno-.
CREATE TABLE IF NOT EXISTS question_miss_facts (
  assessment_id  uuid NOT NULL,
  question_id    uuid NOT NULL,
  classroom_id   uuid NOT NULL,

  answered       integer NOT NULL DEFAULT 0 CHECK (answered >= 0),
  missed         integer NOT NULL DEFAULT 0 CHECK (missed >= 0),

  updated_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (assessment_id, question_id, classroom_id),
  CONSTRAINT missed_within_answered CHECK (missed <= answered)
);

CREATE INDEX IF NOT EXISTS question_miss_classroom_idx
  ON question_miss_facts (classroom_id, assessment_id);

-- ---------------------------------------------------------------------------
-- classroom_rollups
-- ---------------------------------------------------------------------------
-- Resumen por salon, recalculado al llegar cada entrega corregida.
--
-- Se materializa en vez de calcularse al abrir el panel porque el panel del
-- director agrega TODOS sus salones: sin esto, abrir esa pantalla dispararia una
-- agregacion sobre todas las entregas del colegio.
CREATE TABLE IF NOT EXISTS classroom_rollups (
  classroom_id      uuid PRIMARY KEY,
  institution_id    uuid NOT NULL,
  teacher_id        uuid,
  grade             text,

  students_measured integer NOT NULL DEFAULT 0,
  assessments_taken integer NOT NULL DEFAULT 0,

  -- Media de la MEJOR nota, solo con evaluaciones de GLEXCO.
  avg_percentage    numeric(5,2),
  -- Desviacion tipica. Una media de 70 con todos en 70 y una media de 70 con la
  -- mitad en 100 y la mitad en 40 son dos clases distintas y piden dos cosas
  -- distintas; sin la dispersion, el dashboard las presenta como iguales.
  stddev_percentage numeric(5,2),

  -- Progreso medio: mejor menos primera. Es la metrica del dashboard de eficacia
  -- docente, y la unica que no premia haber recibido al grupo avanzado.
  avg_gain          numeric(5,2),

  pass_rate         numeric(5,2),
  last_activity_at  timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rollups_institution_idx
  ON classroom_rollups (institution_id, grade);

CREATE INDEX IF NOT EXISTS rollups_teacher_idx
  ON classroom_rollups (teacher_id)
  WHERE teacher_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- institution_rollups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institution_rollups (
  institution_id    uuid PRIMARY KEY,

  classrooms        integer NOT NULL DEFAULT 0,
  students_measured integer NOT NULL DEFAULT 0,

  avg_percentage    numeric(5,2),
  avg_gain          numeric(5,2),
  pass_rate         numeric(5,2),

  -- Metrica comercial: libros comprados que nadie activo son dinero que el
  -- colegio pago y no usa, y la señal mas temprana de que no va a renovar.
  codes_issued      integer NOT NULL DEFAULT 0,
  codes_redeemed    integer NOT NULL DEFAULT 0,

  last_activity_at  timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Reconstruccion
-- ---------------------------------------------------------------------------
-- Marca de hasta donde se ha proyectado. Permite reconstruir desde cero
-- reproduciendo el stream, que es lo que convierte un error de calculo en un
-- reproceso y no en una perdida de datos.
CREATE TABLE IF NOT EXISTS projection_state (
  projection   text PRIMARY KEY,
  last_event_at timestamptz,
  events_applied bigint NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
