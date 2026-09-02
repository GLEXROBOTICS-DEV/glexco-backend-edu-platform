import { Guard, ValidationError, ValueObject, defineId } from '@glexco/kernel';
import { EDUCATION_LEVELS, type EducationLevel } from '@glexco/contracts';

export class InstitutionId extends defineId('Institution') {}

/**
 * Codigo institucional.
 *
 * Es el codigo que un colegio reparte a sus alumnos y que aparece en la pantalla
 * de ingreso de la propuesta ("Acceso mediante codigo institucional"). Sirve para
 * identificar al colegio ANTES de pedir credenciales, de modo que el formulario
 * de registro ya venga con la institucion preseleccionada.
 *
 * A diferencia del codigo de activacion del libro, este NO es secreto ni de un
 * solo uso: lo conocen todos los alumnos del colegio. Por eso es corto y legible.
 * No da acceso a nada por si mismo, solo preselecciona la institucion.
 */
export class InstitutionCode extends ValueObject<{ value: string }> {
  private static readonly PATTERN = /^[A-Z0-9]{4,12}$/;

  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): InstitutionCode {
    // Se normaliza quitando separadores: en el papel se escribe "SJB-2026" y en
    // la web lo teclean como "sjb2026" o "SJB 2026".
    const normalized = raw.trim().toUpperCase().replace(/[\s-_.]/g, '');

    Guard.againstEmpty(normalized, 'institutionCode');
    Guard.matches(
      normalized,
      InstitutionCode.PATTERN,
      'institutionCode',
      'INSTITUTION_CODE_INVALID',
    );

    return new InstitutionCode(normalized);
  }

  get value(): string {
    return this.props.value;
  }

  override toString(): string {
    return this.props.value;
  }
}

/** Nombre oficial de la institucion. */
export class InstitutionName extends ValueObject<{ value: string; short: string }> {
  private constructor(value: string, short: string) {
    super({ value, short });
  }

  static create(raw: string, shortRaw?: string): InstitutionName {
    const value = raw.trim().replace(/\s+/g, ' ');

    Guard.againstEmpty(value, 'name');
    Guard.lengthBetween(value, 3, 200, 'name');

    // El nombre corto se usa en la cabecera del portal y en los certificados,
    // donde no cabe "Institucion Educativa Privada San Juan Bautista de Lurin".
    const short = (shortRaw?.trim() || InstitutionName.abbreviate(value)).slice(0, 40);

    return new InstitutionName(value, short);
  }

  /** Toma las primeras palabras significativas hasta 40 caracteres. */
  private static abbreviate(value: string): string {
    const stopWords = new Set([
      'de',
      'del',
      'la',
      'las',
      'el',
      'los',
      'y',
      'e',
      'institucion',
      'educativa',
      'privada',
      'publica',
      'colegio',
      'i.e.',
      'ie',
    ]);

    const words = value
      .split(' ')
      .filter((word) => !stopWords.has(word.toLowerCase().replace(/[.,]/g, '')));

    const candidate = words.join(' ');
    return candidate.length > 0 ? candidate.slice(0, 40) : value.slice(0, 40);
  }

  get value(): string {
    return this.props.value;
  }
  get short(): string {
    return this.props.short;
  }
}

/**
 * Niveles educativos que atiende la institucion.
 *
 * Determina que programas ve (Discover para primaria, Academy para el resto) y
 * que grados se ofrecen al crear salones. Un colegio solo de primaria no debe
 * poder crear un salon de 4.º de secundaria.
 */
export class EducationLevels extends ValueObject<{ levels: readonly EducationLevel[] }> {
  private constructor(levels: readonly EducationLevel[]) {
    super({ levels });
  }

  static create(raw: readonly string[]): EducationLevels {
    if (raw.length === 0) {
      throw new ValidationError(
        'EDUCATION_LEVELS_REQUIRED',
        'La institucion debe atender al menos un nivel educativo.',
        { field: 'educationLevels' },
      );
    }

    const valid = Object.values(EDUCATION_LEVELS) as string[];
    const levels: EducationLevel[] = [];

    for (const level of raw) {
      if (!valid.includes(level)) {
        throw new ValidationError(
          'EDUCATION_LEVEL_INVALID',
          `El nivel educativo "${level}" no existe.`,
          { field: 'educationLevels', allowed: valid },
        );
      }
      if (!levels.includes(level as EducationLevel)) levels.push(level as EducationLevel);
    }

    return new EducationLevels(levels);
  }

  get levels(): readonly EducationLevel[] {
    return this.props.levels;
  }

  includes(level: EducationLevel): boolean {
    return this.props.levels.includes(level);
  }
}

/**
 * Datos de contacto del responsable.
 *
 * El telefono se guarda tal cual lo escriben, solo sin separadores: en Peru
 * conviven "987 654 321", "+51 987654321" y "01-2345678", y normalizar de forma
 * agresiva rompe los fijos con prefijo provincial.
 */
export class ContactInfo extends ValueObject<{
  responsibleName: string;
  email: string;
  phone: string | null;
  city: string;
  address: string | null;
}> {
  private constructor(props: {
    responsibleName: string;
    email: string;
    phone: string | null;
    city: string;
    address: string | null;
  }) {
    super(props);
  }

  static create(input: {
    responsibleName: string;
    email: string;
    phone?: string | null;
    city: string;
    address?: string | null;
  }): ContactInfo {
    const responsibleName = input.responsibleName.trim().replace(/\s+/g, ' ');
    const email = input.email.trim().toLowerCase();
    const city = input.city.trim().replace(/\s+/g, ' ');

    Guard.againstEmpty(responsibleName, 'responsibleName');
    Guard.lengthBetween(responsibleName, 3, 120, 'responsibleName');
    Guard.againstEmpty(email, 'contactEmail');
    Guard.matches(email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'contactEmail', 'EMAIL_INVALID');
    Guard.againstEmpty(city, 'city');
    Guard.lengthBetween(city, 2, 80, 'city');

    const phone = input.phone?.replace(/[\s()-]/g, '') || null;
    if (phone) {
      Guard.matches(phone, /^\+?\d{6,15}$/, 'phone', 'PHONE_INVALID');
    }

    return new ContactInfo({
      responsibleName,
      email,
      phone,
      city,
      address: input.address?.trim() || null,
    });
  }

  get responsibleName(): string {
    return this.props.responsibleName;
  }
  get email(): string {
    return this.props.email;
  }
  get phone(): string | null {
    return this.props.phone;
  }
  get city(): string {
    return this.props.city;
  }
  get address(): string | null {
    return this.props.address;
  }
}
