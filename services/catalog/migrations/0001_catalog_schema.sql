-- Servicio de catalogo — esquema inicial.
--
-- Kits, codigos de activacion, derechos de acceso y contenido academico.
-- Es el schema con mas lecturas de la plataforma (todo alumno consulta su
-- contenido en cada sesion) y el unico que guarda un secreto con valor
-- economico: los codigos de los libros.

SET search_path TO catalog, public;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- kits
-- ---------------------------------------------------------------------------
-- Un kit es un libro de un grado. Es la unidad que se compra y la que decide
-- que contenido ve un alumno.
CREATE TABLE IF NOT EXISTS kits (
  id               uuid PRIMARY KEY,
  code             citext NOT NULL,
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  program          text NOT NULL CHECK (program IN ('discover','academy')),
  grade            text NOT NULL,
  robot_platforms  text[] NOT NULL DEFAULT '{}',
  cover_image_key  text,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','in_review','published','archived')),
  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS kits_code_uq ON kits (code);

-- Catalogo publico: solo lo publicado, agrupado por programa y grado.
CREATE INDEX IF NOT EXISTS kits_published_idx
  ON kits (program, grade)
  WHERE status = 'published';

-- ---------------------------------------------------------------------------
-- code_batches
-- ---------------------------------------------------------------------------
-- Un lote es una tirada de imprenta. Se conserva aunque sus codigos se agoten:
-- es la trazabilidad entre lo que se imprimio y lo que se activo.
CREATE TABLE IF NOT EXISTS code_batches (
  id              uuid PRIMARY KEY,
  kit_id          uuid NOT NULL REFERENCES kits(id),
  grade           text NOT NULL,
  total           integer NOT NULL CHECK (total > 0),
  distributed_to  uuid,
  reference       text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS code_batches_kit_idx ON code_batches (kit_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- activation_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activation_codes (
  id           uuid PRIMARY KEY,

  -- SOLO el hash. El codigo en claro existe una vez, cuando se genera el lote
  -- para la imprenta, y nunca se guarda: un volcado de esta tabla no debe
  -- convertirse en miles de accesos vendibles.
  code_hash    text NOT NULL,

  -- Ultimos cuatro caracteres. Permite que soporte identifique un codigo con el
  -- cliente al telefono sin poder reconstruirlo.
  code_suffix  text NOT NULL CHECK (char_length(code_suffix) = 4),

  batch_id     uuid NOT NULL REFERENCES code_batches(id),
  kit_id       uuid NOT NULL REFERENCES kits(id),
  grade        text NOT NULL,

  status       text NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued','distributed','redeemed','revoked','expired')),

  redeemed_by  uuid,
  redeemed_at  timestamptz,
  distributed_to uuid,
  expires_at   timestamptz,
  revoked_reason text,

  version      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Un codigo canjeado tiene alumno y fecha; uno sin canjear, ninguno de los
  -- dos. La restriccion impide estados imposibles que despues son muy caros de
  -- diagnosticar.
  CONSTRAINT redeemed_fields_consistent CHECK (
    (status = 'redeemed' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)
    OR (status <> 'redeemed' AND redeemed_by IS NULL AND redeemed_at IS NULL)
  )
);

-- El indice del canje. Es la busqueda mas sensible del sistema y va por hash:
-- unico, para que dos codigos no puedan colisionar ni siquiera por error de
-- generacion.
CREATE UNIQUE INDEX IF NOT EXISTS activation_codes_hash_uq ON activation_codes (code_hash);

-- Un alumno canjea un codigo por kit. Indice PARCIAL sobre los canjeados: los
-- millones sin canjear no aportan nada a esta consulta.
CREATE INDEX IF NOT EXISTS activation_codes_redeemed_idx
  ON activation_codes (redeemed_by, kit_id)
  WHERE status = 'redeemed';

-- Panel de lotes: cuantos quedan por canjear de cada tirada.
CREATE INDEX IF NOT EXISTS activation_codes_batch_idx ON activation_codes (batch_id, status);

-- Tarea de caducidad. Parcial: solo interesan los que aun pueden caducar.
CREATE INDEX IF NOT EXISTS activation_codes_expiring_idx
  ON activation_codes (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('issued','distributed');

-- ---------------------------------------------------------------------------
-- entitlements
-- ---------------------------------------------------------------------------
-- Derecho de acceso de un alumno al contenido de un kit. Es la tabla que
-- responde a la regla central del negocio, y se consulta en cada peticion de
-- contenido: su indice tiene que ser exacto.
CREATE TABLE IF NOT EXISTS entitlements (
  id                        uuid PRIMARY KEY,
  student_id                uuid NOT NULL,
  kit_id                    uuid NOT NULL REFERENCES kits(id),
  grade                     text NOT NULL,
  institution_id            uuid,
  source_activation_code_id uuid NOT NULL REFERENCES activation_codes(id),
  active                    boolean NOT NULL DEFAULT true,
  revoked_reason            text,
  granted_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at                timestamptz,
  version                   integer NOT NULL DEFAULT 0
);

-- Un alumno no puede tener dos derechos ACTIVOS sobre el mismo kit. Parcial
-- sobre `active` para que un derecho revocado no impida concederlo de nuevo
-- (por ejemplo, tras resolverse una anulacion por error).
CREATE UNIQUE INDEX IF NOT EXISTS entitlements_student_kit_uq
  ON entitlements (student_id, kit_id)
  WHERE active;

-- "¿Que kits puede ver este alumno?" — la consulta de cada inicio de sesion.
CREATE INDEX IF NOT EXISTS entitlements_student_idx
  ON entitlements (student_id)
  WHERE active;

-- Para revertir un canje anulado.
CREATE INDEX IF NOT EXISTS entitlements_source_code_idx
  ON entitlements (source_activation_code_id);

-- ---------------------------------------------------------------------------
-- Contenido academico
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id                uuid PRIMARY KEY,
  kit_id            uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  robot_platform    text NOT NULL,
  order_index       integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','in_review','published','archived')),
  estimated_minutes integer NOT NULL DEFAULT 0,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS courses_kit_idx ON courses (kit_id, order_index);

CREATE TABLE IF NOT EXISTS modules (
  id           uuid PRIMARY KEY,
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  order_index  integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS modules_course_idx ON modules (course_id, order_index);

CREATE TABLE IF NOT EXISTS lessons (
  id                uuid PRIMARY KEY,
  course_id         uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id         uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text NOT NULL DEFAULT '',
  order_index       integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','in_review','published','archived')),
  estimated_minutes integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons (course_id, order_index);

-- ---------------------------------------------------------------------------
-- content_assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_assets (
  id               uuid PRIMARY KEY,

  -- El kit se DUPLICA aqui aunque se pueda deducir por la leccion. Es
  -- denormalizacion deliberada: la autorizacion de acceso pregunta "¿este
  -- alumno tiene derecho a este recurso?" en cada descarga, y resolverlo con un
  -- JOIN de tres tablas en la ruta mas caliente no compensa. Se mantiene
  -- coherente al guardar, no por trigger.
  kit_id           uuid NOT NULL REFERENCES kits(id) ON DELETE CASCADE,

  lesson_id        uuid REFERENCES lessons(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  type             text NOT NULL,

  -- Estrategia hibrida acordada: video largo en proveedor externo con
  -- restriccion de dominio, documentos en bucket propio con URL prefirmada.
  storage_kind     text NOT NULL
                     CHECK (storage_kind IN ('object_storage','video_provider','external_link')),
  storage_ref      text NOT NULL,
  bucket           text,

  size_bytes       bigint,
  duration_seconds integer,
  locale           text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','in_review','published','archived')),
  order_index      integer NOT NULL DEFAULT 0,
  downloadable     boolean NOT NULL DEFAULT false,

  version          integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Un recurso en bucket necesita bucket; uno de proveedor o enlace, no.
  CONSTRAINT bucket_required_for_object_storage CHECK (
    storage_kind <> 'object_storage' OR bucket IS NOT NULL
  )
);

-- Biblioteca multimedia de un kit, filtrada por idioma. Es la consulta que ve
-- el alumno, asi que el indice cubre exactamente su forma.
CREATE INDEX IF NOT EXISTS content_assets_library_idx
  ON content_assets (kit_id, locale, type, order_index)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS content_assets_lesson_idx
  ON content_assets (lesson_id, locale, order_index)
  WHERE lesson_id IS NOT NULL;

-- Busqueda por titulo dentro de la biblioteca, sin tildes.
CREATE INDEX IF NOT EXISTS content_assets_title_trgm_idx
  ON content_assets USING gin ((unaccent(title)) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Mantenimiento de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kits_touch_updated_at ON kits;
CREATE TRIGGER kits_touch_updated_at
  BEFORE UPDATE ON kits FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS activation_codes_touch_updated_at ON activation_codes;
CREATE TRIGGER activation_codes_touch_updated_at
  BEFORE UPDATE ON activation_codes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS content_assets_touch_updated_at ON content_assets;
CREATE TRIGGER content_assets_touch_updated_at
  BEFORE UPDATE ON content_assets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
