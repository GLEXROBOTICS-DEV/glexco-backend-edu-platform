'use server';

import { redirect } from 'next/navigation';
import { studentRegistrationSchema } from '@glexco/contracts';
import { gatewayUrl } from './api';
import { establishSession, type AuthResponse } from './session-cookies';

/**
 * Alta de alumno desde el portal.
 *
 * Es una Server Action y no una llamada desde el navegador por lo mismo que el
 * ingreso: al terminar hay que dejar la sesion en cookies `httpOnly`, y eso solo
 * puede hacerlo el servidor.
 *
 * **Termina con sesion iniciada, a proposito.** El alumno acaba de teclear su
 * contrasena, asi que pedirsela otra vez no comprueba nada nuevo; y el objetivo
 * de esta pantalla es que un colegio pueda usar la plataforma sin que nadie de
 * GLEXCO intervenga, lo que incluye no dejar al alumno en una pantalla de
 * ingreso justo despues de haberse registrado.
 *
 * El canje del codigo NO ocurre aqui ni de forma sincrona: identidad crea la
 * cuenta y encola el evento, y catalogo lo canjea al consumirlo. Por eso la
 * pantalla de confirmacion contempla que el kit tarde un instante en aparecer.
 */

export interface RegistrationState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Lo tecleado, para repintarlo. Sin esto, un error de validacion vacia un
   *  formulario largo y el alumno lo abandona; nunca incluye la contrasena. */
  values?: Record<string, string>;
}

export async function registerStudent(
  _previous: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const accountType = formData.get('accountType') === 'independent' ? 'independent' : 'institutional';

  const raw = {
    accountType,
    email: text(formData, 'email'),
    // SIN recortar. `text()` quita los espacios de los extremos, y hacerlo con
    // una contrasena la altera en silencio: se guardaria "abc" cuando el alumno
    // escribio " abc ", y al ingresar -donde no se recorta nada- no coincidiria
    // nunca. Un usuario encerrado fuera de su cuenta el primer dia, sin ningun
    // mensaje que lo explique.
    password: verbatim(formData, 'password'),
    firstName: text(formData, 'firstName'),
    lastName: text(formData, 'lastName'),
    birthDate: text(formData, 'birthDate'),
    grade: text(formData, 'grade'),
    activationCode: text(formData, 'activationCode'),
    locale: 'es',
    acceptedTerms: formData.get('acceptedTerms') === 'on',
    // Un campo vacio se envia como cadena vacia, y el esquema espera que un
    // apoderado ausente sea `undefined`: sin esta conversion, un alumno mayor de
    // catorce que deja la casilla en blanco falla la validacion de correo.
    ...(text(formData, 'guardianEmail') ? { guardianEmail: text(formData, 'guardianEmail') } : {}),
    ...(accountType === 'institutional'
      ? {
          institutionId: text(formData, 'institutionId'),
          classroomId: text(formData, 'classroomId'),
        }
      : {}),
  };

  // Lo que se repinta al fallar. La contrasena y la confirmacion quedan fuera
  // de forma explicita: devolverlas las escribiria en el HTML de la respuesta,
  // que acaba en la cache del navegador y en cualquier proxy intermedio.
  const values: Record<string, string> = {
    email: raw.email,
    firstName: raw.firstName,
    lastName: raw.lastName,
    birthDate: raw.birthDate,
    activationCode: raw.activationCode,
    guardianEmail: text(formData, 'guardianEmail'),
    classroomId: text(formData, 'classroomId'),
  };

  if (raw.password !== verbatim(formData, 'passwordConfirm')) {
    return {
      fieldErrors: { passwordConfirm: ['Las dos contraseñas no coinciden.'] },
      values,
    };
  }

  const parsed = studentRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fieldErrors: translateFieldErrors(parsed.error.flatten().fieldErrors),
      values,
    };
  }

  const response = await fetch(`${gatewayUrl}/api/v1/auth/register/student`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (!response.ok) {
    return { ...toRegistrationState(await readError(response)), values };
  }

  // La cuenta ya existe. A partir de aqui, cualquier fallo se resuelve
  // mandando al alumno a ingresar y NUNCA repintando el formulario: reenviarlo
  // chocaria con "ese correo ya esta registrado" y le haria creer que el alta
  // no funciono.
  const signedIn = await signIn(parsed.data.email, parsed.data.password);
  redirect(signedIn ? '/registro/listo' : '/ingresar?registrado=1');
}

/**
 * Inicia sesion con las credenciales recien creadas.
 *
 * Devuelve `false` en vez de lanzar: el registro ya salio bien y un fallo aqui
 * es una molestia (teclear la contrasena una vez mas), no un error del alta.
 */
async function signIn(email: string, password: string): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, rememberMe: false, locale: 'es' }),
      cache: 'no-store',
    });

    if (!response.ok) return false;

    const body = (await response.json()) as AuthResponse;
    await establishSession(body, response.headers.getSetCookie?.() ?? []);
    return true;
  } catch (error) {
    console.error('No se pudo iniciar sesion tras el registro', error);
    return false;
  }
}

interface BackendError {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

async function readError(response: Response): Promise<BackendError> {
  const body = (await response.json().catch(() => null)) as BackendError | null;
  return body ?? {};
}

/**
 * Traduce el error del backend a la forma que entiende el formulario.
 *
 * Hay dos formas distintas y las dos hacen falta. Un fallo de esquema pasa por
 * el pipe de Zod y llega como `fieldErrors`; una regla de negocio -codigo ya
 * canjeado, salon lleno- llega como `DomainError` con `details.field`. Sin este
 * puente, los errores mas frecuentes del alta aparecerian como un aviso general
 * arriba del formulario en vez de junto al campo que hay que corregir, que es
 * justo donde el alumno esta mirando.
 */
function toRegistrationState(error: BackendError): RegistrationState {
  if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
    return { fieldErrors: translateFieldErrors(error.fieldErrors) };
  }

  const field = typeof error.details?.['field'] === 'string' ? (error.details['field'] as string) : null;
  const message = error.message ?? 'No se pudo crear la cuenta.';

  if (field) return { fieldErrors: { [field]: [message] } };
  return { error: message };
}

/**
 * Claves de traduccion a texto en pantalla.
 *
 * Los esquemas de `@glexco/contracts` devuelven claves (`errors.validation.*`)
 * y no frases, porque los comparte el backend, que no sabe en que idioma esta
 * el usuario. Aqui se resuelven; lo que no esta en la tabla se muestra tal
 * cual, que es feo pero informativo, y nunca desaparece en silencio.
 */
const MESSAGES: Record<string, string> = {
  'errors.validation.email_invalid': 'Escribe un correo válido.',
  'errors.validation.email_too_long': 'Ese correo es demasiado largo.',
  'errors.validation.password_too_short': 'La contraseña necesita al menos 8 caracteres.',
  'errors.validation.password_too_long': 'La contraseña es demasiado larga.',
  'errors.validation.password_blank': 'Escribe tu contraseña.',
  'errors.validation.name_too_short': 'Escribe el nombre completo.',
  'errors.validation.name_too_long': 'Ese nombre es demasiado largo.',
  'errors.validation.name_invalid': 'Escribe el nombre solo con letras, sin números.',
  'errors.validation.date_invalid': 'Revisa la fecha: tiene que ser día, mes y año.',
  'errors.validation.birth_date_out_of_range': 'Revisa tu fecha de nacimiento.',
  'errors.validation.activation_code_invalid':
    'El código no tiene el formato correcto. Empieza por GLX y viene dentro de tu libro.',
  'errors.validation.terms_required': 'Tienes que aceptar los términos para crear la cuenta.',
  'errors.validation.guardian_email_required':
    'Como eres menor de 14 años, necesitamos el correo de tu papá, mamá o apoderado.',
  'errors.validation.invalid_id': 'Vuelve a elegir tu salón.',
};

function translateFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!messages?.length) continue;
    out[field] = messages.map((message) => MESSAGES[message] ?? message);
  }
  return out;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Igual que `text`, pero sin recortar. Solo para contrasenas. */
function verbatim(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}
