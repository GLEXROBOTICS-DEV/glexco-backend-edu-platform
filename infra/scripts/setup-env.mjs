#!/usr/bin/env node
/**
 * Genera un `.env` local a partir de `.env.example`, con secretos reales.
 *
 * Existe porque el paso manual "copia el ejemplo y cambia los secretos" se salta
 * siempre. El resultado es un entorno con `JWT_ACCESS_SECRET=cambiar-en-produccion`,
 * que en local no molesta pero acaba copiado a un despliegue real. Aqui los
 * secretos se generan con `crypto.randomBytes`, que es lo mismo que haria
 * `openssl rand -base64 48`.
 *
 * Nunca sobrescribe un `.env` existente: perder los secretos de un entorno que
 * ya tiene datos significa invalidar todas las sesiones y todos los enlaces de
 * verificacion pendientes.
 *
 * Uso: pnpm setup
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplePath = join(repoRoot, '.env.example');
const envPath = join(repoRoot, '.env');

if (existsSync(envPath)) {
  console.log('Ya existe un archivo .env; no se toca.');
  console.log('Si quieres regenerarlo, borralo primero (perderas los secretos actuales).');
  process.exit(0);
}

const secret = () => randomBytes(48).toString('base64');

/** Variables cuyo valor de ejemplo debe sustituirse por un secreto real. */
const GENERATED = {
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  SIGNING_SECRET: secret(),
  INTERNAL_SERVICE_TOKEN: secret(),
  // Si esta cambia, todos los codigos ya emitidos dejan de validar.
  ACTIVATION_CODE_PEPPER: secret(),
};

let content = await readFile(examplePath, 'utf8');

for (const [name, value] of Object.entries(GENERATED)) {
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(content)) {
    content = content.replace(pattern, `${name}=${value}`);
  } else {
    content += `\n${name}=${value}\n`;
  }
}

await writeFile(envPath, content, 'utf8');

console.log('Archivo .env creado con secretos generados.');
console.log('');
console.log('Siguientes pasos:');
console.log('  pnpm infra:up                              # Postgres, Redis, NATS, MinIO, Mailpit');
console.log('  pnpm --filter @glexco/identity db:migrate  # aplicar el esquema');
console.log('  pnpm --filter @glexco/identity dev         # arrancar identidad');
console.log('  pnpm smoke:direct                          # prueba de humo');
console.log('');
console.log('Recuerda: .env esta en .gitignore y nunca debe subirse al repositorio.');
