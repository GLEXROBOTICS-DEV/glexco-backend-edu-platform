-- Servicio de evaluacion — esquema inicial.
--
-- Cuestionarios, tareas y examenes, y lo que los alumnos responden.
--
-- La distincion que gobierna todo el schema es el ORIGEN: una evaluacion la
-- produce GLEXCO -y entonces es la misma para todos los colegios, igual que los
-- tutoriales- o la crea un docente para su salon. De ahi salen casi todas las
-- restricciones de aqui.

SET search_path TO assessment, public;

CREATE TABLE IF NOT EXISTS assessments (
  id                 uuid PRIMARY KEY,

  -- Kit al que pertenece. Sin clave foranea al catalogo: cruzar schemas ataria
  -- los dos servicios para siempre.
  kit_id             uuid NOT NULL,
  course_id          uuid,

  origin             text NOT NULL CHECK (origin IN ('glexco', 'institution')),

  -- NULL en las de GLEXCO: son de todos. Obligatorio en las de institucion.
  institution_id     uuid,
  -- NULL = disponible para todos los salones de esa institucion.
  classroom_id       uuid,

  author_id          uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('quiz', 'task', 'exam')),

  title              text NOT NULL,
  description        text NOT NULL DEFAULT '',

  -- Las preguntas van en JSONB y no en tabla aparte a proposito. Se leen y se
  -- escriben SIEMPRE como un bloque -nadie pide "la pregunta 3 de tal examen"
  -- sin el resto-, son pocas por evaluacion, y en tabla aparte cada carga de un
  -- cuestionario seria un JOIN con ordenacion. La contrapartida asumida es que
  -- no se pueden consultar preguntas sueltas por SQL, que no hace falta.
  --
  -- Aqui vive la CLAVE DE CORRECCION. Nunca sale hacia un alumno: el agregado
  -- la filtra en `forStudent()`.
  questions          jsonb NOT NULL DEFAULT '[]'::jsonb,

  passing_score      integer NOT NULL DEFAULT 60 CHECK (passing_score BETWEEN 0 AND 100),
  max_attempts       integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  time_limit_minutes integer CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  due_at             timestamptz,

  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'in_review', 'published', 'archived')),

  -- Cuantas entregas hay. Decide si el cuestionario todavia puede cambiar:
  -- cambiar preguntas con notas ya puestas las invalidaria en silencio.
  submission_count   integer NOT NULL DEFAULT 0 CHECK (submission_count >= 0),

  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Los dos estados imposibles del origen. Una evaluacion de institucion sin
  -- institucion no tiene dueno; una de GLEXCO con institucion deja de ser comun
  -- a todos y nadie sabria despues cual de las dos cosas es.
  CONSTRAINT origin_scope_consistent CHECK (
    (origin = 'glexco' AND institution_id IS NULL AND classroom_id IS NULL)
    OR (origin = 'institution' AND institution_id IS NOT NULL)
  )
);

-- Lo que pide el portal del alumno: "que evaluaciones publicadas tengo de este
-- kit". Parcial sobre publicadas porque los borradores no se le muestran nunca.
CREATE INDEX IF NOT EXISTS assessments_kit_published_idx
  ON assessments (kit_id, kind)
  WHERE status = 'published';

-- Panel del docente: las de su salon y las generales de su institucion.
CREATE INDEX IF NOT EXISTS assessments_institution_idx
  ON assessments (institution_id, classroom_id, created_at DESC)
  WHERE institution_id IS NOT NULL;

-- Banco de GLEXCO: lo que viene con cada kit.
CREATE INDEX IF NOT EXISTS assessments_glexco_bank_idx
  ON assessments (kit_id, status)
  WHERE origin = 'glexco';

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id              uuid PRIMARY KEY,
  assessment_id   uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,

  student_id      uuid NOT NULL,
  classroom_id    uuid,

  attempt_number  integer NOT NULL CHECK (attempt_number > 0),

  -- Las respuestas, igual que las preguntas: se leen y escriben como un bloque.
  answers         jsonb NOT NULL DEFAULT '[]'::jsonb,

  status          text NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'submitted', 'graded')),

  score           integer,
  max_score       integer NOT NULL DEFAULT 0,
  passed          boolean,

  -- NULL cuando la corrigio entera la maquina.
  graded_by       uuid,
  feedback        text,

  started_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  graded_at       timestamptz,

  version         integer NOT NULL DEFAULT 0,

  -- Un alumno, un intento por numero. Es lo que impide que dos peticiones
  -- simultaneas creen dos intentos "primero" y se salten el tope: la unicidad
  -- la garantiza el motor, no solo el codigo.
  CONSTRAINT submissions_attempt_uq UNIQUE (assessment_id, student_id, attempt_number),

  -- Estados imposibles que despues son muy caros de diagnosticar.
  CONSTRAINT submitted_has_date CHECK (
    status = 'in_progress' OR submitted_at IS NOT NULL
  ),
  CONSTRAINT graded_has_score CHECK (
    status <> 'graded' OR (score IS NOT NULL AND passed IS NOT NULL AND graded_at IS NOT NULL)
  )
);

-- "Mis intentos de esta evaluacion", que es lo que consulta el alumno al abrir.
CREATE INDEX IF NOT EXISTS submissions_student_idx
  ON submissions (student_id, assessment_id, attempt_number DESC);

-- Bandeja del docente: lo que le queda por corregir de su salon. Parcial porque
-- lo ya corregido no vuelve a esa bandeja y seria peso muerto en el indice.
CREATE INDEX IF NOT EXISTS submissions_pending_idx
  ON submissions (classroom_id, submitted_at)
  WHERE status = 'submitted';

-- Notas de un salon, para el panel y la exportacion.
CREATE INDEX IF NOT EXISTS submissions_classroom_graded_idx
  ON submissions (classroom_id, assessment_id)
  WHERE status = 'graded';

-- ---------------------------------------------------------------------------
-- Mantenimiento de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assessment.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_touch_updated_at ON assessments;
CREATE TRIGGER assessments_touch_updated_at
  BEFORE UPDATE ON assessments
  FOR EACH ROW EXECUTE FUNCTION assessment.touch_updated_at();
