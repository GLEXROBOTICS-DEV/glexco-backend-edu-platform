-- Esquema de learning: progreso por consumo de contenido y gamificacion.
--
-- **Por que hace falta, si ya hay analitica.** El progreso que cuenta para medir
-- aprendizaje se mide con evaluaciones, y eso lo hace analytics. Lo que falta es
-- la senal TEMPRANA: quien se descolgo antes del primer examen. Un alumno que
-- lleva dos semanas sin abrir una leccion se detecta aqui; en analytics no
-- aparece hasta que suspende, que es cuando ya es tarde para ayudarle.

-- ---------------------------------------------------------------------------
-- Progreso por leccion
-- ---------------------------------------------------------------------------
--
-- Una fila por alumno y leccion. `started_at` y `completed_at` van separados a
-- proposito: abrir una leccion y terminarla son hechos distintos, y la distancia
-- entre los dos es justo la senal que interesa. Un alumno con quince lecciones
-- abiertas y ninguna terminada tiene un problema que un contador de "lecciones
-- vistas" no muestra.
CREATE TABLE IF NOT EXISTS lesson_progress (
  student_id     uuid NOT NULL,
  lesson_id      uuid NOT NULL,
  course_id      uuid NOT NULL,
  kit_id         uuid NOT NULL,
  classroom_id   uuid,
  institution_id uuid,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  -- Segundos acumulados con la leccion abierta. Es orientativo y se sabe: el
  -- navegador puede quedarse abierto. Sirve para distinguir "la abrio y la
  -- cerro" de "estuvo veinte minutos", no para medir esfuerzo.
  seconds_spent  integer NOT NULL DEFAULT 0,
  version        integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, lesson_id)
);

-- "¿Como va este alumno en este kit?" es la consulta de su portada.
CREATE INDEX IF NOT EXISTS lesson_progress_student_kit_idx
  ON lesson_progress (student_id, kit_id);

-- "¿Quien de mi salon se ha descolgado?" es la del docente, y es la razon de
-- ser de este servicio. El indice parcial cubre justo lo pendiente.
CREATE INDEX IF NOT EXISTS lesson_progress_classroom_pending_idx
  ON lesson_progress (classroom_id, updated_at DESC)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS lesson_progress_classroom_idx
  ON lesson_progress (classroom_id, student_id);

-- ---------------------------------------------------------------------------
-- Gamificacion
-- ---------------------------------------------------------------------------
--
-- **El XP se acumula, y los hechos que lo generan se guardan por separado.** No
-- es duplicacion: sin la tabla de hechos, un evento entregado dos veces sumaria
-- dos veces y no habria forma de saberlo. Con ella, la concesion es idempotente
-- por (alumno, motivo, referencia) y el total se puede recalcular entero.
CREATE TABLE IF NOT EXISTS xp_awards (
  id          uuid PRIMARY KEY,
  student_id  uuid NOT NULL,
  -- `lesson_completed` | `course_completed` | `assessment_passed` | `challenge`
  reason      text NOT NULL,
  -- Que lo genero: la leccion, el curso, la entrega. Junto con `reason` forma la
  -- clave de idempotencia.
  reference   uuid NOT NULL,
  points      integer NOT NULL CHECK (points > 0),
  awarded_at  timestamptz NOT NULL DEFAULT now()
);

-- La garantia de un solo cobro. Sin esto, reabrir una leccion ya completada, o
-- un evento reentregado, regalan XP: y un contador de puntos que se puede
-- inflar deja de significar nada para el alumno que se lo gano.
CREATE UNIQUE INDEX IF NOT EXISTS xp_awards_once_idx
  ON xp_awards (student_id, reason, reference);

CREATE INDEX IF NOT EXISTS xp_awards_student_idx
  ON xp_awards (student_id, awarded_at DESC);

-- Resumen por alumno. Se recalcula ENTERO desde `xp_awards` en vez de sumar
-- incrementos: es la misma decision que en analytics, y por lo mismo -un evento
-- entregado dos veces no puede inflar un total que se recalcula desde los
-- hechos-.
CREATE TABLE IF NOT EXISTS student_gamification (
  student_id       uuid PRIMARY KEY,
  total_xp         integer NOT NULL DEFAULT 0,
  -- Nivel del Explorador, 1 a 5. Se guarda para no recalcularlo en cada lectura
  -- y, sobre todo, para poder detectar cuando SUBE y celebrarlo.
  explorer_level   integer NOT NULL DEFAULT 1,
  lessons_completed integer NOT NULL DEFAULT 0,
  courses_completed integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Insignias
-- ---------------------------------------------------------------------------
--
-- Se conceden una vez y no se retiran. Una insignia que aparece y desaparece
-- -porque el alumno bajo de una media- convierte un reconocimiento en un
-- castigo, y a un nino de ocho anos eso le ensena a no intentarlo.
CREATE TABLE IF NOT EXISTS badges (
  student_id  uuid NOT NULL,
  badge_code  text NOT NULL,
  -- `participation` | `performance` | `creativity` | `skill` | `milestone`
  category    text NOT NULL,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, badge_code)
);

CREATE INDEX IF NOT EXISTS badges_student_idx
  ON badges (student_id, awarded_at DESC);

-- ---------------------------------------------------------------------------
-- Directorio de cursos y lecciones
-- ---------------------------------------------------------------------------
--
-- Cuantas lecciones tiene cada curso, para poder decir "3 de 12" sin preguntarle
-- a catalogo en cada carga de la portada. Llega por evento, como los demas
-- directorios de este proyecto.
CREATE TABLE IF NOT EXISTS course_directory (
  course_id    uuid PRIMARY KEY,
  kit_id       uuid NOT NULL,
  title        text NOT NULL DEFAULT '',
  lesson_count integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_directory_kit_idx
  ON course_directory (kit_id);

CREATE TABLE IF NOT EXISTS lesson_directory (
  lesson_id  uuid PRIMARY KEY,
  course_id  uuid NOT NULL,
  kit_id     uuid NOT NULL,
  title      text NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lesson_directory_course_idx
  ON lesson_directory (course_id, order_index);

-- ---------------------------------------------------------------------------
-- Matriculas
-- ---------------------------------------------------------------------------
--
-- Que alumnos hay en cada salon, para que el docente pueda ver quien se ha
-- descolgado sin llamar a instituciones en cada apertura.
CREATE TABLE IF NOT EXISTS classroom_members (
  classroom_id   uuid NOT NULL,
  student_id     uuid NOT NULL,
  institution_id uuid,
  teacher_id     uuid,
  full_name      text NOT NULL DEFAULT '',
  active         boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS classroom_members_student_idx
  ON classroom_members (student_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS classroom_members_teacher_idx
  ON classroom_members (teacher_id)
  WHERE active;
