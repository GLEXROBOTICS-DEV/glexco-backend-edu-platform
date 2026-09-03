import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Los paquetes del monorepo se publican como TypeScript sin compilar: Next los
  // transpila con el resto de la aplicacion. Compilarlos aparte solo anadiria un
  // paso de build sin ganar nada, porque solo los consume esta app.
  transpilePackages: ['@glexco/contracts', '@glexco/icons'],

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
};

export default config;
