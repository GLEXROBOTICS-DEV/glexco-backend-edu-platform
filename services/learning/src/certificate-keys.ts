/**
 * Lectura del par de claves de los certificados.
 *
 * Vive aparte del esquema de configuracion por una razon practica: las claves
 * PEM son multilinea, y los paneles de despliegue -Railway, y despues cualquier
 * otro- solo admiten valores de una linea, asi que llegan con los saltos
 * escapados. Normalizarlo en un sitio evita que la mitad de los despliegues
 * funcionen y la otra mitad no, segun como se pego la variable.
 */

export interface CertificateKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Convierte los `\n` escritos literalmente en saltos de linea de verdad. */
function normalize(pem: string | undefined): string {
  if (!pem) return '';
  return pem.includes('\\n') ? pem.split('\\n').join('\n') : pem;
}

/**
 * `null` cuando no estan configuradas.
 *
 * Devolver `null` y no lanzar es deliberado: sin claves, el servicio arranca y
 * todo lo demas -progreso, XP, insignias- sigue funcionando; solo los
 * certificados responden que no estan configurados. Hacerlas obligatorias
 * tumbaria el servicio entero por una funcion que no todos los despliegues usan.
 *
 * Lo que NO se hace es generar un par al vuelo cuando faltan: las firmas de hoy
 * no validarian manana, y un certificado que deja de verificarse es peor que uno
 * que nunca se emitio.
 */
export function readCertificateKeys(env: NodeJS.ProcessEnv = process.env): CertificateKeyPair | null {
  const privateKeyPem = normalize(env['CERTIFICATE_PRIVATE_KEY']);
  const publicKeyPem = normalize(env['CERTIFICATE_PUBLIC_KEY']);

  // Las dos o ninguna. Con solo la privada se firmaria sin poder verificar, y
  // con solo la publica se verificaria lo que nadie puede firmar: los dos casos
  // son un despliegue a medias, y es mejor que se note al arrancar.
  if (!privateKeyPem || !publicKeyPem) return null;

  return { privateKeyPem, publicKeyPem };
}
