-- Certificados de finalizacion.
--
-- Viven en `learning` y no en un servicio propio porque el hecho que los
-- dispara -terminar un curso- ocurre aqui, y un servicio nuevo solo para esto
-- tendria que preguntarnoslo por evento para saber cuando emitir.

CREATE TABLE IF NOT EXISTS certificates (
  id                uuid PRIMARY KEY,

  -- La serie PUBLICA: lo que va impreso, en el QR y en la URL de verificacion.
  -- Es el identificador con el que alguien de fuera nos pregunta por este
  -- documento, asi que se indexa unico y se busca por el.
  serial            text NOT NULL,

  student_id        uuid NOT NULL,
  -- El nombre se CONGELA al emitir. Si se leyera del servicio de identidad al
  -- verificar, un cambio de nombre posterior invalidaria la firma de un
  -- documento que ya esta impreso y en manos de alguien.
  student_name      text NOT NULL,

  course_id         uuid NOT NULL,
  course_title      text NOT NULL,
  kit_id            uuid NOT NULL,
  institution_name  text,

  completion        integer NOT NULL DEFAULT 100 CHECK (completion BETWEEN 0 AND 100),

  -- Firma Ed25519 en base64url, y la huella de la clave con la que se firmo.
  -- Sin la huella, rotar la clave invalidaria en bloque todo lo emitido antes.
  signature         text NOT NULL,
  key_fingerprint   text NOT NULL,

  issued_at         timestamptz NOT NULL DEFAULT now(),
  issued_by         uuid,

  -- Se revoca, no se borra. Un certificado que desaparece deja a quien lo
  -- verifica sin saber si nunca existio o si se anulo, y son cosas distintas:
  -- la primera huele a falsificacion y la segunda es una decision del colegio.
  revoked_at        timestamptz,
  revoked_reason    text,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS certificates_serial_uq ON certificates (serial);

-- UN certificado por alumno y curso. La emision masiva se lanza varias veces
-- -el docente pulsa dos veces, o se reintenta tras un fallo de red-, y sin esto
-- cada pasada crearia una tanda entera de duplicados con series distintas, todos
-- validos y todos del mismo curso.
CREATE UNIQUE INDEX IF NOT EXISTS certificates_student_course_uq
  ON certificates (student_id, course_id)
  WHERE revoked_at IS NULL;

-- "Mis certificados", que es la consulta de la pantalla del alumno.
CREATE INDEX IF NOT EXISTS certificates_student_idx
  ON certificates (student_id, issued_at DESC);

-- ---------------------------------------------------------------------------
-- Nombre del colegio, para imprimirlo en el certificado
-- ---------------------------------------------------------------------------
--
-- `classroom_members` guarda el identificador de la institucion pero no su
-- nombre, y un certificado que dice "colegio 7d3ab3a7-..." no lo ensena nadie.
-- Llega por evento, como los demas directorios de este servicio: preguntarselo
-- a instituciones al emitir ataria los dos servicios justo en la operacion que
-- menos puede fallar.
--
-- El nombre se COPIA al certificado al emitirlo, asi que este directorio solo
-- se consulta una vez por documento. Si el colegio se renombra despues, los
-- certificados ya emitidos siguen diciendo lo que decian el dia que se
-- firmaron, que es lo correcto para un documento.
CREATE TABLE IF NOT EXISTS institution_directory (
  institution_id uuid PRIMARY KEY,
  name           text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
