-- Directorio de instituciones para el panel de GLEXCO.
--
-- El panel de plataforma listaba las instituciones por su UUID, que no le dice
-- nada a nadie: una tabla de treinta filas de identificadores no es un informe.
--
-- El nombre llega por EVENTO y no consultando el schema de instituciones. Es la
-- misma regla que sostiene todo este servicio: la analitica es una proyeccion,
-- no un informe que hace JOIN sobre las tablas de los demas. Un JOIN cruzado
-- ataria el esquema de instituciones a que nadie lo cambie sin romper el panel,
-- y ademas el rol `glexco_analytics` no tiene permiso sobre ese schema, asi que
-- hacerlo exigiria debilitar el aislamiento entre servicios.
--
-- Es gemelo de `assessment.classroom_directory` y de `institutions.student_directory`.
-- Como aquellos, puede ir unos segundos desatrasado: un colegio recien creado
-- aparece sin nombre durante ese rato, que es preferible a no aparecer.

CREATE TABLE IF NOT EXISTS institution_directory (
  institution_id   uuid PRIMARY KEY,
  code             text NOT NULL,
  name             text NOT NULL,
  short_name       text NOT NULL,
  city             text NOT NULL DEFAULT '',
  -- `suspended` no borra la fila: el historico academico del colegio sigue
  -- existiendo y el panel tiene que poder explicar de quien es.
  status           text NOT NULL DEFAULT 'active',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- El panel ordena por nombre. Sin esto es un `sort` en memoria sobre toda la
-- cartera de clientes cada vez que alguien de GLEXCO abre su pantalla.
CREATE INDEX IF NOT EXISTS institution_directory_name_idx
  ON institution_directory (name);
