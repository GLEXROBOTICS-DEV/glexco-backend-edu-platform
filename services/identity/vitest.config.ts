import { defineConfig } from 'vitest/config';

/**
 * Las pruebas del dominio y de los casos de uso no necesitan base de datos ni
 * Redis: usan implementaciones en memoria de los puertos. Por eso el entorno es
 * 'node' pelado y no hay `globalSetup` que levante contenedores.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Si una prueba unitaria tarda mas de un segundo, es que se colo una
    // dependencia real: mejor que falle a que la suite se vuelva lenta.
    testTimeout: 1_000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/application/**'],
      reporter: ['text', 'html'],
    },
  },
});
