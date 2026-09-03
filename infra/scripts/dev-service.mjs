#!/usr/bin/env node
/**
 * Ejecuta un servicio en desarrollo compilando con `tsc`, no con un
 * transpilador rapido.
 *
 * **Por que no `tsx`.** tsx usa esbuild, y esbuild no implementa
 * `emitDecoratorMetadata`. Sin esa metadata, NestJS no sabe el tipo de los
 * parametros del constructor de un controlador y le inyecta `undefined` a
 * todos. El servicio arranca perfectamente, mapea sus rutas y pasa el health
 * check; el fallo aparece en la PRIMERA peticion, como
 * `Cannot read properties of undefined (reading 'execute')` y un 500 generico.
 *
 * Es la peor forma de fallo posible: silenciosa en el arranque, distinta entre
 * desarrollo y produccion (que si compila con tsc), y con un mensaje que no
 * apunta a la causa. Correr el mismo compilador en los dos entornos elimina la
 * clase entera de error, y cuesta unos segundos de arranque.
 *
 * Se escribe a mano en vez de anadir `concurrently` porque encadenar dos
 * procesos es todo lo que hace falta y este repositorio ya resuelve asi sus
 * utilidades (migrate, setup-env, smoke-test).
 *
 * Uso:  node infra/scripts/dev-service.mjs <servicio>
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = process.argv[2];

if (!service) {
  console.error('Uso: node infra/scripts/dev-service.mjs <servicio>');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serviceDir = join(repoRoot, 'services', service);

if (!existsSync(serviceDir)) {
  console.error(`No existe services/${service}.`);
  process.exit(1);
}

/** `shell: true` porque en Windows los binarios de node_modules/.bin son .cmd. */
function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: serviceDir,
    stdio: 'inherit',
    shell: true,
    ...options,
  });
}

const children = [];

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

// 1. Compilacion inicial completa. Se espera a que termine porque `node --watch`
//    necesita que dist/main.js exista antes de arrancar.
console.log(`[dev:${service}] compilando...`);

const firstBuild = run('tsc', ['-p', 'tsconfig.json']);

firstBuild.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[dev:${service}] la compilacion inicial fallo.`);
    shutdown(code ?? 1);
    return;
  }

  console.log(`[dev:${service}] compilado. Arrancando en modo vigilancia.`);

  // 2. tsc en vigilancia: reescribe dist/ ante cada cambio del codigo fuente.
  children.push(run('tsc', ['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']));

  // 3. node en vigilancia: reinicia el proceso cuando dist/ cambia. El .env se
  //    lee en cada reinicio, asi que tocar la configuracion tambien recarga.
  const app = run('node', [
    `--env-file-if-exists=${join(repoRoot, '.env')}`,
    '--watch',
    'dist/main.js',
  ]);

  children.push(app);
  app.on('exit', (appCode) => shutdown(appCode ?? 0));
});
