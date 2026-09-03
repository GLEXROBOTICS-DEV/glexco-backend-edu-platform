-- Servicio de medios — esquema inicial.
--
-- Registra cada fichero que entra a la plataforma: quien lo subio, a que
-- bucket, que dijo que era y que resulto ser. Los bytes viven en el almacen de
-- objetos; aqui solo esta el rastro, que es lo que permite saber si un objeto
-- del bucket tiene dueno o es basura que estamos pagando.

SET search_path TO media, public;

CREATE TABLE IF NOT EXISTS media_assets (
  id                 uuid PRIMARY KEY,

  -- Usuario del servicio de identidad. Sin clave foranea a proposito: cruzar
  -- schemas ataria los dos servicios para siempre.
  owner_id           uuid NOT NULL,
  institution_id     uuid,

  -- Para que se subio. Decide el bucket y, mas adelante, la retencion: una
  -- evidencia escolar y un certificado no se conservan el mismo tiempo.
  scope              text NOT NULL CHECK (scope IN ('evidence','content','avatar','document')),

  bucket             text NOT NULL,

  -- La clave la construye SIEMPRE el dominio a partir del id del recurso, nunca
  -- el cliente. Unica para que dos subidas no puedan apuntar al mismo objeto:
  -- si pudieran, confirmar una validaria los bytes de la otra.
  storage_key        text NOT NULL,

  -- Lo que el cliente DIJO que subia.
  declared_mime_type text NOT NULL,
  -- Lo que resulto ser al mirar los bytes. NULL mientras no se ha comprobado.
  detected_mime_type text,

  original_filename  text NOT NULL,
  size_bytes         bigint,

  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','ready','rejected','deleted')),
  rejection_reason   text,

  thumbnail_key      text,
  -- Referencia en el proveedor de video externo. El video largo no se sirve
  -- desde nuestro ancho de banda.
  video_provider_ref text,

  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Estados imposibles que despues son muy caros de diagnosticar: un fichero
  -- listo sin tipo detectado ni tamano, o uno rechazado sin motivo.
  CONSTRAINT ready_has_verified_content CHECK (
    status <> 'ready' OR (detected_mime_type IS NOT NULL AND size_bytes IS NOT NULL)
  ),
  CONSTRAINT rejected_has_reason CHECK (
    status <> 'rejected' OR rejection_reason IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS media_assets_storage_key_uq
  ON media_assets (bucket, storage_key);

-- "Mis archivos": lo que consulta el portal del alumno y el del docente.
CREATE INDEX IF NOT EXISTS media_assets_owner_idx
  ON media_assets (owner_id, created_at DESC)
  WHERE status = 'ready';

-- Panel de institucion: las evidencias de sus alumnos.
CREATE INDEX IF NOT EXISTS media_assets_institution_idx
  ON media_assets (institution_id, scope, created_at DESC)
  WHERE institution_id IS NOT NULL AND status = 'ready';

-- Limpieza de subidas abandonadas. Indice PARCIAL: las pendientes son un
-- punado frente al total, y un indice completo obligaria a recorrerlas todas.
CREATE INDEX IF NOT EXISTS media_assets_abandoned_idx
  ON media_assets (created_at)
  WHERE status = 'pending';

-- Investigacion: que subidas se rechazaron y por que. Si alguien intenta colar
-- ficheros que no son lo que dicen, aqui se ve el patron.
CREATE INDEX IF NOT EXISTS media_assets_rejected_idx
  ON media_assets (owner_id, created_at DESC)
  WHERE status = 'rejected';
