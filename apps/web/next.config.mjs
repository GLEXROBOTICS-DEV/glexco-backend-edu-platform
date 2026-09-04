import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Configuracion de Next.
 *
 * **En `.mjs` y no en `.ts`, a proposito.** Next necesita TypeScript EN
 * EJECUCION para leer un `next.config.ts`, y en la imagen de produccion las
 * dependencias de desarrollo no estan: al arrancar, Next detectaba que faltaba y
 * se ponia a instalarlo con yarn dentro del contenedor. Eso falla en cuanto el
 * sistema de archivos es de solo lectura o no hay salida a internet, y cuando
 * funciona alarga cada arranque con una instalacion que no pinta nada ahi.
 *
 * La anotacion de tipo se conserva como JSDoc, asi que el editor sigue
 * autocompletando y avisando de una opcion mal escrita.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Desarrollo y produccion escriben en carpetas distintas.
   *
   * Con la de por defecto, un `pnpm build` del monorepo mientras corre
   * `next dev` sobreescribe el `.next` que el servidor de desarrollo tiene
   * abierto, y este empieza a fallar con `Cannot find module './735.js'`:
   * errores 500 en paginas que estaban bien, con un mensaje que no apunta a
   * nada. En un monorepo donde compilar todo es lo normal, eso pasa cada dia.
   */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  // Los paquetes del monorepo se publican como TypeScript sin compilar: Next los
  // transpila con el resto de la aplicacion. Compilarlos aparte solo anadiria un
  // paso de build sin ganar nada, porque solo los consume esta app.
  transpilePackages: ['@glexco/contracts', '@glexco/icons'],

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

/**
 * next-intl, apuntando a `src/i18n/request.ts`.
 *
 * **Sin enrutado por idioma.** El montaje por defecto antepone `/es/` y `/en/` a
 * todas las rutas; aqui el idioma sale del perfil del usuario, que es donde ya
 * vivia. Ver la explicacion completa en `src/i18n/request.ts`.
 */
const withIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withIntl(config);
