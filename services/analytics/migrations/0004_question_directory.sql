-- Directorio de preguntas: el enunciado, para poder nombrarlas.
--
-- "Lo que mas falla tu salon" es el dato mas accionable que tiene un docente:
-- no le dice "tu clase va mal", le dice que volver a explicar el lunes. Pero
-- listaba "Pregunta 1, Pregunta 2, Pregunta 3", que no le dice que repasar a
-- nadie, y la pantalla dejaba de servir para lo unico que existe.
--
-- El enunciado entra por evento (`assessment.assessment.published.v1`) y NO
-- consultando el schema de evaluacion: es el invariante que sostiene este
-- servicio -un dashboard nunca consulta el schema de otro- y ademas el rol de
-- base de datos de analitica no tiene permiso sobre ese schema.
--
-- **Solo el enunciado.** Ni opciones, ni respuesta correcta, ni explicacion: la
-- clave de correccion no sale del servicio de evaluacion. El enunciado no es
-- secreto -el alumno lo lee al responder-, lo que lo acompana si.
--
-- Archivo NUEVO y no un anadido a 0003: el ejecutor marca las migraciones por
-- nombre de archivo, asi que lo que se agrega a una que ya corrio no se ejecuta
-- nunca, y no avisa.

SET search_path TO analytics, public;

CREATE TABLE IF NOT EXISTS question_directory (
  question_id   uuid PRIMARY KEY,
  assessment_id uuid NOT NULL,

  prompt        text NOT NULL,

  -- Su numero dentro de la evaluacion. Es el respaldo cuando el enunciado
  -- todavia no ha llegado: "Pregunta 3" es peor que el enunciado y mucho mejor
  -- que un UUID.
  position      integer NOT NULL DEFAULT 0,

  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Se consulta siempre por evaluacion, al cruzarlo con los fallos por pregunta.
CREATE INDEX IF NOT EXISTS question_directory_by_assessment
  ON question_directory (assessment_id);
