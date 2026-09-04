-- Directorio de kits.
--
-- La pantalla de plataforma lista "kits con peor resultado" para que el equipo
-- de contenidos sepa que material hay que rehacer: si un kit va mal en TODOS
-- los colegios, el problema es del contenido y no de la clase. Esa pantalla
-- listaba los kits por UUID -"a3f1e2c8… · 40 alumnos"-, que no le dice nada a
-- nadie y hace la pantalla inservible para lo unico que existe.
--
-- El nombre entra por evento (`catalog.kit.published.v1`) y NO consultando el
-- schema del catalogo: es la regla que sostiene este servicio entero, y ademas
-- el rol de base de datos de analitica no tiene permiso sobre ese schema.
--
-- Va en un archivo NUEVO y no anadido a 0001. El ejecutor marca las migraciones
-- por nombre de archivo, asi que lo que se anade a una que ya corrio no se
-- ejecuta nunca -y no avisa-.

SET search_path TO analytics, public;

CREATE TABLE IF NOT EXISTS kit_directory (
  kit_id     uuid PRIMARY KEY,
  code       text NOT NULL DEFAULT '',
  name       text NOT NULL,

  -- Ordenan y agrupan la tabla de la pantalla. Viajan en el mismo evento porque
  -- pedirlos despues seria una llamada al catalogo por fila.
  program    text NOT NULL DEFAULT '',
  grade      text NOT NULL DEFAULT '',

  updated_at timestamptz NOT NULL DEFAULT now()
);

-- La pantalla agrupa por programa y ordena por grado dentro de cada uno.
CREATE INDEX IF NOT EXISTS kit_directory_program_idx ON kit_directory (program, grade);
