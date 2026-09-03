import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { portalPath } from '../../lib/portal';
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
      {/* Panel de marca. Se oculta en movil: en una pantalla pequena, media
          altura de decoracion empuja el formulario fuera de la vista. */}
      <section
        className="hidden bg-gradient-to-br from-brand-900 via-brand-600 to-brand-400 p-12 lg:flex lg:w-[45%] lg:flex-col lg:justify-between"
        aria-hidden="true"
      >
        <div className="font-display text-3xl font-bold text-white">GLEXCO</div>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight text-white">
            La robótica que se aprende construyendo.
          </p>
          <p className="mt-4 max-w-md text-lg text-brand-200">
            Activa el código de tu libro y entra al kit de tu grado.
          </p>
        </div>
        <div className="text-sm text-brand-200">Robótica educativa · UBTECH</div>
      </section>

      <section className="flex flex-1 items-center justify-center bg-surface-50 px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-2xl font-semibold">Ingresa a tu cuenta</h1>
          <p className="mt-2 text-sm text-ink-500">
            Usa el correo con el que te registraste.
          </p>

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
