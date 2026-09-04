import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountPage } from '../../../../components/account-page';

/**
 * El titulo de la pestana, traducido.
 *
 * `metadata` es una constante y no puede pedir el traductor, asi que hace falta
 * `generateMetadata`. Se hace aqui porque es la pantalla donde el usuario CAMBIA
 * el idioma: ver la pestana en el idioma viejo justo despues de cambiarlo es la
 * peor confirmacion posible de que el cambio funciono.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('cuenta');
  return { title: t('titulo') };
}

export default function AcademyCuenta() {
  return <AccountPage />;
}
