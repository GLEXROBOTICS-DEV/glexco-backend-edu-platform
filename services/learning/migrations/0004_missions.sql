-- Misiones semanales.
--
-- UNA tabla y no dos. El avance de cada alumno NO se guarda: se calcula de
-- `lesson_progress` y de `xp_awards`, que son los hechos. Una tabla
-- `mission_progress` seria una segunda copia de algo ya escrito, habria que
-- mantenerla al dia con cada leccion completada, y el dia que se despegara del
-- original nadie sabria cual de las dos dice la verdad. Es el mismo criterio por
-- el que `total_xp` se recalcula desde `xp_awards` en vez de sumar incrementos.
--
-- Lo unico que se anota al completar una mision es su XP, en `xp_awards` con
-- `reason = 'mission_completed'` y `reference = mission_id`. Esa tabla ya es
-- idempotente por (alumno, motivo, referencia), asi que una mision no puede
-- pagar dos veces y no hace falta inventar otra garantia.
--
-- Va en archivo NUEVO y no anadida a una anterior: el ejecutor las marca por
-- nombre de archivo, asi que lo que se anade a una que ya corrio no se ejecuta
-- nunca -y el despliegue dice que fue bien-.

SET search_path TO learning, public;

CREATE TABLE IF NOT EXISTS missions (
  id             uuid PRIMARY KEY,

  -- Kit al que pertenece. Sin clave foranea al catalogo: cruzar schemas ataria
  -- los dos servicios para siempre.
  kit_id         uuid NOT NULL,

  -- Quien la escribio. Hoy solo GLEXCO publica misiones y vienen con el kit,
  -- iguales para todos los colegios que lo compraron; el cliente ya dijo que
  -- mas adelante la institucion y el docente podran ajustarlas, y anadir la
  -- columna despues obligaria a migrar filas y a decidir de quien era lo ya
  -- escrito.
  origin         text NOT NULL DEFAULT 'glexco'
                   CHECK (origin IN ('glexco', 'institution')),

  -- NULL en las de GLEXCO: son de todos. Obligatorio en las de institucion, y
  -- la restriccion lo dice en vez de confiar en quien inserte.
  institution_id uuid,

  -- Semana dentro del kit, desde 1. La ventana de cada alumno se cuenta desde
  -- su PRIMERA ACTIVIDAD y no desde una fecha absoluta: quien compra el libro en
  -- mayo no puede abrir la plataforma con treinta misiones vencidas.
  week_number    integer NOT NULL CHECK (week_number BETWEEN 1 AND 60),

  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',

  -- Los objetivos, en JSONB y no en tabla aparte. Se leen y se escriben SIEMPRE
  -- como un bloque -nadie pide "el objetivo 2 de tal mision"-, son dos o tres
  -- por mision, y en tabla aparte cada carga de la portada seria un JOIN con
  -- ordenacion. La contrapartida asumida es que no se pueden consultar
  -- objetivos sueltos por SQL, que no hace falta.
  objectives     jsonb NOT NULL DEFAULT '[]'::jsonb,

  xp_reward      integer NOT NULL CHECK (xp_reward > 0),

  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'archived')),

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Una mision de institucion sin institucion no tiene dueno, y una de GLEXCO
  -- con institucion dejaria de ser de todos. Los dos estados son imposibles y
  -- salen muy caros de diagnosticar despues.
  CONSTRAINT missions_origin_matches_institution CHECK (
    (origin = 'glexco' AND institution_id IS NULL)
    OR (origin = 'institution' AND institution_id IS NOT NULL)
  )
);

-- La consulta de la portada: las misiones publicadas de un kit, por semana.
-- Parcial sobre lo publicado porque un borrador no se le ensena a nadie y seria
-- peso muerto en el indice.
CREATE INDEX IF NOT EXISTS missions_kit_week_idx
  ON missions (kit_id, week_number)
  WHERE status = 'published';

-- Las de un colegio, para el dia que su direccion las ajuste.
CREATE INDEX IF NOT EXISTS missions_institution_idx
  ON missions (institution_id, kit_id)
  WHERE institution_id IS NOT NULL;

-- Dos misiones de GLEXCO en la misma semana del mismo kit son un duplicado
-- creado por error: la semana es la que ordena la pantalla, y con dos el alumno
-- ve dos "misiones de esta semana" sin saber cual es la suya.
CREATE UNIQUE INDEX IF NOT EXISTS missions_glexco_week_uq
  ON missions (kit_id, week_number)
  WHERE origin = 'glexco' AND status <> 'archived';

-- El motivo `mission_completed` es nuevo en `xp_awards`. La columna es `text` y
-- no un enum, asi que no hace falta migrar nada: se documenta aqui para que
-- quien lea la tabla sepa de donde sale ese valor.
COMMENT ON TABLE missions IS
  'Misiones semanales del kit. El avance NO se guarda: se calcula de lesson_progress y xp_awards. Completarla se anota como xp_awards(reason=mission_completed, reference=mission_id).';
