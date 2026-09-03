import type { Metadata } from 'next';
import { ActivationForm } from '../../../../components/activation-form';

export const metadata: Metadata = { title: 'Activar mi código' };

export default function AcademyActivar() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        Activar código
      </h1>
      <p className="max-w-md text-sm text-ink-500">
        Un libro por grado. Al activarlo se desbloquea el kit que le corresponde.
      </p>

      <ActivationForm portal="academy" />
    </>
  );
}
