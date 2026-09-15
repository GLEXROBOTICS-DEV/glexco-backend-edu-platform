import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PERMISSIONS } from '@glexco/contracts';
import { requireSession } from '../../../../lib/session';
import { fetchPlatformInstitutions } from '../../../../lib/analytics';
import { fetchAllKits } from '../../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../../components/ui';
import { PageHeader } from '../../../../components/page-header';
import { CodeBatchForm } from '../../../../components/admin-forms';

export const metadata: Metadata = { title: 'Códigos de activación' };

/**
 * Lotes de códigos: la operación con más consecuencias del panel.
 *
 * Cada código es un derecho de acceso pagado, y una vez impreso en un libro no
 * se puede cambiar. El endpoint existía desde la Fase 3 -con su transacción, su
 * evento de lote y su formato CSV- y no había forma de usarlo sin `curl`.
 *
 * **Los códigos se muestran una sola vez.** En la base solo queda su hash, así
 * que no hay endpoint para volver a descargarlos: es deliberado y obliga a que
 * esta pantalla los ponga delante y lo diga.
 */
export default async function AdminCodigos() {
  const session = await requireSession();

  if (!session.permissions.includes(PERMISSIONS.ACTIVATION_CODE_GENERATE)) {
    redirect('/admin');
  }

  const t = await getTranslations('admin');

  return (
    <>
      <PageHeader title={t('codigosTitulo')} subtitle={t('codigosSubtitulo')} />

      <Card>
        <SectionTitle id="nuevo">{t('generarLote')}</SectionTitle>
        <Suspense fallback={<CardSkeleton />}>
          <Formulario />
        </Suspense>
      </Card>
    </>
  );
}

async function Formulario() {
  const [kits, instituciones] = await Promise.all([
    fetchAllKits(),
    fetchPlatformInstitutions(),
  ]);
  const t = await getTranslations('admin');

  if (kits.failed || kits.items.length === 0) {
    return (
      <EmptyState
        level={3}
        title={t('sinKitsPublicados')}
        description={t('sinKitsPublicadosAyuda')}
      />
    );
  }

  return (
    <CodeBatchForm
      kits={kits.items}
      institutions={instituciones.items.map((institution) => ({
        id: institution.institutionId,
        name: institution.name ?? institution.institutionId.slice(0, 8),
      }))}
    />
  );
}
