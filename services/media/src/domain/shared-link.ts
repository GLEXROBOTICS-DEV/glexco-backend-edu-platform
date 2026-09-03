import { BusinessRuleError, ValueObject } from '@glexco/kernel';

/**
 * Enlace externo a material alojado fuera de la plataforma.
 *
 * Es el patron que ya usan los colegios y universidades: el video de una
 * exposicion vive en el OneDrive o el Stream de la institucion y lo que circula
 * es el enlace. Adoptarlo tiene una ventaja enorme -cero almacenamiento y cero
 * ancho de banda por nuestra parte, y ninguna friccion con el flujo que la gente
 * ya tiene- y dos problemas reales que hay que resolver aqui, no ignorar:
 *
 * 1. **El enlace puede apuntar a cualquier sitio.** Esto son aulas con menores
 *    de edad; un enlace sin validar en el muro de un salon es un vector directo.
 *    Por eso hay lista blanca de dominios y no lista negra: una lista negra
 *    siempre va por detras de lo que hay que bloquear.
 *
 * 2. **El permiso del enlace no lo controlamos nosotros.** El fallo mas comun
 *    con diferencia es que el alumno comparte un enlace que solo el puede abrir,
 *    y el docente recibe "acceso denegado". No se puede comprobar desde aqui
 *    -haria falta la sesion del docente-, asi que lo que corresponde es avisarlo
 *    de forma explicita en la interfaz y guardar quien lo entrego y cuando.
 */

/**
 * Dominios admitidos.
 *
 * Son los que usan de verdad los centros educativos. Se agrupa por proveedor
 * para que anadir uno sea evidente y para que quede escrito POR QUE esta cada
 * uno: si manana alguien quiere meter un acortador, el comentario explica que no.
 */
export const ALLOWED_LINK_HOSTS: readonly string[] = [
  // Microsoft 365: es lo que tienen la mayoria de universidades y muchos
  // colegios, y de ahi viene la peticion.
  'sharepoint.com',
  'onedrive.live.com',
  '1drv.ms',
  'web.microsoftstream.com',
  'microsoftstream.com',

  // Google Workspace for Education.
  'drive.google.com',
  'docs.google.com',

  // Video publico. YouTube y Vimeo se admiten porque muchos docentes ya suben
  // ahi el material de su clase; el enlace se guarda tal cual y la plataforma
  // no lo incrusta sin marcarlo como externo.
  'youtube.com',
  'youtu.be',
  'vimeo.com',
];

/**
 * NO se admiten acortadores.
 *
 * Un acortador convierte la lista blanca en decoracion: `bit.ly/x` pasa la
 * comprobacion y redirige a donde sea. La lista existe para saber a que dominio
 * va el alumno, y un acortador es exactamente lo que impide saberlo.
 */
const REJECTED_HOSTS: readonly string[] = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'cutt.ly',
];

export class ExternalLink extends ValueObject<{ url: string; host: string }> {
  private constructor(url: string, host: string) {
    super({ url, host });
  }

  /**
   * Valida y normaliza un enlace.
   *
   * El orden de las comprobaciones no es casual: primero lo que descarta un
   * ataque (esquema, credenciales, host literal), y solo despues la lista
   * blanca. Al reves, un `javascript:` con un dominio permitido en el texto
   * podria colarse por una comparacion de cadenas descuidada.
   */
  static create(raw: string, allowedHosts: readonly string[] = ALLOWED_LINK_HOSTS): ExternalLink {
    const trimmed = raw.trim();

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BusinessRuleError('LINK_MALFORMED', 'El enlace no es una direccion valida.', {
        field: 'url',
      });
    }

    // Solo https. `http` viaja en claro -y un colegio comparte red-, y
    // `javascript:`, `data:` o `file:` no son enlaces a material: son un
    // intento de que el navegador de otra persona ejecute algo.
    if (parsed.protocol !== 'https:') {
      throw new BusinessRuleError(
        'LINK_NOT_HTTPS',
        'El enlace debe empezar por https://',
        { field: 'url' },
      );
    }

    // Credenciales incrustadas: `https://usuario:clave@dominio`. Ademas de ser
    // una fuga de la contrasena de alguien, es la forma clasica de disfrazar el
    // dominio real para que a simple vista parezca otro.
    if (parsed.username || parsed.password) {
      throw new BusinessRuleError(
        'LINK_HAS_CREDENTIALS',
        'El enlace no puede llevar usuario ni contrasena.',
        { field: 'url' },
      );
    }

    const host = parsed.hostname.toLowerCase();

    if (REJECTED_HOSTS.some((rejected) => matchesHost(host, rejected))) {
      throw new BusinessRuleError(
        'LINK_SHORTENER_NOT_ALLOWED',
        'No se admiten acortadores de enlaces. Comparte la direccion completa.',
        { field: 'url' },
      );
    }

    if (!allowedHosts.some((allowed) => matchesHost(host, allowed))) {
      throw new BusinessRuleError(
        'LINK_HOST_NOT_ALLOWED',
        'Ese sitio no esta admitido. Comparte el material desde el OneDrive, ' +
          'Google Drive o el canal de video de tu institucion.',
        { field: 'url', host, allowed: allowedHosts },
      );
    }

    // El fragmento se descarta: no aporta nada al recurso y es donde se cuelan
    // los parametros que algunos visores interpretan.
    parsed.hash = '';

    return new ExternalLink(parsed.toString(), host);
  }

  get url(): string {
    return this.props.url;
  }

  get host(): string {
    return this.props.host;
  }
}

/**
 * Compara un host con una entrada de la lista.
 *
 * Acepta el dominio y sus subdominios (`contoso.sharepoint.com` casa con
 * `sharepoint.com`), pero **no** un sufijo cualquiera: `malicioso-sharepoint.com`
 * no casa. La diferencia esta en exigir el punto separador, y es justo el error
 * que convierte una lista blanca en un colador.
 */
function matchesHost(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}
