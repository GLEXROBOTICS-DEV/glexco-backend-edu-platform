'use server';

import { revalidatePath } from 'next/cache';
import { activationCodeSchema } from '@glexco/contracts';
import { api } from './api';

/**
 * Canje de un codigo desde dentro del portal.
 *
 * Existe ademas del canje del registro porque el modelo de negocio es **un libro
 * por grado**: el alumno que pasa de quinto a sexto compra un libro nuevo y
 * tiene que activarlo sin crearse otra cuenta. El backend lo contempla desde el
 * principio (`POST /catalog/redeem`); lo que faltaba era la pantalla.
 *
 * El canje es irreversible y de un solo uso, y esa garantia vive en catalogo
 * dentro de una transaccion con bloqueo de fila. Aqui no se replica ninguna
 * comprobacion de negocio: repetirla daria la falsa impresion de que este lado
 * la sostiene.
 */

export interface ActivationState {
  error?: string;
  /** Kit recien desbloqueado. Es lo unico que le importa al alumno: el codigo
   *  no es el fin, el kit si. */
  kitName?: string;
  /** `false` cuando el alumno reenvia un codigo que el mismo ya canjeo. No es
   *  un error -el resultado es el que queria- pero decirle "activado" otra vez
   *  le haria pensar que gasto un codigo nuevo. */
  alreadyMine?: boolean;
}

interface RedeemResponse {
  kitId: string;
  kitName: string;
  program: string;
  grade: string;
  firstRedemption: boolean;
}

export async function redeemActivationCode(
  _previous: ActivationState,
  formData: FormData,
): Promise<ActivationState> {
  const raw = formData.get('activationCode');
  const parsed = activationCodeSchema.safeParse(typeof raw === 'string' ? raw : '');

  if (!parsed.success) {
    return {
      error: 'El código no tiene el formato correcto. Empieza por GLX y viene dentro de tu libro.',
    };
  }

  const result = await api<RedeemResponse>('/catalog/redeem', {
    method: 'POST',
    body: { code: parsed.data },
  });

  if (!result.ok) {
    return { error: result.error.message };
  }

  // La portada y la lista de kits leen `my-kits`, y sin invalidarlas el alumno
  // vuelve de activar y sigue viendo "todavia no tienes ningun kit". Se
  // invalidan las de los dos portales porque esta accion la comparten ambos y
  // el kit recien canjeado puede pertenecer a cualquiera de los dos.
  revalidatePath('/discover');
  revalidatePath('/academy');

  return { kitName: result.data.kitName, alreadyMine: !result.data.firstRedemption };
}
