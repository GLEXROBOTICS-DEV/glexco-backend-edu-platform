import { createHash, randomInt } from 'node:crypto';
import {
  ACTIVATION_CODE_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  ACTIVATION_CODE_PREFIX,
} from '@glexco/contracts';
import { ActivationCodeValue } from './activation-code.aggregate';

/**
 * Generacion y hasheo de codigos de activacion.
 *
 * Es un servicio de dominio y no un metodo del agregado porque genera codigos
 * ANTES de que exista el agregado, y porque un lote se genera de miles en miles
 * para una imprenta.
 */

/**
 * Genera un codigo aleatorio.
 *
 * Usa `randomInt` de `node:crypto`, no `Math.random()`. La diferencia no es
 * teorica: `Math.random()` es un generador predecible sembrado por el proceso, y
 * quien observe unos cuantos codigos de un lote podria predecir el resto. Aqui
 * cada codigo vale el precio de un libro.
 *
 * `randomInt(max)` ademas evita el sesgo modulo que introduciria hacer
 * `bytes[i] % alfabeto.length`: con 31 simbolos y bytes de 0-255, los primeros
 * simbolos del alfabeto saldrian mas a menudo, y eso reduce la entropia real.
 */
export function generateActivationCode(): ActivationCodeValue {
  let body = '';
  for (let i = 0; i < ACTIVATION_CODE_LENGTH; i += 1) {
    body += ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)];
  }
  return ActivationCodeValue.create(`${ACTIVATION_CODE_PREFIX}${body}`);
}

/**
 * Hash con el que se guarda y se busca el codigo.
 *
 * SHA-256 y no Argon2, a diferencia de las contrasenas. El motivo es que el
 * codigo tiene ~60 bits de entropia genuinamente aleatoria: no hay diccionario
 * que atacar, asi que un hash lento solo anadiria latencia al registro sin
 * subir el coste de ningun ataque realista.
 *
 * Se aplica una sal fija de la plataforma (pimienta) para que un volcado de la
 * base no se pueda cruzar con tablas precalculadas de SHA-256 si algun dia el
 * espacio de codigos se redujera. Va en configuracion, no en la base, para que
 * robar la base no baste.
 */
export function hashActivationCode(code: ActivationCodeValue, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${code.value}`).digest('hex');
}

/** Ultimos cuatro caracteres, para que soporte identifique un codigo con el
 *  cliente al telefono sin poder reconstruirlo. */
export function suffixOf(code: ActivationCodeValue): string {
  return code.value.slice(-4);
}

export interface GeneratedCode {
  code: ActivationCodeValue;
  hash: string;
  suffix: string;
}

/**
 * Genera un lote de codigos unicos.
 *
 * La comprobacion de unicidad se hace DENTRO del lote y ademas la refuerza el
 * indice unico de la base. Con 31^12 posibilidades, una colision dentro de un
 * lote de cien mil es astronomicamente improbable (paradoja del cumpleanos:
 * ~10^-8), pero la comprobacion cuesta nada y convierte un fallo imposible de
 * diagnosticar en uno que no ocurre.
 *
 * Devuelve los codigos EN CLARO. Es la unica vez que existen: quien llama los
 * exporta para la imprenta y no vuelven a estar disponibles, porque en la base
 * solo queda el hash.
 */
export function generateBatch(size: number, pepper: string): GeneratedCode[] {
  if (!Number.isInteger(size) || size < 1 || size > 100_000) {
    throw new RangeError('El tamano del lote debe ser un entero entre 1 y 100000.');
  }

  const seen = new Set<string>();
  const generated: GeneratedCode[] = [];

  while (generated.length < size) {
    const code = generateActivationCode();
    if (seen.has(code.value)) continue;

    seen.add(code.value);
    generated.push({
      code,
      hash: hashActivationCode(code, pepper),
      suffix: suffixOf(code),
    });
  }

  return generated;
}
