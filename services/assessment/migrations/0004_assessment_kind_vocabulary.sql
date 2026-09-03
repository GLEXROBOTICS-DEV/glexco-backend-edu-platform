-- ---------------------------------------------------------------------------
-- Alinea `kind` con el vocabulario del dominio
-- ---------------------------------------------------------------------------
-- La restriccion original aceptaba ('quiz','task','exam'), tres valores que no
-- existen en `ASSESSMENT_TYPES` -donde estan 'quiz', 'practical', 'project' y
-- 'stem_activity'-. El resultado era el peor de los posibles: el esquema Zod
-- aceptaba 'project', el agregado lo aceptaba, y la insercion moria contra la
-- restriccion. Es decir, un 500 en lugar de un 422, sin ninguna pista de que el
-- problema era el valor de un campo.
--
-- Solo se podia crear un cuestionario de marcar. Todo lo demas -el proyecto, la
-- practica, la actividad STEM, que son justamente las que llevan preguntas
-- abiertas y por tanto las unicas que llegan a la bandeja de correccion- era
-- imposible de dar de alta.
--
-- Se mapean los dos valores viejos antes de cambiar la restriccion, aunque hoy
-- no haya ninguna fila con ellos: la migracion tiene que ser correcta tambien
-- en una base que lleve tiempo en marcha.
UPDATE assessments SET kind = 'project' WHERE kind = 'task';
UPDATE assessments SET kind = 'quiz' WHERE kind = 'exam';

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_kind_check;

ALTER TABLE assessments
  ADD CONSTRAINT assessments_kind_check
  CHECK (kind IN ('quiz', 'practical', 'project', 'stem_activity'));
