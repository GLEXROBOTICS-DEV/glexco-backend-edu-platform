-- Un unico cluster PostgreSQL con un schema por microservicio.
--
-- Por que: aisla logicamente los datos de cada bounded context (ningun servicio
-- puede hacer JOIN contra el schema de otro porque su rol no tiene permiso),
-- manteniendo una sola instancia en Railway. Migrar un schema a su propia base
-- en AWS/Huawei mas adelante es solo cambiar su DATABASE_URL: el codigo no
-- cambia porque nunca hubo claves foraneas cruzadas.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- busqueda por similitud en catalogo
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- busqueda sin tildes (es-419)
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Un schema y un rol por servicio.
DO $$
DECLARE
  svc text;
  services text[] := ARRAY[
    'identity',
    'institutions',
    'catalog',
    'learning',
    'assessment',
    'engagement',
    'analytics',
    'media'
  ];
BEGIN
  FOREACH svc IN ARRAY services LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', svc);

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glexco_' || svc) THEN
      EXECUTE format(
        'CREATE ROLE %I LOGIN PASSWORD %L',
        'glexco_' || svc,
        'glexco_local_dev'
      );
    END IF;

    -- El rol del servicio manda sobre su schema y no ve los demas.
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', svc, 'glexco_' || svc);
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', svc, 'glexco_' || svc);
    EXECUTE format('ALTER ROLE %I SET search_path TO %I, public', 'glexco_' || svc, svc);
  END LOOP;
END
$$;

-- Nadie crea objetos sueltos en public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
