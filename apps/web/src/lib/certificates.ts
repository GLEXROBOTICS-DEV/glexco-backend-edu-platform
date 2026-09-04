import 'server-only';
import { api, gatewayUrl } from './api';

export interface MyCertificate {
  id: string;
  serial: string;
  studentName: string;
  courseTitle: string;
  kitId: string;
  institutionName: string | null;
  completion: number;
  issuedAt: string;
  keyFingerprint: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface CertificateVerification {
  valid: boolean;
  reason: 'not_found' | 'revoked' | 'tampered' | null;
  certificate: {
    serial: string;
    studentName: string;
    courseTitle: string;
    institutionName: string | null;
    issuedAt: string;
    keyFingerprint: string;
  } | null;
}

/** Mis certificados. El alcance lo decide el token, nunca un parametro. */
export async function fetchMyCertificates(): Promise<{
  items: MyCertificate[];
  failed: boolean;
  /** El despliegue no tiene claves de firma configuradas. */
  disabled: boolean;
}> {
  const result = await api<{ items: MyCertificate[] }>('/certificates/me');

  if (!result.ok) {
    if (result.status === 503) return { items: [], failed: false, disabled: true };
    console.error('No se pudieron leer los certificados', {
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true, disabled: false };
  }

  return { items: result.data.items ?? [], failed: false, disabled: false };
}

/**
 * Verificacion publica de una serie.
 *
 * **No pasa por `api()`, y es deliberado.** Ese ayudante adjunta la cookie de
 * sesion, y esta pantalla la abre gente de fuera -una universidad, una empresa-
 * que no tiene cuenta aqui. Mandar un token que no existe seria inofensivo, pero
 * usar el del visitante que SI ha iniciado sesion convertiria una ruta publica
 * en una que se comporta distinto segun quien mire, que es como se cuelan fugas.
 */
export async function verifyCertificate(serial: string): Promise<CertificateVerification | null> {
  try {
    const response = await fetch(
      `${gatewayUrl}/api/v1/certificates/verify/${encodeURIComponent(serial)}`,
      { cache: 'no-store', headers: { accept: 'application/json' } },
    );

    if (response.status === 503) return null;
    if (!response.ok) return { valid: false, reason: 'not_found', certificate: null };

    return (await response.json()) as CertificateVerification;
  } catch (error) {
    console.error('No se pudo verificar el certificado', { serial, error });
    return null;
  }
}
