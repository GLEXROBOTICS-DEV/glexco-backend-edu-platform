-- La entrega guarda la institucion del ALUMNO.
--
-- Faltaba, y el hueco vaciaba los dashboards. Una evaluacion de GLEXCO no
-- pertenece a ninguna institucion -es comun a todas, igual que los tutoriales-,
-- asi que tomar la institucion de la evaluacion dejaba sin institucion todos
-- los resultados del banco comun. Y son justamente esos los unicos comparables
-- entre colegios: el panel del director salia con cero alumnos medidos aunque
-- su clase entera hubiera respondido.
--
-- La institucion correcta es la del alumno que entrega, y se fija al abrir el
-- intento, desde su token.

SET search_path TO assessment, public;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS institution_id uuid;

-- Bandeja de correccion y notas por institucion. Parcial porque las entregas de
-- alumnos independientes no tienen institucion y no interesan en esa consulta.
CREATE INDEX IF NOT EXISTS submissions_institution_idx
  ON submissions (institution_id, submitted_at DESC)
  WHERE institution_id IS NOT NULL;
