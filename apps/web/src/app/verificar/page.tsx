import type { Metadata } from 'next';
import { gatewayUrl } from '../../lib/api';
import { RegistrationShell } from '../registro/shell';

export const metadata: Metadata = { title: 'Confirmar mi correo' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Aterrizaje del enlace de verificacion.
 *
 * Se confirma en el SERVIDOR al abrir la pagina, sin pedir que se pulse nada
 * mas: quien llega aqui ya hizo el gesto de confirmar cuando abrio el correo, y
 * un segundo boton solo consigue que una parte de la gente no lo pulse y se
 * quede sin verificar creyendo que ya esta.
 *
 * El token es de un solo uso, asi que recargar muestra el mensaje de enlace
 * gastado. Se dice con claridad y con la salida al lado, porque el caso mas
 * comun de llegar dos veces es que la cuenta YA se verifico bien.
 */
export default async function VerificarPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params['token'];
  const token = typeof raw === 'string' ? raw : '';

  const ok = token ? await confirm(token) : false;

  return (
    <RegistrationShell step={0}>
      <div className="text-center" data-verified={ok ? '1' : '0'}>
        <h1 className="font-display text-2xl font-semibold">
          {ok ? 'Tu correo está confirmado' : 'Este enlace ya no sirve'}
        </h1>
        <p className="mt-3 text-sm text-ink-700">
          {ok
            ? 'Gracias. Ya puedes entrar a tu portal con tu correo y tu contraseña.'
            : 'Los enlaces de confirmación sirven una sola vez y caducan a los dos días. Si ya confirmaste tu cuenta, simplemente ingresa.'}
        </p>

        <a
          href="/ingresar"
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700"
        >
          Ir a ingresar
        </a>
      </div>
    </RegistrationShell>
  );
}

async function confirm(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl}/api/v1/auth/verify-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    console.error('No se pudo confirmar el correo', error);
    return false;
  }
}
