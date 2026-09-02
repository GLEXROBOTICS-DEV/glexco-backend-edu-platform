import { Guard, ValidationError, ValueObject, defineId } from '@glexco/kernel';
import { DEFAULT_LOCALE, type Locale } from '@glexco/contracts';

/** Identidad del agregado User. */
export class UserId extends defineId('User') {}

/**
 * Correo electronico.
 *
 * Se normaliza a minusculas y sin espacios en el propio objeto de valor, no en
 * el controlador. Motivo: el correo es la clave de inicio de sesion y tiene un
 * indice unico. Si la normalizacion viviera en la capa HTTP, un alta creada
 * desde un consumidor de eventos o desde un script de importacion podria colarse
 * con mayusculas y producir dos cuentas para la misma persona.
 */
export class Email extends ValueObject<{ value: string }> {
  // Validacion deliberadamente laxa. La comprobacion de verdad es enviar el
  // correo de verificacion: una expresion regular estricta rechaza direcciones
  // validas y raras, y no detecta las invalidas que importan (buzones que no
  // existen).
  private static readonly PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();

    Guard.againstEmpty(normalized, 'email');
    Guard.lengthBetween(normalized, 5, 254, 'email');
    Guard.matches(normalized, Email.PATTERN, 'email', 'EMAIL_INVALID');

    return new Email(normalized);
  }

  get value(): string {
    return this.props.value;
  }

  /** Dominio del correo. Se usa para reconocer altas corporativas y para
   *  detectar patrones de registro automatizado desde un mismo dominio. */
  get domain(): string {
    return this.props.value.split('@')[1] ?? '';
  }

  override toString(): string {
    return this.props.value;
  }
}

/**
 * Nombre de una persona.
 *
 * Rechaza digitos y simbolos porque en este campo casi siempre son ruido o
 * intentos de inyeccion, pero acepta tildes, dieresis, apostrofes y guiones:
 * "D'Angelo", "Nuñez-Melgar" y "José María" son nombres reales y frecuentes en
 * Peru y no pueden fallar la validacion.
 */
export class PersonName extends ValueObject<{ first: string; last: string }> {
  private static readonly PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'’.-]*$/u;

  private constructor(first: string, last: string) {
    super({ first, last });
  }

  static create(firstRaw: string, lastRaw: string): PersonName {
    const first = PersonName.normalize(firstRaw);
    const last = PersonName.normalize(lastRaw);

    for (const [value, field] of [
      [first, 'firstName'],
      [last, 'lastName'],
    ] as const) {
      Guard.againstEmpty(value, field);
      Guard.lengthBetween(value, 2, 80, field);
      Guard.matches(value, PersonName.PATTERN, field, 'NAME_INVALID');
    }

    return new PersonName(first, last);
  }

  /** Colapsa espacios internos: pegar desde una hoja de calculo suele traer
   *  espacios dobles y tabuladores. */
  private static normalize(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  get first(): string {
    return this.props.first;
  }

  get last(): string {
    return this.props.last;
  }

  get full(): string {
    return `${this.props.first} ${this.props.last}`;
  }

  /** Nombre mostrado en Discover: solo el nombre de pila, que es como se dirige
   *  la interfaz a un nino ("¡Hola, Carlos!"). */
  get shortName(): string {
    return this.props.first.split(' ')[0] ?? this.props.first;
  }
}

/**
 * Fecha de nacimiento.
 *
 * No es un dato decorativo: determina si el registro necesita el correo de un
 * apoderado (menores de 14) y a que portal entra el alumno. Por eso es un objeto
 * de valor con reglas propias y no una simple cadena.
 */
export class BirthDate extends ValueObject<{ iso: string }> {
  /** Edad minima para tener cuenta propia; por debajo, la crea la institucion. */
  static readonly MIN_AGE = 4;
  static readonly MAX_AGE = 100;
  /** Umbral de consentimiento parental. */
  static readonly GUARDIAN_REQUIRED_BELOW = 14;

  private constructor(iso: string) {
    super({ iso });
  }

  static create(raw: string): BirthDate {
    Guard.matches(raw, /^\d{4}-\d{2}-\d{2}$/, 'birthDate', 'DATE_FORMAT_INVALID');

    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError('DATE_INVALID', 'La fecha de nacimiento no es valida.', {
        field: 'birthDate',
      });
    }
    if (date.getTime() > Date.now()) {
      throw new ValidationError('DATE_IN_FUTURE', 'La fecha de nacimiento no puede ser futura.', {
        field: 'birthDate',
      });
    }

    const instance = new BirthDate(raw);
    const age = instance.ageAt(new Date());

    if (age < BirthDate.MIN_AGE || age > BirthDate.MAX_AGE) {
      throw new ValidationError(
        'BIRTH_DATE_OUT_OF_RANGE',
        'La fecha de nacimiento esta fuera del rango admitido.',
        { field: 'birthDate', minAge: BirthDate.MIN_AGE, maxAge: BirthDate.MAX_AGE },
      );
    }

    return instance;
  }

  /**
   * Edad en anos cumplidos.
   *
   * Se calcula por componentes de fecha y no dividiendo milisegundos: la
   * division acumula error con los anos bisiestos y puede dar 13 a alguien que
   * ya cumplio 14, lo que aqui cambiaria si pedimos o no el correo del apoderado.
   */
  ageAt(reference: Date): number {
    const [year, month, day] = this.props.iso.split('-').map(Number) as [number, number, number];
    let age = reference.getUTCFullYear() - year;
    const monthDelta = reference.getUTCMonth() + 1 - month;
    if (monthDelta < 0 || (monthDelta === 0 && reference.getUTCDate() < day)) age -= 1;
    return age;
  }

  requiresGuardian(reference: Date): boolean {
    return this.ageAt(reference) < BirthDate.GUARDIAN_REQUIRED_BELOW;
  }

  get iso(): string {
    return this.props.iso;
  }
}

/**
 * Hash de contrasena ya calculado.
 *
 * Envolverlo en un objeto de valor evita el accidente clasico de asignar la
 * contrasena en claro a un campo que espera el hash: son tipos distintos y el
 * compilador lo impide. Ademas, `toJSON` devuelve una marca y no el hash, de
 * modo que serializar un usuario por descuido no filtra material sensible.
 */
export class PasswordHash extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static fromHash(value: string): PasswordHash {
    Guard.againstEmpty(value, 'passwordHash');
    // Los hashes de argon2 y bcrypt empiezan por '$'. Cualquier otra cosa es un
    // error de programacion (probablemente la contrasena en claro).
    Guard.that(
      value.startsWith('$'),
      'PASSWORD_HASH_INVALID',
      'El valor recibido no parece un hash de contrasena.',
    );
    return new PasswordHash(value);
  }

  get value(): string {
    return this.props.value;
  }

  /** Nunca serializar el hash. */
  override toJSON(): { value: string } {
    return { value: '[hash]' };
  }
}

/** Preferencia de idioma del usuario. */
export class LocalePreference extends ValueObject<{ value: Locale }> {
  private constructor(value: Locale) {
    super({ value });
  }

  static create(raw?: string | null): LocalePreference {
    // Ante cualquier valor desconocido se cae al idioma por defecto en vez de
    // fallar: un idioma no soportado no debe impedir que alguien se registre.
    const value: Locale = raw === 'en' ? 'en' : DEFAULT_LOCALE;
    return new LocalePreference(value);
  }

  get value(): Locale {
    return this.props.value;
  }
}
