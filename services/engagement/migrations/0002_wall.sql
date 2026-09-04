-- El muro del salon.
--
-- El cliente aclaro que la "mensajeria" que pedia NO son mensajes privados: es
-- un tablon del salon donde el alumno tambien puede preguntar y lo ven todos,
-- para que las dudas de uno sirvan al resto.
--
-- Eso es una decision de producto excelente y ademas la mas segura: **no se abre
-- ningun canal privado entre un adulto y un menor**. Todo lo que se escribe aqui
-- lo ve el salon entero, incluido su docente, que es la mejor moderacion que
-- existe y no cuesta nada mantener.
--
-- Se construye sobre `announcements` en vez de una tabla nueva porque es lo
-- mismo con distinto autor: un texto publicado en un salon, ordenado por fecha,
-- que se archiva y no se borra. Separarlas obligaria a consultar dos tablas y
-- fusionarlas en memoria para pintar una sola lista.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'announcement';

-- El vocabulario se copia del dominio, no se inventa aqui. Una restriccion que
-- acepta valores que el codigo no conoce compila y revienta con un 500 al
-- insertar, que es el fallo que ya se cometio con `assessment.kind`.
ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_kind_check;
ALTER TABLE announcements
  ADD CONSTRAINT announcements_kind_check CHECK (kind IN ('announcement', 'question'));

-- ---------------------------------------------------------------------------
-- Respuestas
-- ---------------------------------------------------------------------------
--
-- En su propia tabla y no en un JSONB dentro del anuncio, al reves que las
-- preguntas de una evaluacion. La diferencia es como se escriben: las preguntas
-- de un cuestionario se guardan de golpe y no cambian; una respuesta la anade
-- una persona distinta en un momento distinto, y meterlas en un JSONB obligaria
-- a leer y reescribir el bloque entero cada vez -y a perder respuestas cuando
-- dos alumnos contestan a la vez-.
CREATE TABLE IF NOT EXISTS announcement_replies (
  id              uuid PRIMARY KEY,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Se archiva, no se borra: el docente retira una respuesta fuera de lugar sin
  -- que desaparezca el hilo de la conversacion, que es lo que deja al resto sin
  -- entender de que se hablaba.
  archived_at     timestamptz
);

-- La consulta de cada apertura del muro: las respuestas de un hilo, en orden.
CREATE INDEX IF NOT EXISTS announcement_replies_thread_idx
  ON announcement_replies (announcement_id, created_at)
  WHERE archived_at IS NULL;
