-- ---------------------------------------------------------------------------
-- student_directory — proyeccion de solo lectura con el nombre del alumno
-- ---------------------------------------------------------------------------
-- Gemela de `teacher_directory`, y existe por el mismo motivo: pintar la lista
-- de una clase -o la bandeja de correccion del docente- necesita nombres, y
-- pedirlos a identidad fila a fila serian N llamadas de red por listado.
--
-- La matricula (`enrollments`) sigue siendo la verdad de QUIEN esta en el
-- salon; esta tabla solo pone el nombre encima. Se separan a proposito: el
-- nombre es un dato de presentacion que llega por evento y puede ir unos
-- segundos desactualizado, mientras que la matricula es estado del agregado y
-- tiene que ser exacta. Meter el nombre en `enrollments` habria mezclado las
-- dos cosas y obligado al agregado a cargar con un campo que no usa para
-- ninguna de sus reglas.
CREATE TABLE IF NOT EXISTS student_directory (
  user_id         uuid PRIMARY KEY,
  institution_id  uuid NOT NULL,
  full_name       text NOT NULL,
  email           citext NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Orden alfabetico dentro de un colegio: es como se lista una clase.
CREATE INDEX IF NOT EXISTS student_directory_institution_idx
  ON student_directory (institution_id, full_name);
