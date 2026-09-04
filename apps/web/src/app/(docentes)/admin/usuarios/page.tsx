import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { ROLE_CREATION_MATRIX, type Role } from '@glexco/contracts';
import { requireSession } from '../../../../lib/session';
import { fetchPlatformInstitutions } from '../../../../lib/analytics';
import { Card, CardSkeleton, SectionTitle } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { StaffForm } from '../../../../components/admin-forms';

export const metadata: Metadata = { title: 'Cuentas de personal' };

/** Nombres visibles de los roles. La clave es la que guarda el backend. */
const ROLE_LABELS: Record<string, string> = {
  platform_owner: 'Dueño de plataforma',
  platform_admin: 'Administrador de GLEXCO',
  content_manager: 'Equipo de contenidos',
  support_agent: 'Soporte',
  commercial_agent: 'Comercial',
  institution_admin: 'Dirección de colegio',
  teacher: 'Docente',
};

/**
 * Cuentas de personal.
 *
 * `POST /account/staff` llevaba fases construido -con su matriz de qué rol puede
 * crear qué- y no lo llamaba nadie: la única forma de dar de alta a un docente
 * era que se registrara él como alumno, que es exactamente lo que la matriz
 * existe para evitar.
 *
 * **Los roles que se ofrecen salen de `ROLE_CREATION_MATRIX`**, la misma tabla
 * que el backend usa para rechazar. No es una copia: se importa. Ofrecer un rol
 * que el servidor va a rechazar convierte un límite correcto en un error
 * aparente de la aplicación.
 */
export default async function AdminUsuarios() {
  const session = await requireSession();

  const creables = [
    ...new Set(
      session.roles.flatMap((role) => ROLE_CREATION_MATRIX[role as Role] ?? []),
    ),
  ].filter((role) => role !== 'student');

  // Quien no puede crear ningún rol no tiene nada que hacer aquí. Se redirige y
  // no se muestra un formulario que va a fallar en cada envío.
  if (creables.length === 0) redirect('/admin');

  const roles = creables.map((role) => ({
    value: role,
    label: ROLE_LABELS[role] ?? role,
  }));

  return (
    <>
      <PageHeader
        title="Cuentas de personal"
        subtitle="Docentes, dirección y equipo de GLEXCO. Los alumnos se registran con el código de su libro."
      />

      <Card>
        <SectionTitle id="nueva">Crear una cuenta</SectionTitle>
        <Suspense fallback={<CardSkeleton />}>
          <Formulario roles={roles} />
        </Suspense>
      </Card>
    </>
  );
}

async function Formulario({ roles }: { roles: { value: string; label: string }[] }) {
  const { items } = await fetchPlatformInstitutions();

  return (
    <StaffForm
      roles={roles}
      institutions={items.map((institution) => ({
        id: institution.institutionId,
        name: institution.name ?? institution.institutionId.slice(0, 8),
      }))}
    />
  );
}
