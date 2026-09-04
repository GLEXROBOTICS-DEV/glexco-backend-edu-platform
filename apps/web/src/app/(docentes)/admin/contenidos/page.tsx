import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PERMISSIONS } from '@glexco/contracts';
import { requireSession } from '../../../../lib/session';
import { fetchAllKits, gradeLabel } from '../../../../lib/catalog';
import { getTranslations } from 'next-intl/server';
import { Card, CardSkeleton, EmptyState, SectionTitle, StatePill } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { ContentStatusForm } from '../../../../components/admin-forms';

export const metadata: Metadata = { title: 'Contenidos' };

/**
 * Contenidos: qué está publicado y qué no.
 *
 * `POST /catalog/content/:id/status` llevaba fases construido -con su tabla de
 * transiciones y su invalidación de caché- y no lo llamaba nadie. Y hasta hace
 * poco no aceptaba kits: publicar un kit no existía como operación, así que
 * `catalog.kit.published.v1` no lo emitía nadie y el panel listaba los kits por
 * UUID.
 *
 * Lo que esta pantalla NO permite es saltar de borrador a publicado. La tabla
 * está en el backend porque este contenido lo ven niños de seis años y la
 * revisión es el único punto donde alguien distinto del autor lo mira antes de
 * que llegue a un aula.
 */
export default async function AdminContenidos() {
  const session = await requireSession();

  if (!session.permissions.includes(PERMISSIONS.CONTENT_PUBLISH)) {
    redirect('/admin');
  }

  return (
    <>
      <PageHeader
        title="Contenidos"
        subtitle="Kits y su estado de publicación. Un borrador pasa por revisión antes de llegar a un aula."
      />

      <Suspense fallback={<CardSkeleton />}>
        <Kits />
      </Suspense>
    </>
  );
}

const ESTADOS: Record<string, { label: string; state: 'done' | 'doing' | 'idle' | 'late' }> = {
  published: { label: 'Publicado', state: 'done' },
  in_review: { label: 'En revisión', state: 'doing' },
  draft: { label: 'Borrador', state: 'idle' },
  archived: { label: 'Archivado', state: 'late' },
};

async function Kits() {
  const { items, failed } = await fetchAllKits({ includeUnpublished: true });
  const vocab = await getTranslations();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos leer el catálogo"
        description="Vuelve a intentarlo en un momento."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay kits"
        description="Los kits se crean con el contenido del libro de cada grado."
      />
    );
  }

  return (
    <section aria-labelledby="kits" data-kits={items.length}>
      <SectionTitle id="kits">Kits ({items.length})</SectionTitle>

      <ul className="grid list-none gap-3">
        {items.map((kit) => {
          const estado = ESTADOS[kit.status ?? 'draft'] ?? ESTADOS.draft!;

          return (
            <li key={kit.kitId}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold">{kit.name}</h3>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {[kit.code, gradeLabel(vocab, kit.grade)].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  {/* El estado con su palabra: cuatro estados en cuatro colores
                      no los distingue nadie, y el par borrador/archivado en dos
                      grises menos. */}
                  <StatePill state={estado.state}>{estado.label}</StatePill>
                </div>

                <div className="mt-4">
                  <ContentStatusForm id={kit.kitId} target="kit" status={kit.status ?? 'draft'} />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
