-- Enlaces externos junto a los archivos subidos.
--
-- Muchos centros ya alojan el video de una exposicion en su OneDrive o su
-- Stream y comparten el enlace. Adoptar ese flujo evita almacenar y servir
-- gigabytes que no son nuestros, pero lo entregado sigue siendo la evidencia de
-- un alumno: tiene que vivir en la MISMA tabla que las subidas, o el docente
-- tendria que mirar en dos sitios para ver que le entrego su clase, y la purga
-- por retencion tendria que conocer dos modelos.
--
-- El coste es un par de columnas que solo aplican a una de las dos formas. Se
-- acota con restricciones para que no existan filas a medio camino.

SET search_path TO media, public;

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload'
    CHECK (source IN ('upload', 'link')),
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS external_host text;

-- Un archivo subido vive en un bucket; un enlace, no. Las columnas de
-- almacenamiento pasan a ser opcionales, y las restricciones garantizan que
-- cada fila tenga exactamente lo que corresponde a su tipo.
ALTER TABLE media_assets ALTER COLUMN bucket DROP NOT NULL;
ALTER TABLE media_assets ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE media_assets ALTER COLUMN declared_mime_type DROP NOT NULL;

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS source_shape_consistent;
ALTER TABLE media_assets ADD CONSTRAINT source_shape_consistent CHECK (
  (source = 'upload'
     AND bucket IS NOT NULL
     AND storage_key IS NOT NULL
     AND declared_mime_type IS NOT NULL
     AND external_url IS NULL)
  OR
  (source = 'link'
     AND external_url IS NOT NULL
     AND external_host IS NOT NULL
     AND bucket IS NULL
     AND storage_key IS NULL)
);

-- La comprobacion de contenido real solo tiene sentido en una subida: de un
-- enlace no tenemos los bytes, y fingir que si los validamos seria peor que
-- no validar, porque daria una confianza que no existe.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS ready_has_verified_content;
ALTER TABLE media_assets ADD CONSTRAINT ready_has_verified_content CHECK (
  status <> 'ready'
  OR source = 'link'
  OR (detected_mime_type IS NOT NULL AND size_bytes IS NOT NULL)
);

-- El indice unico de ubicacion tampoco aplica a los enlaces.
DROP INDEX IF EXISTS media_assets_storage_key_uq;
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_storage_key_uq
  ON media_assets (bucket, storage_key)
  WHERE source = 'upload';

-- Un mismo alumno no entrega dos veces el mismo enlace en el mismo ambito. No
-- es una regla de negocio profunda: evita la fila duplicada del doble clic, que
-- despues obliga al docente a preguntar cual de las dos mira.
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_link_uq
  ON media_assets (owner_id, scope, external_url)
  WHERE source = 'link' AND status = 'ready';

-- Para revisar a que sitios se esta enlazando. Si un dominio admitido empieza a
-- usarse para algo que no toca, aqui se ve antes que en un incidente.
CREATE INDEX IF NOT EXISTS media_assets_link_host_idx
  ON media_assets (external_host, created_at DESC)
  WHERE source = 'link';
