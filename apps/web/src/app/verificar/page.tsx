import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
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
  const t = await getTranslations('verificar');

  return (
    <RegistrationShell step={0}>
      <div className="text-center" data-verified={ok ? '1' : '0'}>
        <h1 className="font-display text-2xl font-semibold">
          {ok ? t('confirmado') : t('gastado')}
        </h1>
        <p className="mt-3 text-sm text-ink-700">
          {ok ? t('confirmadoAyuda') : t('gastadoAyuda')}
        </p>

        <a
          href="/ingresar"
          className="btn btn-primary mt-6"
        >
          {t('irAIngresar')}
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
