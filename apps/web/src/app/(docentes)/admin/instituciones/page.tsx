import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PERMISSIONS } from '@glexco/contracts';
import { requireSession } from '../../../../lib/session';
import { fetchPlatformInstitutions } from '../../../../lib/analytics';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { InstitutionForm, LicenseForm } from '../../../../components/admin-forms';

export const metadata: Metadata = { title: 'Instituciones' };

/**
 * Instituciones: la cartera de clientes.
 *
 * `POST /institutions` y `POST /:id/licenses` existían desde la Fase 2 y no
 * tenían pantalla: dar de alta un colegio y concederle su licencia solo se podía
 * hacer con `curl`. Es la primera cosa que ocurre en la vida de un cliente y era
 * lo único que no se podía hacer desde la plataforma.
 *
 * El listado sale de la proyección de analítica y no del schema de instituciones
 * -que es lo que el invariante 9 prohíbe-, así que trae el nombre y las cifras
 * pero no el responsable ni el contacto. Para eso está la ficha del colegio, que
 * es del propio colegio.
 */
export default async function AdminInstituciones() {
  const session = await requireSession();

  // El permiso se comprueba aquí y NO solo se esconde el enlace: quien teclea la
  // URL llega igual, y el backend rechazaría cada acción con un 403 que se lee
  // como un fallo de la aplicación.
  if (!session.permissions.includes(PERMISSIONS.INSTITUTION_CREATE)) {
    redirect('/admin');
  }

  return (
    <>
      <PageHeader
        title="Instituciones"
        subtitle="Alta de colegios y sus licencias. Lo primero que ocurre en la vida de un cliente."
      />

      <Card>
        <SectionTitle id="nueva">Dar de alta un colegio</SectionTitle>
        <InstitutionForm />
      </Card>

      <Suspense fallback={<CardSkeleton />}>
        <Cartera />
      </Suspense>
    </>
  );
}

async function Cartera() {
  const { items, failed } = await fetchPlatformInstitutions();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos leer la cartera"
        description="Vuelve a intentarlo en un momento."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay colegios"
        description="El primero que des de alta aparecerá aquí con sus cifras."
      />
    );
  }

  return (
    <section aria-labelledby="cartera" data-institutions={items.length}>
      <SectionTitle id="cartera">Colegios ({items.length})</SectionTitle>

      <ul className="grid list-none gap-[var(--portal-gap)]">
        {items.map((institution) => (
          <li key={institution.institutionId}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-base font-semibold">
                    {/* Sin nombre y no ausente: un colegio con actividad cuyo
                        evento de alta es anterior a esta proyección sale sin
                        nombre, que es mejor que no salir. */}
                    {institution.name ?? institution.institutionId.slice(0, 8)}
                  </h3>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {[institution.city, institution.status].filter(Boolean).join(' · ')}
                  </p>
                </div>

                <dl className="flex flex-wrap gap-5 text-sm">
                  <div>
                    <dt className="text-xs text-ink-400">Salones</dt>
                    <dd className="tabular-nums font-medium">{institution.classrooms}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-400">Códigos emitidos</dt>
                    <dd className="tabular-nums font-medium">{institution.codesIssued ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-400">Activados</dt>
                    <dd className="tabular-nums font-medium">{institution.codesRedeemed ?? 0}</dd>
                  </div>
                </dl>
              </div>

              <div className="mt-5 border-t border-line-200 pt-5">
                <LicenseForm
                  institutionId={institution.institutionId}
                  institutionName={institution.shortName ?? institution.name ?? 'este colegio'}
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
