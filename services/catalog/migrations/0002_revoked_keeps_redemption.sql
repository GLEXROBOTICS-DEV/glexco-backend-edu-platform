-- Un codigo anulado conserva quien lo canjeo.
--
-- La restriccion original decia, en la practica: "si el estado no es
-- 'redeemed', no puede haber alumno ni fecha de canje". Estaba escrita
-- pensando en los estados que PRECEDEN al canje (issued, distributed, expired),
-- donde es correcta, pero atrapaba tambien al que viene DESPUES: 'revoked'.
--
-- La consecuencia era que anular un codigo ya canjeado fallaba con una
-- violacion de restriccion, y la unica forma de anularlo habria sido borrar
-- quien lo habia usado. Eso es exactamente lo contrario de lo que hace falta:
-- los tres motivos por los que se anula un codigo son error de imprenta,
-- devolucion y fraude, y en el tercero saber a que cuenta fue a parar es el
-- dato principal de la investigacion.
--
-- La nueva version sigue impidiendo los estados imposibles:
--   - 'redeemed' sin alumno o sin fecha,
--   - un codigo sin canjear (issued / distributed / expired) con alumno,
--   - y en 'revoked', tener alumno pero no fecha, o al reves.

SET search_path TO catalog, public;

ALTER TABLE activation_codes DROP CONSTRAINT IF EXISTS redeemed_fields_consistent;

ALTER TABLE activation_codes ADD CONSTRAINT redeemed_fields_consistent CHECK (
  (status = 'redeemed' AND redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)
  -- Anulado: conserva el canje si lo hubo, y ambos campos van juntos.
  OR (status = 'revoked' AND ((redeemed_by IS NULL) = (redeemed_at IS NULL)))
  OR (
    status IN ('issued', 'distributed', 'expired')
    AND redeemed_by IS NULL
    AND redeemed_at IS NULL
  )
);

-- Investigacion de fraude: "que codigos anulados habian llegado a canjearse".
-- Parcial porque las anulaciones son una fraccion minima de la tabla.
CREATE INDEX IF NOT EXISTS activation_codes_revoked_redeemed_idx
  ON activation_codes (redeemed_by)
  WHERE status = 'revoked' AND redeemed_by IS NOT NULL;
