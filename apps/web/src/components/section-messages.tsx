import type { AbstractIntlMessages } from 'next-intl';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

/**
 * Los espacios que necesita el navegador en CUALQUIER pantalla.
 *
 * Se declara la lista en vez de deducirla: no hay forma de saber en compilacion
 * que claves pide un componente de cliente, y una heuristica que se equivocara
 * en silencio es peor que una lista que hay que mantener a mano.
 *
 * Aqui va solo lo que usan las piezas comunes -el marco, el selector de tema y
 * de idioma, la barra-. Lo que usa una sola seccion va en su `SectionMessages`.
 */
export const BASE_CLIENT_NAMESPACES = [
  'comun',
  'tema',
  'idioma',
  'nav',
  'evaluacion',
  'cuenta',
  'muro',
] as const;

export function pick(
  messages: AbstractIntlMessages,
  spaces: readonly string[],
): AbstractIntlMessages {
  const subset: AbstractIntlMessages = {};
  for (const space of spaces) {
    if (messages[space] !== undefined) subset[space] = messages[space];
  }
  return subset;
}

/**
 * Anade los espacios de una seccion al catalogo que llega al navegador.
 *
 * Existe porque `messages` se serializa dentro del HTML de CADA pagina: meter
 * los espacios del Teacher Center o del Admin en la lista base haria que un
 * alumno de primaria se descargue las cadenas del panel de administracion en
 * cada carga. Es el mismo criterio por el que los graficos son SVG propio en
 * vez de una libreria de 150 KB.
 *
 * **Incluye siempre la lista base.** Un proveedor anidado REEMPLAZA el catalogo
 * del de arriba para todo lo que cuelgue de el; sin repetirla, un boton comun
 * dentro de la seccion perderia sus propias claves y pintaria el identificador.
 */
export async function SectionMessages({
  spaces,
  children,
}: {
  spaces: readonly string[];
  children: React.ReactNode;
}) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={pick(messages, [...BASE_CLIENT_NAMESPACES, ...spaces])}>
      {children}
    </NextIntlClientProvider>
  );
}
