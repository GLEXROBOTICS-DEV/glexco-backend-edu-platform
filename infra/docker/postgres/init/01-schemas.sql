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
-- citext y btree_gist los necesitan las migraciones de identity, institutions y
-- catalog. Se crean aqui, con el superusuario del contenedor: el rol de cada
-- servicio no tiene CREATE sobre la base (y no debe tenerlo), asi que no puede
-- instalar extensiones por su cuenta.
CREATE EXTENSION IF NOT EXISTS "citext";       -- correos y codigos sin distinguir mayusculas
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- EXCLUDE USING gist en salones

-- unaccent() es STABLE, no IMMUTABLE, porque depende del diccionario de busqueda
-- que este activo, y PostgreSQL rechaza funciones no inmutables dentro de la
-- expresion de un indice. Este envoltorio fija el diccionario de forma explicita
-- ("unaccent") y el search_path, con lo que el resultado si es reproducible y la
-- marca IMMUTABLE es honesta. Vive en public y la crea el superusuario porque la
-- comparten identity, institutions y catalog, y ningun rol de servicio puede
-- crear objetos aqui.
-- Consecuencia a tener presente: si algun dia se cambia el diccionario unaccent,
-- hay que REINDEX de los indices que la usan.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $fn$ SELECT public.unaccent('public.unaccent', $1) $fn$;

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
