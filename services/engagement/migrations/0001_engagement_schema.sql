-- Esquema de engagement: correo saliente y anuncios de salon.
--
-- Dos responsabilidades que comparten servicio porque comparten naturaleza: las
-- dos son comunicacion asincrona hacia una persona, y las dos tienen que
-- sobrevivir a que el destinatario no este mirando en ese momento.

-- ---------------------------------------------------------------------------
-- Correo saliente
-- ---------------------------------------------------------------------------
--
-- **El registro guarda que se envio, nunca QUE se envio.** No hay columna con el
-- cuerpo ni con el enlace: un correo de recuperacion contiene un token que da
-- acceso a la cuenta, y guardarlo aqui reintroduciria por la puerta de atras el
-- problema que se evita al no meterlo en el evento. Lo que se guarda es el
-- destinatario, el tipo y el resultado, que es lo que soporte necesita para
-- responder a "no me llega el correo".
CREATE TABLE IF NOT EXISTS email_deliveries (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL,
  -- `email_verification` | `password_reset` | `guardian_notice`
  kind           text NOT NULL,
  recipient      text NOT NULL,
  locale         text NOT NULL DEFAULT 'es',
  status         text NOT NULL DEFAULT 'sent',
  -- Motivo del fallo, para diagnosticar. Nunca el contenido del mensaje.
  failure_reason text,
  provider_ref   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- "¿Le llegó el correo a este usuario?" es la consulta de soporte, y es siempre
-- por usuario y por lo más reciente.
CREATE INDEX IF NOT EXISTS email_deliveries_user_idx
  ON email_deliveries (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_deliveries_failed_idx
  ON email_deliveries (created_at DESC)
  WHERE status = 'failed';

-- ---------------------------------------------------------------------------
-- Anuncios de salon
-- ---------------------------------------------------------------------------
--
-- El cliente decidio **anuncios asincronos, sin WebSockets**: un docente escribe
-- y el alumno lo ve la proxima vez que entra. El modelo es agnostico al
-- transporte —nada aqui presupone HTTP ni polling— para poder anadir tiempo real
-- despues sin tocar el dominio.
CREATE TABLE IF NOT EXISTS announcements (
  id             uuid PRIMARY KEY,
  classroom_id   uuid NOT NULL,
  institution_id uuid NOT NULL,
  author_id      uuid NOT NULL,
  title          text NOT NULL,
  body           text NOT NULL,
  -- Un anuncio fijado encabeza la lista aunque sea antiguo: "traed el kit el
  -- viernes" tiene que seguir arriba el jueves.
  pinned         boolean NOT NULL DEFAULT false,
  published_at   timestamptz NOT NULL DEFAULT now(),
  -- No se borra: se archiva. Un anuncio que desaparece deja al alumno sin poder
  -- comprobar lo que se le pidio, y al docente sin poder demostrar que lo dijo.
  archived_at    timestamptz,
  version        integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- La consulta de cada apertura del portal: los anuncios vigentes de MI salon,
-- fijados primero. El indice parcial deja fuera los archivados, que son la
-- mayoria con el tiempo y no se listan nunca.
CREATE INDEX IF NOT EXISTS announcements_classroom_idx
  ON announcements (classroom_id, pinned DESC, published_at DESC)
  WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- Directorio de salones
-- ---------------------------------------------------------------------------
--
-- Gemelo de `assessment.classroom_directory`, y por la misma razon: sin el, cada
-- publicacion de un anuncio tendria que llamar a instituciones para comprobar
-- que el docente es el de ese salon, y esa llamada ocurre en mitad de una clase.
-- Llega por evento y puede ir unos segundos desatrasada, lo cual es aceptable
-- para decidir quien escribe un anuncio.
CREATE TABLE IF NOT EXISTS classroom_directory (
  classroom_id   uuid PRIMARY KEY,
  institution_id uuid NOT NULL,
  teacher_id     uuid NOT NULL,
  name           text NOT NULL DEFAULT '',
  grade          text,
  archived       boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS classroom_directory_teacher_idx
  ON classroom_directory (teacher_id);

-- ---------------------------------------------------------------------------
-- Matriculas
-- ---------------------------------------------------------------------------
--
-- Que alumnos hay en cada salon, para responder "mis anuncios" sin preguntarle a
-- instituciones en cada carga del portal.
CREATE TABLE IF NOT EXISTS classroom_members (
  classroom_id uuid NOT NULL,
  student_id   uuid NOT NULL,
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS classroom_members_student_idx
  ON classroom_members (student_id)
  WHERE active;
