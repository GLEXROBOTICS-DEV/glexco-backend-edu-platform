import { PORTALS, ROLES, type Portal } from '@glexco/contracts';
import { BirthDate } from '../domain/user/value-objects';
import type { User } from '../domain/user/user.aggregate';

/**
 * Decide a que portal entra el usuario tras autenticarse.
 *
 * El orden importa: un usuario puede acumular roles (un docente que ademas es
 * coordinador, un administrador de institucion que tambien da clase), y entra
 * siempre por el de MAYOR alcance. Entrar por el portal mas limitado obligaria a
 * buscar un conmutador escondido y genera la sensacion de que "la plataforma no
 * me deja hacer lo mio".
 *
 * Para los alumnos, la separacion Discover/Academy se decide por la edad y no
 * por el grado declarado. Motivo: el grado lo escribe el propio alumno en el
 * formulario y se equivoca a menudo; la fecha de nacimiento es un dato mas
 * fiable, y el corte en 12 anos coincide con el final de primaria en Peru.
 */
export function resolvePortal(user: User): Portal {
  const roles = user.roles;

  if (
    roles.includes(ROLES.PLATFORM_OWNER) ||
    roles.includes(ROLES.PLATFORM_ADMIN) ||
    roles.includes(ROLES.CONTENT_MANAGER) ||
    roles.includes(ROLES.SUPPORT_AGENT) ||
    roles.includes(ROLES.COMMERCIAL_AGENT)
  ) {
    return PORTALS.ADMIN;
  }

  if (roles.includes(ROLES.INSTITUTION_ADMIN)) return PORTALS.INSTITUTION;
  if (roles.includes(ROLES.TEACHER)) return PORTALS.TEACHER;

  return resolveStudentPortal(user);
}

/** Corte de edad entre Discover (primaria) y Academy. */
const DISCOVER_MAX_AGE = 12;

function resolveStudentPortal(user: User): Portal {
  const birthDate = user.birthDate;

  // Sin fecha de nacimiento (cuentas creadas por importacion antigua) se cae a
  // Academy: mostrar la interfaz infantil a un universitario es peor error que
  // lo contrario, porque resulta condescendiente.
  if (!birthDate) return PORTALS.ACADEMY;

  const age = birthDate.ageAt(new Date());
  return age <= DISCOVER_MAX_AGE ? PORTALS.DISCOVER : PORTALS.ACADEMY;
}

/** Expuesto para pruebas y para reutilizarlo al reasignar portal por evento. */
export const PORTAL_AGE_THRESHOLD = {
  discoverMaxAge: DISCOVER_MAX_AGE,
  guardianRequiredBelow: BirthDate.GUARDIAN_REQUIRED_BELOW,
} as const;
