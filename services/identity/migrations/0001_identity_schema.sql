-- Servicio de identidad — esquema inicial.
--
-- Se escribe SQL a mano en vez de generarlo con un ORM. Motivo: los indices
-- parciales, las restricciones de exclusion y las decisiones de tipo (citext,
-- timestamptz) son justamente donde se gana o se pierde el rendimiento a
-- escala, y un generador tiende a producir el minimo comun denominador.

SET search_path TO identity, public;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                     uuid PRIMARY KEY,

  -- citext: la comparacion es insensible a mayusculas en el propio motor, asi
  -- que el indice unico impide de raiz que existan "Ana@x.pe" y "ana@x.pe" como
  -- cuentas distintas. Normalizar solo en la aplicacion deja la puerta abierta a
  -- cualquier via de alta que se olvide de hacerlo.
  email                  citext NOT NULL,

  first_name             text NOT NULL,
  last_name              text NOT NULL,
  birth_date             date,

  password_hash          text NOT NULL,

  -- Los roles se guardan como arreglo y no en tabla aparte: son pocos por
  -- usuario (uno o dos), se leen SIEMPRE junto al usuario y nunca se consultan
  -- de forma independiente. Una tabla de union anadiria un JOIN a la ruta mas
  -- caliente de la plataforma sin aportar nada.
  roles                  text[] NOT NULL,

  institution_id         uuid,

  status                 text NOT NULL
                           CHECK (status IN ('pending_verification','active','suspended','deactivated')),
  account_type           text NOT NULL
                           CHECK (account_type IN ('institutional','independent','staff')),

  email_verified         boolean NOT NULL DEFAULT false,
  guardian_email         citext,
  locale                 text NOT NULL DEFAULT 'es' CHECK (locale IN ('es','en')),
  avatar_url             text,
  must_change_password   boolean NOT NULL DEFAULT false,
  accepted_terms_at      timestamptz,

  failed_login_attempts  integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  last_login_at          timestamptz,

  -- Concurrencia optimista: cada UPDATE lleva `WHERE version = :esperada`. Sin
  -- esto, dos administradores editando el mismo usuario a la vez se pisan y el
  -- ultimo gana en silencio.
  version                integer NOT NULL DEFAULT 0,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Un menor de 14 no puede existir sin correo de apoderado. La regla vive
  -- tambien en el agregado, pero aqui es una garantia que ninguna via de
  -- escritura puede saltarse, ni siquiera una importacion hecha a mano.
  CONSTRAINT guardian_required_for_minors CHECK (
    birth_date IS NULL
    OR birth_date <= (CURRENT_DATE - INTERVAL '14 years')
    OR guardian_email IS NOT NULL
  ),

  -- Docentes y administradores de institucion deben pertenecer a una.
  CONSTRAINT institution_required_for_staff CHECK (
    NOT (roles && ARRAY['teacher','institution_admin']::text[])
    OR institution_id IS NOT NULL
  )
);

-- Clave de inicio de sesion. Es el indice mas consultado del servicio.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (email);

-- Listados del panel de institucion: filtran por institucion y ordenan por alta.
CREATE INDEX IF NOT EXISTS users_institution_idx
  ON users (institution_id, created_at DESC)
  WHERE institution_id IS NOT NULL;

-- Busqueda por rol dentro de una institucion ("todos los docentes de este
-- colegio"). GIN sobre el arreglo permite el operador de contencion.
CREATE INDEX IF NOT EXISTS users_roles_idx ON users USING gin (roles);

-- Indice PARCIAL de cuentas bloqueadas: son un punado frente a millones de
-- filas, asi que un indice completo seria desperdicio puro.
CREATE INDEX IF NOT EXISTS users_locked_idx
  ON users (locked_until)
  WHERE locked_until IS NOT NULL;

-- Busqueda por nombre en el panel, sin tildes y por similitud.
CREATE INDEX IF NOT EXISTS users_name_trgm_idx
  ON users USING gin ((unaccent(first_name || ' ' || last_name)) gin_trgm_ops);

-- Aviso de licencias y limpieza de cuentas nunca verificadas.
CREATE INDEX IF NOT EXISTS users_pending_verification_idx
  ON users (created_at)
  WHERE status = 'pending_verification';

-- ---------------------------------------------------------------------------
-- one_time_tokens — verificacion de correo y recuperacion de contrasena
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS one_time_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL
                CHECK (purpose IN ('email_verification','password_reset','guardian_consent')),

  -- Se guarda el HASH del token, nunca el token. Si alguien obtiene un volcado
  -- de la base, no puede usar los enlaces pendientes para tomar cuentas ajenas.
  -- Es el mismo razonamiento que con las contrasenas.
  token_hash  text NOT NULL,

  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ip_address  inet
);

CREATE UNIQUE INDEX IF NOT EXISTS one_time_tokens_hash_uq ON one_time_tokens (token_hash);

-- Solo se indexan los tokens vivos: los consumidos y caducados son ruido para
-- la consulta de validacion.
CREATE INDEX IF NOT EXISTS one_time_tokens_active_idx
  ON one_time_tokens (user_id, purpose)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS one_time_tokens_expiry_idx ON one_time_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- audit_log — auditoria de acceso
-- ---------------------------------------------------------------------------
-- Separado de los eventos de dominio a proposito: debe conservarse aunque el
-- evento ya haya salido del stream de NATS, tiene valor legal y se consulta con
-- filtros que un stream no soporta bien.
CREATE TABLE IF NOT EXISTS audit_log (
  id             bigserial PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid,
  action         text NOT NULL,
  target_type    text NOT NULL,
  target_id      uuid,
  outcome        text NOT NULL CHECK (outcome IN ('success','failure')),
  reason         text,
  institution_id uuid,
  ip_address     inet,
  user_agent     text,
  correlation_id uuid,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Esta tabla crece sin limite (cada inicio de sesion es una fila). Cuando el
-- volumen lo pida, hay que convertirla en particionada por rango mensual y
-- archivar las particiones antiguas. Los indices ya estan pensados para eso.
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_time_idx ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_institution_idx
  ON audit_log (institution_id, occurred_at DESC)
  WHERE institution_id IS NOT NULL;

-- Investigacion de incidentes: "todos los fallos de las ultimas 24 horas".
CREATE INDEX IF NOT EXISTS audit_log_failures_idx
  ON audit_log (occurred_at DESC)
  WHERE outcome = 'failure';

CREATE INDEX IF NOT EXISTS audit_log_correlation_idx
  ON audit_log (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- weak_passwords — lista de contrasenas prohibidas
-- ---------------------------------------------------------------------------
-- NIST SP 800-63B: comprobar contra una lista de contrasenas conocidas es mas
-- efectivo que exigir mayusculas y simbolos. Las reglas de composicion producen
-- "Password1!" de forma sistematica; la lista bloquea exactamente lo que los
-- atacantes prueban primero.
CREATE TABLE IF NOT EXISTS weak_passwords (
  password text PRIMARY KEY
);

-- ---------------------------------------------------------------------------
-- Mantenimiento automatico de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
