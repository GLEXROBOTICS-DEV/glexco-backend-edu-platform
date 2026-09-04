import 'server-only';
import { api } from './api';

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  /** Descripcion legible del dispositivo, derivada del user agent. */
  device: string;
  ipAddress: string | null;
  /** La sesion desde la que se esta mirando la pantalla. */
  current: boolean;
}

/**
 * Las sesiones abiertas de la cuenta.
 *
 * El alcance lo decide el token en el backend, no un parametro: aceptar un
 * `userId` convertiria esta pantalla en un listado de los dispositivos de
 * cualquiera.
 */
export async function fetchSessions(): Promise<{ items: ActiveSession[]; failed: boolean }> {
  const result = await api<ActiveSession[] | { items: ActiveSession[] }>('/account/sessions');

  if (!result.ok) {
    console.error('No se pudieron leer las sesiones', {
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  const data = result.data;
  return { items: Array.isArray(data) ? data : (data?.items ?? []), failed: false };
}
