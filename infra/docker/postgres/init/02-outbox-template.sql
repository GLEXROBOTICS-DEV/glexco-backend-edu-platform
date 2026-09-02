-- Tabla `outbox` en cada schema de servicio.
--
-- Es la mitad persistente del patron outbox transaccional: los casos de uso
-- escriben aqui sus eventos DENTRO de la misma transaccion que el cambio de
-- estado, y el `OutboxRelay` los publica a NATS despues. Sin esto, un proceso
-- que muere entre "guardar en base" y "publicar evento" pierde el evento en
-- silencio, y en esta plataforma eso significa, por ejemplo, un codigo de libro
-- consumido sin que el alumno reciba acceso al kit.
--
-- Se crea igual en todos los schemas mediante este bucle, para que ninguna
-- migracion de servicio pueda olvidarla.

DO $$
DECLARE
  svc text;
  services text[] := ARRAY[
    'identity', 'institutions', 'catalog', 'learning',
    'assessment', 'engagement', 'analytics', 'media'
  ];
BEGIN
FOREACH svc IN ARRAY services LOOP
  EXECUTE format($fmt$
    CREATE TABLE IF NOT EXISTS %I.outbox (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Id del evento generado en el dominio. UNIQUE porque es la clave de
      -- deduplicacion que viaja a JetStream como Nats-Msg-Id: si el relay
      -- reintenta tras un fallo de red, el bus descarta el duplicado.
      event_id          uuid NOT NULL UNIQUE,

      event_name        text NOT NULL,
      aggregate_type    text NOT NULL,
      aggregate_id      uuid NOT NULL,
      aggregate_version integer NOT NULL,

      payload           jsonb NOT NULL,
      metadata          jsonb NOT NULL,
      correlation_id    uuid,

      created_at        timestamptz NOT NULL DEFAULT now(),
      published_at      timestamptz,

      -- Reintentos con backoff. `next_attempt_at` evita que un evento que falla
      -- una y otra vez se reintente miles de veces por minuto y sature el bus
      -- justo cuando intenta recuperarse.
      attempts          integer NOT NULL DEFAULT 0,
      next_attempt_at   timestamptz,
      last_error        text
    )
  $fmt$, svc);

  -- Indice PARCIAL: solo indexa lo pendiente. La outbox se llena de filas ya
  -- publicadas hasta que la purga las borra, y un indice completo obligaria al
  -- planificador a recorrerlas todas en cada drenaje. Con el indice parcial, la
  -- consulta del relay toca unicamente las decenas de filas que quedan por
  -- enviar, sin importar que la tabla tenga millones.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.outbox (created_at)
       WHERE published_at IS NULL',
    'outbox_pending_idx_' || svc, svc);

  -- Soporte de la purga de eventos antiguos ya publicados.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.outbox (published_at)
       WHERE published_at IS NOT NULL',
    'outbox_published_idx_' || svc, svc);

  -- Reconstruir la historia de un agregado concreto durante una investigacion.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.outbox (aggregate_type, aggregate_id, aggregate_version)',
    'outbox_aggregate_idx_' || svc, svc);

  EXECUTE format('ALTER TABLE %I.outbox OWNER TO %I', svc, 'glexco_' || svc);
END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Idempotencia de consumidores
-- ---------------------------------------------------------------------------
-- JetStream garantiza at-least-once: un mismo evento PUEDE llegar dos veces
-- (reintento tras un ack perdido, redistribucion de consumidores). Cada servicio
-- registra aqui los eventos que ya proceso y descarta los repetidos.
--
-- Sin esta tabla, un evento "codigo canjeado" entregado dos veces otorgaria el
-- acceso dos veces, y uno de "XP concedida" duplicaria puntos.

DO $$
DECLARE
  svc text;
  services text[] := ARRAY[
    'identity', 'institutions', 'catalog', 'learning',
    'assessment', 'engagement', 'analytics', 'media'
  ];
BEGIN
FOREACH svc IN ARRAY services LOOP
  EXECUTE format($fmt$
    CREATE TABLE IF NOT EXISTS %I.processed_events (
      event_id     uuid PRIMARY KEY,
      event_name   text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    )
  $fmt$, svc);

  -- Permite purgar registros antiguos: pasado el periodo de retencion del
  -- stream, un evento ya no puede volver a entregarse y su marca sobra.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.processed_events (processed_at)',
    'processed_events_at_idx_' || svc, svc);

  EXECUTE format('ALTER TABLE %I.processed_events OWNER TO %I', svc, 'glexco_' || svc);
END LOOP;
END
$$;
