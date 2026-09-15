-- Actividades que se hacen EN GRUPO.
--
-- Archivo nuevo y no un anadido al 0001: el ejecutor marca las migraciones por
-- nombre de archivo, asi que lo que se agrega a una que ya corrio no se ejecuta
-- nunca -y no avisa: el despliegue dice que fue bien y el fallo aparece mas
-- tarde como "column ... does not exist"-.

-- El rango admitido, en la actividad. NULL en las dos = individual, que es lo
-- que ya son todas las filas existentes.
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS group_min_size integer,
  ADD COLUMN IF NOT EXISTS group_max_size integer;

-- Las dos van juntas o no va ninguna: una actividad con minimo y sin maximo no
-- la puede cumplir nadie, y el alumno solo se entera al intentar empezar.
ALTER TABLE assessments
  DROP CONSTRAINT IF EXISTS assessments_group_size_pair;
ALTER TABLE assessments
  ADD CONSTRAINT assessments_group_size_pair CHECK (
    (group_min_size IS NULL AND group_max_size IS NULL)
    OR (
      group_min_size IS NOT NULL AND group_max_size IS NOT NULL
      AND group_min_size >= 2
      AND group_max_size >= group_min_size
      AND group_max_size <= 10
    )
  );

-- Los integrantes de cada entrega de grupo.
--
-- Tabla y no un `jsonb` dentro de `submissions` por una sola razon, que es toda
-- la razon: el indice unico de abajo. Un alumno metido en dos grupos de la misma
-- actividad no se puede impedir comprobando antes de insertar -dos grupos que
-- pulsan a la vez pasan los dos la comprobacion y los dos escriben-, se impide
-- haciendo que la base rechace al segundo. Es la misma garantia que sostiene el
-- canje de un codigo de libro.
CREATE TABLE IF NOT EXISTS submission_members (
  submission_id   uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  assessment_id   uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL,

  -- Se guarda aunque se pueda deducir de la entrega: forma parte de la clave
  -- unica, y un JOIN para comprobar unicidad no es una restriccion.
  attempt_number  integer NOT NULL CHECK (attempt_number > 0),

  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (submission_id, student_id),

  -- **Un alumno, un grupo por actividad e intento.**
  --
  -- Lleva el numero de intento porque los grupos se rehacen al reintentar: con
  -- solo (actividad, alumno) el segundo intento de la clase entera chocaria
  -- contra el primero y nadie podria repetir la actividad.
  CONSTRAINT submission_members_one_group_per_attempt
    UNIQUE (assessment_id, student_id, attempt_number)
);

-- Para pintar la lista de companeros disponibles hay que preguntar "quien de
-- esta actividad ya esta cogido", que es exactamente este indice.
CREATE INDEX IF NOT EXISTS submission_members_by_assessment
  ON submission_members (assessment_id, attempt_number);

-- Y para el camino contrario: "de que entregas forma parte este alumno", que es
-- como el portal encuentra el trabajo de grupo que hizo un companero suyo.
CREATE INDEX IF NOT EXISTS submission_members_by_student
  ON submission_members (student_id);
