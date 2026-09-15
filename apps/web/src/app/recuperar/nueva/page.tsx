import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegistrationShell } from '../../registro/shell';
import { NewPasswordForm } from '../recovery-forms';

export const metadata: Metadata = { title: 'Elegir una contraseña nueva' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Aterrizaje del enlace de recuperacion.
 *
 * **El token NO se comprueba al abrir la pagina.** Es deliberado: comprobarlo
 * aqui lo gastaria —es de un solo uso— y el usuario se encontraria con que el
 * enlace ya no sirve justo cuando va a escribir su contrasena. Se envia junto
 * con la contrasena nueva, en una sola operacion, que es la unica forma de que
 * el gasto del token coincida con el cambio.
 */
export default async function NuevaContrasenaPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params['token'];
  const token = typeof raw === 'string' ? raw : '';
  const t = await getTranslations('recuperar');

  if (!token) {
    return (
      <RegistrationShell step={0}>
        <div data-recovery="invalid">
          <h1 className="font-display text-2xl font-semibold">{t('enlaceInvalido')}</h1>
          <p className="mt-3 text-sm text-ink-700">{t('enlaceInvalidoAyuda')}</p>
          <a
            href="/recuperar"
            className="btn btn-primary mt-6"
          >
            {t('pedirOtroEnlace')}
          </a>
        </div>
      </RegistrationShell>
    );
  }

  return (
    <RegistrationShell step={0}>
      <h1 className="font-display text-2xl font-semibold">{t('eligeNueva')}</h1>
      <p className="mt-2 text-sm text-ink-500">{t('unaSolaVez')}</p>

      <NewPasswordForm token={token} />
    </RegistrationShell>
  );
}
