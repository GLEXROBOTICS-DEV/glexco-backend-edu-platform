import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '@glexco/kernel';

/**
 * Hasheo de contrasenas.
 *
 * **Argon2id por defecto**, no bcrypt. El cliente menciono bcrypt como ejemplo
 * de "hacerlo bien", y bcrypt sigue siendo aceptable, pero Argon2id es la
 * recomendacion actual de OWASP por una razon concreta: bcrypt solo es costoso
 * en CPU, y una GPU o un ASIC paralelizan eso barato. Argon2id ademas exige
 * MEMORIA (19 MiB por hash con estos parametros), y la memoria es cara de
 * paralelizar en hardware especializado. Eso multiplica el coste real de un
 * ataque por diccionario sobre una base filtrada.
 *
 * Se mantiene bcrypt como implementacion alternativa por dos motivos: permite
 * importar usuarios de un sistema anterior que ya use bcrypt, y deja la decision
 * reversible si Argon2 diera problemas de memoria en instancias pequenas.
 *
 * **Migracion sin fricciones:** `needsRehash` detecta hashes con parametros
 * obsoletos (o de bcrypt) y el caso de uso de inicio de sesion los recalcula
 * aprovechando que en ese instante tiene la contrasena en claro. Asi toda la
 * base se endurece sola, sin pedir a nadie que cambie su contrasena.
 */
export interface PasswordHasherOptions {
  algorithm: 'argon2id' | 'bcrypt';
  argon2: {
    /** Memoria en KiB. 19456 (19 MiB) es el minimo recomendado por OWASP. */
    memoryKiB: number;
    /** Numero de pasadas. */
    timeCost: number;
    /** Hilos. Se deja en 1: en un servidor con muchas peticiones concurrentes,
     *  el paralelismo por hash compite consigo mismo y no aporta. */
    parallelism: number;
  };
  bcryptRounds: number;
}

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly options: PasswordHasherOptions) {}

  async hash(plain: string): Promise<string> {
    if (this.options.algorithm === 'bcrypt') {
      // bcrypt trunca silenciosamente en 72 bytes. Truncar aqui de forma
      // explicita evita el fallo sutil de que dos contrasenas largas distintas
      // con el mismo prefijo se validen la una por la otra.
      return bcrypt.hash(plain.slice(0, 72), this.options.bcryptRounds);
    }

    return argonHash(plain, {
      algorithm: Algorithm.Argon2id,
      memoryCost: this.options.argon2.memoryKiB,
      timeCost: this.options.argon2.timeCost,
      parallelism: this.options.argon2.parallelism,
    });
  }

  /**
   * Verifica contra el algoritmo con el que se creo el hash, no contra el
   * configurado. Es lo que permite que conviva una base migrada a medias.
   */
  async verify(plain: string, hashed: string): Promise<boolean> {
    try {
      if (hashed.startsWith('$argon2')) {
        return await argonVerify(hashed, plain);
      }
      if (hashed.startsWith('$2a$') || hashed.startsWith('$2b$') || hashed.startsWith('$2y$')) {
        return await bcrypt.compare(plain.slice(0, 72), hashed);
      }
      return false;
    } catch {
      // Un hash corrupto o un formato desconocido se tratan como "no coincide".
      // Propagar el error revelaria, por la diferencia de respuesta, que ese
      // usuario existe y tiene un hash malformado.
      return false;
    }
  }

  /**
   * Indica si el hash debe recalcularse.
   *
   * Devuelve `true` cuando:
   *  - el hash es de bcrypt y la configuracion actual es argon2 (migracion), o
   *  - es argon2 pero con menos memoria o menos pasadas de las configuradas
   *    (endurecimiento posterior de parametros).
   */
  needsRehash(hashed: string): boolean {
    if (this.options.algorithm === 'argon2id') {
      if (!hashed.startsWith('$argon2id')) return true;

      const params = parseArgonParams(hashed);
      if (!params) return true;

      return (
        params.memoryKiB < this.options.argon2.memoryKiB ||
        params.timeCost < this.options.argon2.timeCost
      );
    }

    if (!hashed.startsWith('$2')) return true;
    const rounds = parseBcryptRounds(hashed);
    return rounds === null || rounds < this.options.bcryptRounds;
  }
}

/** Formato: `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>` */
function parseArgonParams(hashed: string): { memoryKiB: number; timeCost: number } | null {
  const match = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(hashed);
  if (!match) return null;
  return { memoryKiB: Number(match[1]), timeCost: Number(match[2]) };
}

/** Formato: `$2b$12$<sal+hash>` */
function parseBcryptRounds(hashed: string): number | null {
  const match = /^\$2[aby]?\$(\d{2})\$/.exec(hashed);
  return match ? Number(match[1]) : null;
}
