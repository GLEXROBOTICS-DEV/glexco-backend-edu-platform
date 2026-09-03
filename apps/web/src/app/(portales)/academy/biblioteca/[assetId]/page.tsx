import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { openLibraryAsset } from '../../../../../lib/catalog';
import { AssetViewer } from '../../../../../components/asset-viewer';

export const metadata: Metadata = { title: 'Material del kit' };

interface PageProps {
  params: Promise<{ assetId: string }>;
}

/**
 * Un recurso concreto.
 *
 * La URL firmada se pide AQUI, en cada visita, y caduca en quince minutos. Es la
 * razon de que esta pagina exista en vez de enlazar directamente desde la lista:
 * una direccion firmada incrustada en el listado estaria muerta antes de que el
 * alumno terminara de leer los titulos.
 */
export default async function AcademyRecurso({ params }: PageProps) {
  const { assetId } = await params;
  const asset = await openLibraryAsset(assetId);

  // Un recurso que no existe y uno que no es de su kit acaban en la MISMA
  // pantalla, igual que en el backend: distinguirlos permitiria recorrer el
  // catalogo probando identificadores.
  if (!asset) notFound();

  return <AssetViewer asset={asset} backHref="/academy/biblioteca" />;
}
