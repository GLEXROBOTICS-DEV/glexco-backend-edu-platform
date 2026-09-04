-- Nombre del alumno, para el certificado.
--
-- Va en su PROPIA migracion y no anadido a la 0002 porque la 0002 ya estaba
-- aplicada en produccion: el ejecutor las marca por nombre de archivo, asi que
-- todo lo que se anade a una migracion ya aplicada no se ejecuta nunca y ademas
-- no avisa. El sintoma fue "relation learning.student_directory does not exist"
-- despues de un despliegue que dijo que habia ido bien.
--
-- `classroom_members.full_name` se rellena desde el evento de matricula, y ese
-- evento NO trae el nombre: llegaba siempre vacio. Salio a la luz emitiendo un
-- certificado a nombre de nadie, que es lo unico que un certificado no puede
-- ser.
--
-- Se alimenta de los eventos de identidad, igual que hace instituciones, y no de
-- la matricula: un cambio de nombre ocurre despues de matricularse, y la
-- matricula solo se emite una vez.
CREATE TABLE IF NOT EXISTS student_directory (
  user_id    uuid PRIMARY KEY,
  full_name  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
