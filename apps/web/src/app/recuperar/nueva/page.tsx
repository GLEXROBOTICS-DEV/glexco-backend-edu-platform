import type { Metadata } from 'next';
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

  if (!token) {
    return (
      <RegistrationShell step={0}>
        <div data-recovery="invalid">
          <h1 className="font-display text-2xl font-semibold">Este enlace no es válido</h1>
          <p className="mt-3 text-sm text-ink-700">
            Puede que se haya cortado al copiarlo. Pide uno nuevo y ábrelo directamente desde el
            correo.
          </p>
          <a
            href="/recuperar"
            className="btn btn-primary mt-6"
          >
            Pedir un enlace nuevo
          </a>
        </div>
      </RegistrationShell>
    );
  }

  return (
    <RegistrationShell step={0}>
      <h1 className="font-display text-2xl font-semibold">Elige una contraseña nueva</h1>
      <p className="mt-2 text-sm text-ink-500">
        Este enlace sirve una sola vez.
      </p>

      <NewPasswordForm token={token} />
    </RegistrationShell>
  );
}
