import { Suspense } from 'react';
import { requireSession } from '../lib/session';
import { fetchSessions } from '../lib/profile';
import { PageHeader } from './page-header';
import { PasswordForm, SessionList } from './account';
import { SectionTitle } from './ui';

/**
 * "Mi cuenta", compartida por los cuatro portales.
 *
 * Es la misma pantalla para un alumno de ocho anos y para el equipo de GLEXCO
 * porque hace lo mismo: cambiar la contrasena y ver desde donde esta abierta la
 * sesion. Duplicarla por portal solo garantizaria que una de las copias se
 * quedara sin el arreglo la proxima vez.
 */
export async function AccountPage() {
  const session = await requireSession();

  return (
    <>
      <PageHeader
        title="Mi cuenta"
        subtitle={`${session.firstName} ${session.lastName} · ${session.email}`}
      />

      <section aria-labelledby="clave">
        <SectionTitle id="clave">Contraseña</SectionTitle>
        <PasswordForm />
      </section>

      <section aria-labelledby="sesiones">
        <SectionTitle id="sesiones">Dónde tienes la sesión abierta</SectionTitle>
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-ink-500">
          Si ves un dispositivo que no reconoces, ciérralo y cambia tu contraseña.
        </p>

        <Suspense fallback={<p className="text-sm text-ink-500">Cargando tus sesiones…</p>}>
          <Sessions />
        </Suspense>
      </section>
    </>
  );
}

async function Sessions() {
  const { items, failed } = await fetchSessions();

  if (failed) {
    return (
      <p className="text-sm text-ink-500">
        No pudimos leer tus sesiones ahora mismo. Vuelve a intentarlo en un momento.
      </p>
    );
  }

  return <SessionList sessions={items} />;
}
