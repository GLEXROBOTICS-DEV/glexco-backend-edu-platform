-- ---------------------------------------------------------------------------
-- classroom_directory — quien manda en cada salon
-- ---------------------------------------------------------------------------
-- La bandeja de correccion pregunta "las entregas pendientes de MI salon", y
-- para responder hay que saber de quien es el salon. Ese dato es de
-- instituciones, y hay dos formas de conseguirlo:
--
--   1. Llamar a instituciones en cada peticion. Descartado: la bandeja se abre
--      constantemente durante una clase, y ataria la correccion a que el otro
--      servicio este arriba.
--   2. Copiarlo por evento. Es lo que se hace aqui, igual que la analitica.
--
-- La contrapartida asumida: un salon creado hace medio segundo puede no estar
-- todavia. Para una comprobacion de ambito eso significa un 404 momentaneo en
-- un salon que aun no tiene ninguna entrega que corregir.
CREATE TABLE IF NOT EXISTS classroom_directory (
  classroom_id    uuid PRIMARY KEY,
  institution_id  uuid NOT NULL,
  teacher_id      uuid,
  grade           text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- "Que salones tiene este docente" y "que salones tiene este colegio": las dos
-- preguntas que hace la comprobacion de ambito.
CREATE INDEX IF NOT EXISTS classroom_directory_teacher_idx
  ON classroom_directory (teacher_id);
CREATE INDEX IF NOT EXISTS classroom_directory_institution_idx
  ON classroom_directory (institution_id);
