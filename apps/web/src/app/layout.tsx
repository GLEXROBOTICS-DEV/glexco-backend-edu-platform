import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GLEXCO',
    template: '%s · GLEXCO',
  },
  description: 'Plataforma educativa de robotica GLEXCO.',
  // Los portales de alumno no se indexan: son contenido de pago tras
  // autenticacion y su aparicion en un buscador no aporta nada.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#2C53A0',
  // `maximumScale` se deja libre a proposito: fijarlo impide ampliar en el
  // movil, y eso deja fuera a quien lo necesita para leer.
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // El idioma sale del perfil del usuario -o de la cookie si no hay sesion-, no
  // de la URL. Ver `src/i18n/request.ts`.
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations('comun');

  return (
    // `lang` de verdad y no un "es" fijo: es lo que decide como pronuncia un
    // lector de pantalla y como parte las palabras el navegador. Con el idioma
    // mal declarado, una interfaz en ingles se lee con fonetica espanola.
    <html lang={locale}>
      <head>
        {/* Las fuentes se precargan desde el propio origen del proveedor con
            `preconnect`: sin esto, la primera pintura espera a la resolucion DNS
            y el salto de fuente se nota en cada carga. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        {/*
          Aplica el tema guardado ANTES de pintar.

          Es la unica pieza de JavaScript en linea de toda la aplicacion, y esta
          aqui porque no hay otra forma: si el tema se aplicara al hidratar, quien
          eligio oscuro veria un destello blanco a pantalla completa en cada
          navegacion. Es corto, no depende de nada y no bloquea: lee una clave y
          pone un atributo.

          Sin JavaScript no se ejecuta y manda `prefers-color-scheme`, que es el
          comportamiento correcto: la preferencia del sistema.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('glexco:theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}}catch(e){}})();`,
          }}
        />
        {/* Salto al contenido: quien navega con teclado no deberia recorrer la
            barra lateral entera en cada pagina para llegar a lo que importa. */}
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          {t('saltarAlContenido')}
        </a>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
