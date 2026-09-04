import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { portalPath } from '../../lib/portal';
import { BrandPanel } from '../../components/brand-panel';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Ingresar' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IngresarPage({ searchParams }: PageProps) {
  // Quien ya tiene sesion no ve el formulario: verlo invita a iniciar sesion
  // otra vez y crear una segunda sesion sin necesidad.
  const session = await getSession();
  if (session) redirect(portalPath(session.portal));

  // Se llega con esta marca cuando el alta salio bien pero el inicio de sesion
  // automatico no. Sin decirlo, el alumno cree que el registro fallo, lo
  // reintenta y choca con "ese correo ya esta registrado".
  const params = await searchParams;
  const justRegistered = params['registrado'] === '1';
  // Se llega asi tras cambiar la contrasena. NO se inicia sesion automatica: el
  // restablecimiento suele hacerse porque alguien pudo tomar la cuenta, y la
  // contrasena nueva es lo unico que demuestra quien es.
  const justReset = params['restablecida'] === '1';

  return (
    <main id="contenido" className="flex min-h-dvh flex-col lg:flex-row">
      <BrandPanel
        headline="El aula donde la robótica se aprende haciendo"
        description="Cursos, retos y proyectos para acompañar a docentes y alumnos con los kits uKit, uGoT, Yanshee y toda la línea GLEXCO – UBTECH."
      />

      <section className="flex flex-1 items-center justify-center bg-surface-50 px-6 py-12">
        <div className="w-full max-w-[26.5rem]">
          {/* La marca tambien en movil, donde el panel no se ve: sin ella la
              primera pantalla de la plataforma no dice de quien es. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/glexco-marca.svg"
            alt="GLEXCO"
            width={168}
            height={34}
            className="mb-8 block w-[10.5rem] lg:hidden"
          />

          <h1 className="font-display text-[1.875rem] font-semibold">Bienvenido de vuelta</h1>
          <p className="mt-2 text-[15px] text-ink-500">Ingresa a tu cuenta para continuar.</p>

          {justReset ? (
            <p
              role="status"
              data-reset="1"
              className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
            >
              Tu contraseña ya está cambiada. Ingresa con la nueva.
            </p>
          ) : null}

          {justRegistered ? (
            <p
              role="status"
              data-registered="1"
              className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
            >
              Tu cuenta ya está creada. Ingresa con el correo y la contraseña que acabas de elegir.
            </p>
          ) : null}

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
