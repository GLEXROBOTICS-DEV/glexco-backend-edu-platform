import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { portalPath } from '../../lib/portal';
import { RegistrationShell } from '../registro/shell';
import { RequestForm } from './recovery-forms';

export const metadata: Metadata = { title: 'Recuperar mi contraseña' };

export default async function RecuperarPage() {
  // Quien ya tiene sesion no necesita recuperar nada: puede cambiarla desde su
  // cuenta, que ademas exige la actual y es mas seguro.
  const session = await getSession();
  if (session) redirect(portalPath(session.portal));

  return (
    <RegistrationShell step={0}>
      <h1 className="font-display text-2xl font-semibold">¿Olvidaste tu contraseña?</h1>
      <p className="mt-2 text-sm text-ink-500">
        Escribe tu correo y te enviamos un enlace para elegir una nueva.
      </p>

      <RequestForm />
    </RegistrationShell>
  );
}
