'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

/**
 * Las acciones del Portal Admin.
 *
 * Todo lo que hay aquí llamaba a endpoints que **existían desde hace fases y no
 * tenían pantalla**: dar de alta un colegio, concederle su licencia, crear una
 * cuenta de personal y generar un lote de códigos de imprenta. El backend estaba
 * completo —con sus permisos, sus validaciones y sus eventos— y la única forma
 * de usarlo era con `curl`.
 *
 * Ninguna acepta el actor por parámetro: el alcance sale del token. Y ninguna
 * comprueba permisos aquí, porque el permiso lo comprueba el servicio: repetirlo
 * en el cliente daría la falsa sensación de que quitar el `if` abre algo.
 */

export interface AdminState {
  error?: string;
  ok?: string;
  /**
   * Los codigos recien generados, en claro.
   *
   * **Solo existen aqui y una vez.** En la base queda unicamente su hash, asi
   * que no hay endpoint para volver a descargarlos: es deliberado -un volcado de
   * la tabla no debe convertirse en miles de accesos vendibles- y por eso la
   * pantalla los ensena de golpe y avisa de que no volveran.
   */
  codes?: string[];
  batchId?: string;
  /**
   * La contrasena temporal de una cuenta de personal recien creada.
   *
   * Viaja hasta la pantalla porque el backend la devuelve UNA sola vez y NO
   * manda ningun correo: quien crea la cuenta es quien tiene que entregarla.
   */
  temporaryPassword?: string;
}

/**
 * Alta de una institución.
 *
 * El **código** es lo delicado: es lo que los alumnos teclean al registrarse y
 * va impreso en los libros que el colegio ya compró. Se guarda normalizado —sin
 * guiones y en mayúsculas— y el formulario lo dice, porque quien escribe
 * `DEMO-SMP` y luego lo busca tal cual no lo encuentra. Ese detalle costó dos
 * siembras muertas y una institución duplicada.
 */
export async function createInstitution(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const city = String(formData.get('city') ?? '').trim();
  const responsibleName = String(formData.get('responsibleName') ?? '').trim();
  const contactEmail = String(formData.get('contactEmail') ?? '').trim();
  const levels = formData.getAll('educationLevels').map(String).filter(Boolean);

  if (!code || !name || !city || !responsibleName || !contactEmail) {
    return { error: 'Faltan datos obligatorios del colegio.' };
  }

  if (levels.length === 0) {
    // El nivel decide qué grados se pueden crear, así que sin él el colegio
    // queda dado de alta y sin poder abrir un solo salón.
    return { error: 'Marca al menos un nivel educativo.' };
  }

  const shortName = String(formData.get('shortName') ?? '').trim();
  const phone = String(formData.get('phone') ?? '').trim();
  const address = String(formData.get('address') ?? '').trim();

  const result = await api<{ institutionId: string }>('/institutions', {
    method: 'POST',
    body: {
      code,
      name,
      city,
      responsibleName,
      contactEmail,
      educationLevels: levels,
      ...(shortName ? { shortName } : {}),
      ...(phone ? { phone } : {}),
      ...(address ? { address } : {}),
    },
  });

  if (!result.ok) {
    if (result.error.code === 'INSTITUTION_CODE_TAKEN' || result.status === 409) {
      return { error: 'Ese código ya lo usa otro colegio. Elige uno distinto.' };
    }
    return { error: result.error.message };
  }

  revalidatePath('/admin/instituciones');
  return { ok: `Colegio creado. Su código de registro es ${code.toUpperCase()}.` };
}

/**
 * Concede o renueva la licencia de un colegio.
 *
 * Las **plazas** son el tope de alumnos que pueden activar, no una sugerencia:
 * el canje las comprueba. Y el periodo lo valida el backend —la fecha de fin
 * tiene que ser posterior al inicio—, así que aquí solo se ahorra el viaje.
 */
export async function grantLicense(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const institutionId = String(formData.get('institutionId') ?? '').trim();
  const seats = String(formData.get('seats') ?? '').trim();
  const startsAt = String(formData.get('startsAt') ?? '').trim();
  const expiresAt = String(formData.get('expiresAt') ?? '').trim();
  const reference = String(formData.get('reference') ?? '').trim();

  if (!institutionId || !seats || !startsAt || !expiresAt) {
    return { error: 'Faltan las plazas o el periodo de la licencia.' };
  }

  if (new Date(expiresAt) <= new Date(startsAt)) {
    return { error: 'La fecha de fin tiene que ser posterior a la de inicio.' };
  }

  const result = await api('/institutions/' + encodeURIComponent(institutionId) + '/licenses', {
    method: 'POST',
    body: {
      seats,
      // El backend espera ISO completo y el `<input type="date">` da solo el
      // día. Se completa a mediodía UTC y no a medianoche: con medianoche, una
      // licencia que empieza "hoy" en Lima empieza ayer para el servidor.
      startsAt: `${startsAt}T12:00:00.000Z`,
      expiresAt: `${expiresAt}T12:00:00.000Z`,
      ...(reference ? { reference } : {}),
    },
  });

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/admin/instituciones');
  return { ok: `Licencia concedida: ${seats} plazas hasta el ${expiresAt}.` };
}

/**
 * Crea una cuenta de personal: docente, dirección o equipo de GLEXCO.
 *
 * **No se elige la contraseña: el backend genera una temporal y la devuelve UNA
 * vez, aquí.** Esa es la parte que hay que entender antes de tocar esta
 * pantalla: no se envía ningún correo, así que quien crea la cuenta es quien
 * tiene que entregar esa contraseña por un canal seguro. Si la pantalla dijera
 * «le llegará un correo» —como decía la primera versión de este archivo—, la
 * persona no recibiría nada y el operador no sabría que la contraseña la tiene
 * él.
 *
 * La cuenta queda marcada para cambiarla al primer ingreso, así que la temporal
 * solo sirve para entrar una vez.
 *
 * Qué roles se pueden crear NO lo decide esta pantalla: lo decide
 * `ROLE_CREATION_MATRIX` en el backend a partir de quién llama. Un director de
 * colegio puede crear docentes y no personal de GLEXCO, y el intento se rechaza
 * ahí aunque el formulario lo ofreciera.
 */
export async function createStaff(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const email = String(formData.get('email') ?? '').trim();
  const firstName = String(formData.get('firstName') ?? '').trim();
  const lastName = String(formData.get('lastName') ?? '').trim();
  const role = String(formData.get('role') ?? '').trim();
  const institutionId = String(formData.get('institutionId') ?? '').trim();

  if (!email || !firstName || !lastName || !role) {
    return { error: 'Faltan el nombre, el correo o el rol.' };
  }

  // `users/staff` y no `account/staff`. El controlador de alta de personal vive
  // en su propio prefijo -`account` es lo de MI cuenta-, y la ruta equivocada
  // devolvia un 404 que en la pantalla se leia como "no se pudo crear".
  const result = await api<{ userId: string; temporaryPassword?: string }>('/users/staff', {
    method: 'POST',
    body: {
      email,
      firstName,
      lastName,
      // `role` en SINGULAR: el contrato acepta uno y no una lista. Mandar
      // `roles` pasaba como campo ausente y devolvia un 422 que en la pantalla
      // se leia como "faltan datos" sin decir cual.
      role,
      ...(institutionId ? { institutionId } : {}),
    },
  });

  if (!result.ok) {
    if (result.error.code === 'EMAIL_ALREADY_REGISTERED' || result.status === 409) {
      return { error: 'Ya existe una cuenta con ese correo.' };
    }
    if (result.error.code === 'ROLE_NOT_ALLOWED' || result.status === 403) {
      return { error: 'No puedes crear cuentas con ese rol.' };
    }
    return { error: result.error.message };
  }

  revalidatePath('/admin/usuarios');
  return {
    ok: `Cuenta creada para ${firstName} ${lastName}.`,
    // Se devuelve para que la pantalla la ensene una vez. No se guarda en claro
    // en ningun sitio y no hay forma de volver a verla: si se pierde, hay que
    // restablecerla.
    temporaryPassword: result.data.temporaryPassword,
  };
}

/**
 * Genera un lote de códigos de imprenta.
 *
 * Es la operación con más consecuencias del panel: **cada código es un derecho
 * de acceso pagado** y una vez impreso en un libro no se puede cambiar. El
 * backend los genera de golpe en una transacción y emite el evento del lote, que
 * es lo que alimenta la cifra comercial de "libros comprados que nadie activó".
 *
 * `distributedTo` es lo que ata el lote a un colegio. Sin él, el evento sale sin
 * institución y el panel no puede atribuir esos códigos a nadie: es exactamente
 * el fallo que dejó el recuento en "10 de 0 emitidos" durante semanas.
 */
export async function generateCodeBatch(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const kitId = String(formData.get('kitId') ?? '').trim();
  // El campo del backend se llama `size`. Lo dice el contrato y no el nombre del
  // input: mandar `quantity` pasaba la validacion de Zod como campo ausente y
  // devolvia un error de tamano invalido que no decia nada.
  const size = String(formData.get('size') ?? '').trim();
  const distributedTo = String(formData.get('distributedTo') ?? '').trim();
  const reference = String(formData.get('reference') ?? '').trim();
  const expiresAt = String(formData.get('expiresAt') ?? '').trim();

  if (!kitId || !size) {
    return { error: 'Elige el kit y cuántos códigos hacen falta.' };
  }

  const result = await api<{ batchId: string; total: number; codes: string[] }>(
    // `catalog/batches`, que es donde vive el controlador de lotes.
    '/catalog/batches',
    {
    method: 'POST',
    body: {
      kitId,
      size,
      ...(distributedTo ? { distributedTo } : {}),
      ...(reference ? { reference } : {}),
      ...(expiresAt ? { expiresAt: `${expiresAt}T23:59:59.000Z` } : {}),
    },
    },
  );

  if (!result.ok) return { error: result.error.message };

  revalidatePath('/admin/codigos');
  return {
    ok: `Lote generado con ${result.data.total} códigos. Guárdalos ahora: no volverán a mostrarse.`,
    codes: result.data.codes ?? [],
    batchId: result.data.batchId,
  };
}

/**
 * Publica, retira o manda a revisión un contenido.
 *
 * La tabla de transiciones vive en el backend y **no permite saltar de borrador
 * a publicado**: este contenido lo ven niños de seis años, y la revisión es el
 * único punto donde alguien distinto del autor lo mira antes de que llegue a un
 * aula. Si esta pantalla ofreciera el salto, el rechazo vendría del servidor.
 */
export async function changeContentStatus(
  _previous: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const id = String(formData.get('id') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim();

  if (!id || !target || !status) return { error: 'Faltan datos del contenido.' };

  const result = await api(`/catalog/content/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: { target, status },
  });

  if (!result.ok) {
    if (result.error.code === 'INVALID_PUBLICATION_TRANSITION') {
      return {
        error:
          'Ese cambio no está permitido. Un borrador tiene que pasar por revisión antes de publicarse.',
      };
    }
    return { error: result.error.message };
  }

  revalidatePath('/admin/contenidos');
  return { ok: 'Estado actualizado.' };
}
