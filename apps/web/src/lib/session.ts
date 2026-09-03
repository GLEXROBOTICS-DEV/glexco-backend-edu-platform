import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

/**
 * Sesion del usuario en el servidor.
 *
 * **El access token NUNCA llega al navegador como JavaScript accesible.** Se
 * guarda en una cookie `httpOnly`, igual que el refresh. Meterlo en
 * `localStorage` -que es lo habitual en tutoriales de Next- lo deja al alcance de
 * cualquier script inyectado: un solo XSS en cualquier dependencia del frontend
 * se convierte en el robo de la sesion de todos los alumnos.
 *
 * Con `httpOnly`, ni siquiera un XSS puede leer el token; como mucho puede hacer
 * peticiones desde el propio navegador, que es un dano mucho menor y acotado.
 *
 * **Aviso de desarrollo:** en `next dev`, React 19 serializa en el HTML los
 * valores que atraviesan sus funciones instrumentadas, y ahi aparece la cookie
 * -token incluido- dentro del payload de depuracion. En el build de produccion
 * NO aparece; esta verificado en `infra/scripts/web-check.mjs`. Aun asi, conviene
 * no compartir pantalla ni el `view-source` de un servidor de desarrollo con la
 * sesion iniciada.
 *
 * La consecuencia de diseno es que **las llamadas autenticadas se hacen desde el
 * servidor** (Server Components y Server Actions), no desde el cliente. Encaja
 * con la decision de arquitectura: el contenido educativo es estatico por
 * usuario y se renderiza en el servidor para que llegue menos JavaScript a los
 * equipos escolares, que suelen ser modestos.
 */

const ACCESS_COOKIE = 'glexco_at';
const REFRESH_COOKIE = 'glexco_rt';

export interface SessionUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  institutionId: string | null;
  /** Portal que le corresponde: decide el layout y la densidad. */
  portal: 'discover' | 'academy' | 'teacher' | 'institution' | 'admin';
  locale: 'es' | 'en';
}

/**
 * Lee la sesion actual.
 *
 * El token da los datos de autorizacion; el PERFIL (nombre, correo, portal) se
 * pide a `/auth/me`, porque no viaja en el token a proposito: son millones de
 * tokens en cada peticion de cada alumno y cada campo extra se paga en bytes de
 * red. Ademas, el portal depende de la edad y de los roles, y si saliera del
 * token un docente recien nombrado seguiria viendo el portal de alumno hasta que
 * su token caducara.
 *
 * Va envuelto en `cache()` de React: en una sola peticion, el layout, la barra
 * de navegacion y la pagina piden la sesion por separado, y sin esto serian tres
 * llamadas identicas a identidad. `cache()` la resuelve una vez POR PETICION, no
 * entre peticiones: no hay riesgo de servirle a un alumno la sesion de otro.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = decodeAccessToken(token);
  if (!claims) return null;

  // La caducidad se comprueba aqui solo para ahorrarse una llamada que el
  // backend va a rechazar igual. NO es la validacion de seguridad: esa la hace
  // cada servicio verificando la firma. Un token manipulado en el navegador
  // pasaria esta comprobacion y moriria en la primera llamada real.
  if (claims.exp * 1000 <= Date.now()) return null;

  const profile = await fetchProfile(token);

  // Si identidad no responde, se sigue adelante con lo que da el token. El
  // alumno vera su portal sin su nombre, que es mucho mejor que echarlo a la
  // pantalla de ingreso por un fallo temporal de un servicio.
  return {
    userId: claims.sub,
    email: profile?.email ?? '',
    firstName: profile?.firstName ?? '',
    lastName: profile?.lastName ?? '',
    roles: profile?.roles ?? claims.roles ?? [],
    permissions: profile?.permissions ?? claims.perms ?? [],
    institutionId: profile?.institutionId ?? claims.inst ?? null,
    portal: resolvePortal(profile?.roles ?? claims.roles ?? [], profile?.portal),
    locale: (profile?.locale ?? claims.loc) === 'en' ? 'en' : 'es',
  };
});

interface Profile {
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  institutionId: string | null;
  portal: string;
  locale: string;
}

async function fetchProfile(token: string): Promise<Profile | null> {
  const gateway = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  try {
    const response = await fetch(`${gateway}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      // Nunca se cachea: es el perfil de UN usuario concreto, y una respuesta
      // reutilizada le mostraria a un alumno el nombre de otro.
      cache: 'no-store',
    });

    if (!response.ok) return null;
    return (await response.json()) as Profile;
  } catch (error) {
    console.error('No se pudo leer el perfil del usuario', error);
    return null;
  }
}

/**
 * La sesion, o a ingresar.
 *
 * Redirige en vez de lanzar. El layout de los portales ya comprueba la sesion,
 * pero Next renderiza layout y pagina EN PARALELO: la pagina llega aqui antes
 * de que la redireccion del layout surta efecto, y una excepcion en ese momento
 * llena el log de errores en un caso que no lo es. `redirect()` es lo que Next
 * espera y no deja rastro de error.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect('/ingresar');
  return session;
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export const SESSION_COOKIES = { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };

interface AccessClaims {
  sub: string;
  exp: number;
  roles?: string[];
  perms?: string[];
  inst?: string;
  loc?: string;
}

/**
 * Decodifica el payload SIN verificar la firma.
 *
 * Es deliberado y esta acotado: aqui solo se usa para decidir que pintar. La
 * verificacion criptografica la hace cada microservicio en cada llamada, que es
 * donde importa. Verificar tambien en el frontend obligaria a repartirle el
 * secreto de firma, que es exactamente lo que no se debe hacer.
 */
function decodeAccessToken(token: string): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as AccessClaims;
  } catch {
    return null;
  }
}

/**
 * Que portal le toca a este usuario.
 *
 * El backend ya lo resuelve al iniciar sesion y lo devuelve; esto es el respaldo
 * para cuando solo se tiene el token. El orden importa: un docente que ademas es
 * administrador de su institucion entra al portal de administracion, que es el
 * que contiene al otro.
 */
function resolvePortal(roles: string[], hint?: string): SessionUser['portal'] {
  if (hint === 'discover' || hint === 'academy' || hint === 'teacher') return hint;
  if (hint === 'institution' || hint === 'admin') return hint;

  if (roles.some((role) => role.startsWith('platform_') || role === 'content_manager')) {
    return 'admin';
  }
  if (roles.includes('institution_admin')) return 'institution';
  if (roles.includes('teacher')) return 'teacher';
  return 'discover';
}
