import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { ValidationError } from '@glexco/kernel';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@glexco/contracts';
import type { PasswordPolicy } from '../../application/ports';

/**
 * Politica de contrasenas segun NIST SP 800-63B.
 *
 * Lo que NO se hace, y por que:
 *
 * - **No se exigen mayusculas, digitos ni simbolos.** Las reglas de composicion
 *   producen "Password1!" de forma sistematica, que esta en el top 100 de
 *   cualquier diccionario de ataque. Ademas, aqui hay ninos de 6 anos: una regla
 *   que obliga a un simbolo genera contrasenas apuntadas en un papel, que es peor
 *   que una contrasena mediocre memorizada.
 *
 * - **No se fuerza la caducidad periodica.** Obligar a cambiar cada 90 dias hace
 *   que la gente pase de "Verano2025" a "Verano2026". El cambio se fuerza solo
 *   cuando hay indicio de compromiso.
 *
 * Lo que SI se hace es lo que de verdad reduce el riesgo: rechazar contrasenas
 * conocidas y contrasenas que contienen los datos personales del propio usuario.
 */
export class DefaultPasswordPolicy implements PasswordPolicy {
  /**
   * Lista mínima en memoria para el arranque en local y como red de seguridad si
   * la consulta a la base falla. La lista real (decenas de miles de entradas de
   * filtraciones conocidas) vive en la tabla `identity.weak_passwords`.
   */
  private static readonly ALWAYS_REJECTED = new Set([
    '12345678',
    '123456789',
    'password',
    'contrasena',
    'contraseña',
    'qwertyui',
    'iloveyou',
    'password1',
    'admin123',
    'glexco123',
    'robotica',
    'estudiante',
    '11111111',
    'abcd1234',
  ]);

  constructor(private readonly readPool?: Pool) {}

  async assertAcceptable(input: {
    password: string;
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<void> {
    const password = input.password;
    const normalized = password.trim().toLowerCase();

    if (password.length < PASSWORD_MIN_LENGTH) {
      throw new ValidationError(
        'PASSWORD_TOO_SHORT',
        `La contrasena debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
        { field: 'password', minLength: PASSWORD_MIN_LENGTH },
      );
    }

    if (password.length > PASSWORD_MAX_LENGTH) {
      throw new ValidationError(
        'PASSWORD_TOO_LONG',
        `La contrasena no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`,
        { field: 'password', maxLength: PASSWORD_MAX_LENGTH },
      );
    }

    if (DefaultPasswordPolicy.ALWAYS_REJECTED.has(normalized)) {
      throw weakPassword();
    }

    // Contrasenas construidas con los propios datos del usuario. Es lo primero
    // que prueba un atacante que ya conoce el nombre y el correo, y en un colegio
    // esos datos los conoce cualquier companero de clase.
    const personalTokens = [
      input.firstName.toLowerCase(),
      input.lastName.toLowerCase(),
      input.email.split('@')[0]?.toLowerCase() ?? '',
    ].filter((token) => token.length >= 4);

    for (const token of personalTokens) {
      if (normalized.includes(token)) {
        throw new ValidationError(
          'PASSWORD_CONTAINS_PERSONAL_DATA',
          'La contrasena no puede contener tu nombre ni tu correo.',
          { field: 'password' },
        );
      }
    }

    // Secuencias y repeticiones triviales: "aaaaaaaa", "12345678", "abcdefgh".
    if (isTrivialSequence(normalized)) throw weakPassword();

    await this.assertNotInBreachList(normalized);
  }

  /**
   * Comprueba la lista de contrasenas filtradas.
   *
   * Se consulta por hash y no por texto: asi la lista se puede cargar desde
   * volcados publicos (Have I Been Pwned publica hashes SHA-1) sin guardar
   * contrasenas en claro en nuestra base de datos, que seria un objetivo
   * jugosisimo.
   *
   * Si la consulta falla se deja pasar: bloquear el registro de todos los
   * alumnos porque una consulta auxiliar no responde seria un remedio peor que
   * la enfermedad. Las demas comprobaciones ya se aplicaron.
   */
  private async assertNotInBreachList(normalized: string): Promise<void> {
    if (!this.readPool) return;

    try {
      const hash = createHash('sha1').update(normalized).digest('hex').toUpperCase();
      const { rows } = await this.readPool.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM identity.weak_passwords WHERE password = $1) AS exists`,
        [hash],
      );
      if (rows[0]?.exists) throw weakPassword();
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      // Fallo de infraestructura: se ignora deliberadamente.
    }
  }
}

function weakPassword(): ValidationError {
  return new ValidationError(
    'PASSWORD_TOO_COMMON',
    'Esta contrasena es demasiado comun. Elige otra que solo tu conozcas.',
    { field: 'password' },
  );
}

/** Detecta repeticiones ("aaaaaaaa") y secuencias ("12345678", "abcdefgh"). */
function isTrivialSequence(value: string): boolean {
  if (new Set(value).size <= 2) return true;

  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
    if (!ascending && !descending) return false;
  }
  return ascending || descending;
}
