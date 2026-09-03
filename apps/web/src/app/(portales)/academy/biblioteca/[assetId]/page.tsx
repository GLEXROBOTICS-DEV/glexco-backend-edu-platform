import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { openLibraryAsset } from '../../../../../lib/catalog';
import { startLesson } from '../../../../../lib/learning.actions';
import { fetchMyClassroom } from '../../../../../lib/classrooms';
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

  // Abrir la leccion se registra al RENDERIZAR, no al pulsar nada: el hecho que
  // interesa es "la abrio", y exigir un clic extra mediria quien pulsa botones y
  // no quien entra al contenido. Nunca falla hacia el alumno: registrar que
  // abrio algo no puede impedirle verlo.
  const lessonId = asset.lessonId;
  let completed = false;

  if (lessonId) {
    // El salon hace falta para que el progreso aparezca en la lista del docente.
    // Es `null` en una cuenta independiente, que es la mitad del modelo de
    // negocio y tiene que funcionar igual.
    const classroomId = await fetchMyClassroom();
    const opened = await startLesson({ lessonId, classroomId });
    completed = opened.alreadyCompleted;
  }

  return (
    <AssetViewer
      asset={asset}
      backHref="/academy/biblioteca"
      portal="academy"
      lessonId={lessonId}
      lessonCompleted={completed}
    />
  );
}
