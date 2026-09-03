-- Servicio de instituciones — esquema inicial.
--
-- Instituciones, licencias, salones y matriculas. Sin una sola clave foranea
-- hacia otro schema: `teacher_id` y `student_id` apuntan a usuarios que son
-- propiedad del servicio de identidad, y esa referencia se mantiene por evento,
-- no por integridad referencial. Es lo que permite mover este schema a su propia
-- base de datos con solo cambiar la cadena de conexion.

SET search_path TO institutions, public;

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- institutions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS institutions (
  id                uuid PRIMARY KEY,

  -- El codigo que los alumnos teclean en la pantalla de ingreso. citext para
  -- que "SJB2026" y "sjb2026" sean el mismo, garantizado por el motor.
  code              citext NOT NULL,

  name              text NOT NULL,
  short_name        text NOT NULL,

  -- Niveles atendidos. Arreglo y no tabla aparte: son como mucho cinco valores,
  -- se leen siempre junto a la institucion y nunca se consultan solos.
  education_levels  text[] NOT NULL CHECK (cardinality(education_levels) > 0),

  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','suspended','archived')),

  responsible_name  text NOT NULL,
  contact_email     citext NOT NULL,
  phone             text,
  city              text NOT NULL,
  address           text,

  -- Proyecciones para el panel, alimentadas por eventos de identidad. Son
  -- cifras para MOSTRAR: ninguna decision de negocio las consulta, porque
  -- pueden ir unos segundos por detras de la verdad.
  student_count     integer NOT NULL DEFAULT 0 CHECK (student_count >= 0),
  teacher_count     integer NOT NULL DEFAULT 0 CHECK (teacher_count >= 0),

  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS institutions_code_uq ON institutions (code);
CREATE INDEX IF NOT EXISTS institutions_city_idx ON institutions (city, name);
CREATE INDEX IF NOT EXISTS institutions_status_idx ON institutions (status, created_at DESC);

-- Busqueda por nombre en el panel, sin tildes y por similitud.
CREATE INDEX IF NOT EXISTS institutions_name_trgm_idx
  ON institutions USING gin ((public.immutable_unaccent(name)) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- licenses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS licenses (
  id              uuid PRIMARY KEY,
  institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Plazas contratadas. Se comprueban de forma INFORMATIVA: superarlas no
  -- bloquea la matricula. Dejar a un nino sin acceso a mitad de curso por un
  -- asunto administrativo castiga a quien no tiene culpa; se avisa y se factura.
  seats           integer NOT NULL CHECK (seats > 0),

  starts_at       timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expiring_soon','expired','cancelled')),
  reference       text,
  granted_by      uuid NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT license_period_valid CHECK (expires_at > starts_at)
);

-- Dos licencias vigentes solapadas harian ambiguo cual manda al contar plazas y
-- al avisar de vencimientos. La restriccion de exclusion lo impide en el motor,
-- no solo en el agregado: una importacion manual tampoco puede saltarsela.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_no_overlap;
ALTER TABLE licenses ADD CONSTRAINT licenses_no_overlap
  EXCLUDE USING gist (
    institution_id WITH =,
    tstzrange(starts_at, expires_at) WITH &&
  ) WHERE (status <> 'cancelled');

CREATE INDEX IF NOT EXISTS licenses_institution_idx ON licenses (institution_id, expires_at DESC);

-- Indice PARCIAL para el aviso de renovacion: solo interesan las vivas.
CREATE INDEX IF NOT EXISTS licenses_expiring_idx
  ON licenses (expires_at)
  WHERE status IN ('active','expiring_soon');

-- ---------------------------------------------------------------------------
-- classrooms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS classrooms (
  id              uuid PRIMARY KEY,
  institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,

  -- Usuario del servicio de identidad. Sin clave foranea a proposito: cruzar
  -- schemas ataria los dos servicios para siempre.
  teacher_id      uuid NOT NULL,

  name            text NOT NULL,
  grade           text NOT NULL,

  -- El tope que pide la propuesta ("ejemplo 20 alumnos").
  capacity        integer NOT NULL DEFAULT 30 CHECK (capacity BETWEEN 1 AND 60),

  -- Un salon "3.º A" existe cada ano y son salones distintos. Sin este campo, el
  -- historial de un alumno se mezclaria entre promociones.
  academic_year   integer NOT NULL CHECK (academic_year BETWEEN 2020 AND 2100),

  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),

  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Dos salones con el mismo nombre, grado y ano en el mismo colegio son
-- inevitablemente un duplicado creado por error.
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_unique_per_year
  ON classrooms (institution_id, academic_year, grade, lower(name))
  WHERE status = 'active';

-- Panel del docente: "mis salones de este ano".
CREATE INDEX IF NOT EXISTS classrooms_teacher_idx
  ON classrooms (teacher_id, academic_year DESC)
  WHERE status = 'active';

-- Panel del administrador de institucion.
CREATE INDEX IF NOT EXISTS classrooms_institution_idx
  ON classrooms (institution_id, academic_year DESC, grade);

-- Consulta PUBLICA del formulario de registro: salones elegibles de un grado.
CREATE INDEX IF NOT EXISTS classrooms_selectable_idx
  ON classrooms (institution_id, grade, academic_year)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
  classroom_id  uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL,

  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','transferred','withdrawn','completed')),

  -- Kit activado con el codigo del libro. Lo informa catalogo al canjearlo.
  kit_id        uuid,

  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz,

  -- Clave compuesta: un alumno tiene UNA matricula por salon, que se reactiva si
  -- vuelve. Asi su historial no se parte en varias filas.
  PRIMARY KEY (classroom_id, student_id),

  CONSTRAINT left_at_matches_status CHECK (
    (status = 'active' AND left_at IS NULL) OR (status <> 'active')
  )
);

-- Conteo de plazas ocupadas. PARCIAL sobre las activas, que es lo unico que se
-- cuenta: las retiradas no bloquean plaza y serian peso muerto en el indice.
CREATE INDEX IF NOT EXISTS enrollments_active_idx
  ON enrollments (classroom_id)
  WHERE status = 'active';

-- "¿En que salones esta este alumno?" — lo consulta el portal del alumno.
CREATE INDEX IF NOT EXISTS enrollments_student_idx
  ON enrollments (student_id, status);

-- ---------------------------------------------------------------------------
-- teacher_directory — proyeccion de solo lectura
-- ---------------------------------------------------------------------------
-- Copia del nombre del docente, alimentada por eventos de identidad. Existe
-- porque pintar el listado de salones necesita el nombre, y pedirlo a identidad
-- por cada fila serian N llamadas de red por listado. Puede ir unos segundos
-- desactualizada: para un nombre, eso es irrelevante.
CREATE TABLE IF NOT EXISTS teacher_directory (
  user_id         uuid PRIMARY KEY,
  institution_id  uuid NOT NULL,
  full_name       text NOT NULL,
  email           citext NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_directory_institution_idx
  ON teacher_directory (institution_id, full_name);

-- ---------------------------------------------------------------------------
-- Mantenimiento de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS institutions_touch_updated_at ON institutions;
CREATE TRIGGER institutions_touch_updated_at
  BEFORE UPDATE ON institutions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS classrooms_touch_updated_at ON classrooms;
CREATE TRIGGER classrooms_touch_updated_at
  BEFORE UPDATE ON classrooms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
