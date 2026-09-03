import type { NextConfig } from 'next';

const config: NextConfig = {
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

export default config;
