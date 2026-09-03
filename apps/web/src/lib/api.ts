import 'server-only';
import { headers } from 'next/headers';
import { getAccessToken } from './session';

/**
 * Cliente del API, siempre desde el servidor.
 *
 * Todo pasa por el gateway: el frontend no conoce -ni debe conocer- las URLs de
 * los microservicios. Si las conociera, cada cambio de topologia del backend
 * seria un despliegue del frontend, y ademas la tabla de rutas del gateway
 * dejaria de ser el unico sitio donde se decide que esta expuesto a internet.
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  correlationId?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /**
   * Segundos de cache. Solo para lecturas que NO dependen del usuario.
   *
   * Por defecto no se cachea nada: casi todo lo que pide este frontend es del
   * alumno concreto que ha iniciado sesion, y una respuesta cacheada que se
   * sirva a otro seria una fuga de datos de un menor. Cachear es la excepcion y
   * hay que pedirlo explicitamente.
   */
  revalidate?: number;
  /** Etiquetas de cache de Next, para invalidar despues. */
  tags?: string[];
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const token = await getAccessToken();
  const incoming = await headers();

  // El identificador de correlacion se propaga desde la peticion del navegador
  // hasta el ultimo microservicio. Es lo que permite, ante un fallo, buscar una
  // sola cadena y ver la peticion completa atravesando gateway, identidad y
  // catalogo.
  const correlationId = incoming.get('x-correlation-id');

  const response = await fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.revalidate === undefined
      ? { cache: 'no-store' as const }
      : { next: { revalidate: options.revalidate, ...(options.tags ? { tags: options.tags } : {}) } }),
  });

  const text = await response.text();
  const parsed: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const error = (parsed ?? {}) as ApiError;
    return {
      ok: false,
      status: response.status,
      error: {
        code: error.code ?? 'UNKNOWN_ERROR',
        message: error.message ?? 'Ocurrio un error inesperado.',
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.correlationId ? { correlationId: error.correlationId } : {}),
      },
    };
  }

  return { ok: true, data: parsed as T };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const gatewayUrl = GATEWAY_URL;
