-- Quien escribio cada cosa del muro.
--
-- El muro es una conversacion entre companeros, asi que sin nombres no sirve
-- para nada: la primera version resolvia los nombres llamando al listado de
-- matricula de instituciones, y ese endpoint es de DOCENTES. Un alumno recibia
-- `INSUFFICIENT_PERMISSIONS` y veia el muro entero firmado por "un companero".
--
-- La respuesta correcta es que engagement devuelva lo que muestra, sin que el
-- portal tenga que preguntarselo a otro servicio con otro permiso. Se alimenta
-- de los eventos de identidad, como los directorios equivalentes de
-- instituciones y aprendizaje.
--
-- Es la TERCERA vez que hace falta un directorio de nombres en un servicio, y
-- las tres veces hubo que rellenarlo a mano desde el sembrador porque JetStream
-- no reproduce hacia atras. Eso ya no es una coincidencia: es la senal de que
-- falta el comando de reconstruccion de proyecciones, anotado en TRASPASO.md.
CREATE TABLE IF NOT EXISTS author_directory (
  user_id    uuid PRIMARY KEY,
  full_name  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
