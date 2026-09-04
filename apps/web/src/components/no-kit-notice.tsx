import { getTranslations } from 'next-intl/server';
import { KitIcon } from '@glexco/icons';
import { fetchMyKits } from '../lib/catalog';
import { EmptyState } from './ui';

/**
 * Aviso de "todavia no has activado ningun kit".
 *
 * Va en la portada de los dos portales y es lo unico que se le puede ofrecer a
 * quien entra sin contenido: sin kit no hay cursos, ni evaluaciones, ni
 * biblioteca, asi que el resto de la pantalla se le queda vacia. Si esta
 * pantalla no le diera el siguiente paso, un alumno recien registrado se
 * quedaria mirando una portada en blanco sin saber que le falta escribir el
 * codigo de su libro.
 *
 * Devuelve null cuando SI tiene kits: no es un estado vacio de una seccion, es
 * un desvio que solo aparece cuando hace falta.
 */
export async function NoKitNotice({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();
  const t = await getTranslations('sinKit');

  // Si la llamada fallo no se dice "no tienes kits": seria acusar al alumno de
  // no haber activado nada cuando el problema es nuestro.
  if (failed || kits.length > 0) return null;

  return (
    <EmptyState
      icon={<KitIcon size={32} />}
      title={portal === 'discover' ? t('tituloDiscover') : t('tituloAcademy')}
      description={t('descripcion')}
      action={{ href: `/${portal}/activar`, label: t('accion') }}
    />
  );
}
