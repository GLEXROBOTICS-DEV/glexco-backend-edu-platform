/**
 * Modelo de autorizacion de la plataforma GLEXCO.
 *
 * Es RBAC con alcance (scoped RBAC), no RBAC plano. Un permiso por si solo no
 * basta: `classroom:read` significa cosas distintas para un profesor (sus
 * salones) y para un administrador de institucion (todos los salones de SU
 * colegio). Por eso cada rol declara ademas su AMBITO, y los casos de uso
 * combinan permiso + ambito antes de responder.
 *
 * Motivo de diseno: la plataforma es multi-institucion. Una fuga entre colegios
 * seria un incidente grave con datos de menores de edad, asi que el aislamiento
 * por institucion se comprueba en la capa de aplicacion de cada servicio y no
 * solo en el gateway.
 */

export const ROLES = {
  /** Dueno de la plataforma. Puede todo, incluido gestionar otros administradores GLEXCO. */
  PLATFORM_OWNER: 'platform_owner',
  /** Empleado GLEXCO: contenido base, cursos, instituciones, metricas globales. */
  PLATFORM_ADMIN: 'platform_admin',
  /** Equipo academico GLEXCO: crea y edita contenido y evaluaciones, sin tocar usuarios ni comercial. */
  CONTENT_MANAGER: 'content_manager',
  /** Mesa de ayuda GLEXCO: tickets, reseteo de acceso, lectura de diagnostico. */
  SUPPORT_AGENT: 'support_agent',
  /** Equipo comercial GLEXCO: instituciones, licencias, renovaciones. Sin acceso academico individual. */
  COMMERCIAL_AGENT: 'commercial_agent',
  /** Administrador de una institucion educativa concreta. */
  INSTITUTION_ADMIN: 'institution_admin',
  /** Docente. Opera sobre los salones que le pertenecen. */
  TEACHER: 'teacher',
  /** Alumno. Solo ve el contenido del kit que activo con su codigo de libro. */
  STUDENT: 'student',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: readonly Role[] = Object.values(ROLES);

/**
 * Ambito de actuacion de un rol.
 *
 * - `platform`: opera por encima de todas las instituciones (personal GLEXCO).
 * - `institution`: limitado a su institucion.
 * - `classroom`: limitado a los salones donde es titular.
 * - `self`: limitado a sus propios datos.
 */
export const ROLE_SCOPE: Record<Role, 'platform' | 'institution' | 'classroom' | 'self'> = {
  [ROLES.PLATFORM_OWNER]: 'platform',
  [ROLES.PLATFORM_ADMIN]: 'platform',
  [ROLES.CONTENT_MANAGER]: 'platform',
  [ROLES.SUPPORT_AGENT]: 'platform',
  [ROLES.COMMERCIAL_AGENT]: 'platform',
  [ROLES.INSTITUTION_ADMIN]: 'institution',
  [ROLES.TEACHER]: 'classroom',
  [ROLES.STUDENT]: 'self',
};

/**
 * Permisos, en formato `recurso:accion`.
 *
 * Se declaran como constantes y no como cadenas sueltas para que renombrar uno
 * sea un error de compilacion en todo el monorepo, frontend incluido.
 */
export const PERMISSIONS = {
  // --- Contenido base (tutoriales, videos, documentos, PPT, guias) ---
  CONTENT_READ: 'content:read',
  CONTENT_CREATE: 'content:create',
  CONTENT_UPDATE: 'content:update',
  CONTENT_DELETE: 'content:delete',
  CONTENT_PUBLISH: 'content:publish',

  // --- Cursos, modulos, lecciones y rutas formativas ---
  COURSE_READ: 'course:read',
  COURSE_CREATE: 'course:create',
  COURSE_UPDATE: 'course:update',
  COURSE_DELETE: 'course:delete',
  COURSE_PUBLISH: 'course:publish',

  // --- Kits, libros y codigos de activacion ---
  KIT_READ: 'kit:read',
  KIT_MANAGE: 'kit:manage',
  ACTIVATION_CODE_GENERATE: 'activation_code:generate',
  ACTIVATION_CODE_READ: 'activation_code:read',
  ACTIVATION_CODE_REVOKE: 'activation_code:revoke',
  ACTIVATION_CODE_REDEEM: 'activation_code:redeem',

  // --- Instituciones y licencias ---
  INSTITUTION_READ: 'institution:read',
  INSTITUTION_CREATE: 'institution:create',
  INSTITUTION_UPDATE: 'institution:update',
  INSTITUTION_DEACTIVATE: 'institution:deactivate',
  LICENSE_READ: 'license:read',
  LICENSE_MANAGE: 'license:manage',

  // --- Usuarios ---
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',
  USER_RESET_PASSWORD: 'user:reset_password',
  USER_ASSIGN_ROLE: 'user:assign_role',
  /** Crear administradores de institucion: exclusivo de GLEXCO. */
  INSTITUTION_ADMIN_CREATE: 'institution_admin:create',
  /** Crear docentes: GLEXCO y el administrador de la institucion. */
  TEACHER_CREATE: 'teacher:create',

  // --- Salones ---
  CLASSROOM_READ: 'classroom:read',
  CLASSROOM_CREATE: 'classroom:create',
  CLASSROOM_UPDATE: 'classroom:update',
  CLASSROOM_DELETE: 'classroom:delete',
  CLASSROOM_MANAGE_ROSTER: 'classroom:manage_roster',

  // --- Mensajes y anuncios del salon ---
  ANNOUNCEMENT_READ: 'announcement:read',
  ANNOUNCEMENT_PUBLISH: 'announcement:publish',
  ANNOUNCEMENT_DELETE: 'announcement:delete',

  // --- Evaluaciones ---
  ASSESSMENT_READ: 'assessment:read',
  ASSESSMENT_CREATE: 'assessment:create',
  ASSESSMENT_UPDATE: 'assessment:update',
  ASSESSMENT_DELETE: 'assessment:delete',
  ASSESSMENT_ASSIGN: 'assessment:assign',
  ASSESSMENT_SUBMIT: 'assessment:submit',
  ASSESSMENT_GRADE: 'assessment:grade',
  RUBRIC_MANAGE: 'rubric:manage',

  // --- Progreso y portafolio ---
  PROGRESS_READ_OWN: 'progress:read_own',
  PROGRESS_READ_CLASSROOM: 'progress:read_classroom',
  PROGRESS_READ_INSTITUTION: 'progress:read_institution',
  PROGRESS_READ_PLATFORM: 'progress:read_platform',
  PORTFOLIO_MANAGE_OWN: 'portfolio:manage_own',

  // --- Certificados ---
  CERTIFICATE_READ_OWN: 'certificate:read_own',
  CERTIFICATE_ISSUE: 'certificate:issue',
  CERTIFICATE_TEMPLATE_MANAGE: 'certificate_template:manage',
  CERTIFICATE_REVOKE: 'certificate:revoke',

  // --- Analitica ---
  ANALYTICS_READ_CLASSROOM: 'analytics:read_classroom',
  ANALYTICS_READ_INSTITUTION: 'analytics:read_institution',
  ANALYTICS_READ_PLATFORM: 'analytics:read_platform',
  ANALYTICS_EXPORT: 'analytics:export',

  // --- Soporte ---
  SUPPORT_TICKET_CREATE: 'support_ticket:create',
  SUPPORT_TICKET_READ_OWN: 'support_ticket:read_own',
  SUPPORT_TICKET_MANAGE: 'support_ticket:manage',
  KNOWLEDGE_BASE_MANAGE: 'knowledge_base:manage',

  // --- Comercial ---
  COMMERCIAL_READ: 'commercial:read',
  COMMERCIAL_MANAGE: 'commercial:manage',

  // --- Configuracion de plataforma ---
  PLATFORM_SETTINGS_MANAGE: 'platform_settings:manage',
  AUDIT_LOG_READ: 'audit_log:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

/** Permisos que TODO usuario autenticado tiene sobre si mismo. */
const SELF_SERVICE: readonly Permission[] = [
  P.SUPPORT_TICKET_CREATE,
  P.SUPPORT_TICKET_READ_OWN,
  P.ANNOUNCEMENT_READ,
];

const STUDENT_PERMISSIONS: readonly Permission[] = [
  ...SELF_SERVICE,
  P.CONTENT_READ,
  P.COURSE_READ,
  P.KIT_READ,
  P.ACTIVATION_CODE_REDEEM,
  P.ASSESSMENT_READ,
  P.ASSESSMENT_SUBMIT,
  P.PROGRESS_READ_OWN,
  P.PORTFOLIO_MANAGE_OWN,
  P.CERTIFICATE_READ_OWN,
];

const TEACHER_PERMISSIONS: readonly Permission[] = [
  ...STUDENT_PERMISSIONS.filter((p) => p !== P.ACTIVATION_CODE_REDEEM),
  P.CLASSROOM_READ,
  P.CLASSROOM_CREATE,
  P.CLASSROOM_UPDATE,
  P.CLASSROOM_DELETE,
  P.CLASSROOM_MANAGE_ROSTER,
  P.ANNOUNCEMENT_PUBLISH,
  P.ANNOUNCEMENT_DELETE,
  P.ASSESSMENT_CREATE,
  P.ASSESSMENT_UPDATE,
  P.ASSESSMENT_DELETE,
  P.ASSESSMENT_ASSIGN,
  P.ASSESSMENT_GRADE,
  P.RUBRIC_MANAGE,
  P.PROGRESS_READ_CLASSROOM,
  P.ANALYTICS_READ_CLASSROOM,
  P.ANALYTICS_EXPORT,
  P.USER_READ,
];

const INSTITUTION_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...TEACHER_PERMISSIONS,
  P.TEACHER_CREATE,
  P.USER_CREATE,
  P.USER_UPDATE,
  P.USER_DEACTIVATE,
  P.USER_RESET_PASSWORD,
  P.INSTITUTION_READ,
  P.INSTITUTION_UPDATE,
  P.LICENSE_READ,
  P.ACTIVATION_CODE_READ,
  P.PROGRESS_READ_INSTITUTION,
  P.ANALYTICS_READ_INSTITUTION,
  P.CERTIFICATE_ISSUE,
];

const CONTENT_MANAGER_PERMISSIONS: readonly Permission[] = [
  ...SELF_SERVICE,
  P.CONTENT_READ,
  P.CONTENT_CREATE,
  P.CONTENT_UPDATE,
  P.CONTENT_DELETE,
  P.CONTENT_PUBLISH,
  P.COURSE_READ,
  P.COURSE_CREATE,
  P.COURSE_UPDATE,
  P.COURSE_DELETE,
  P.COURSE_PUBLISH,
  P.KIT_READ,
  P.KIT_MANAGE,
  P.ASSESSMENT_READ,
  P.ASSESSMENT_CREATE,
  P.ASSESSMENT_UPDATE,
  P.ASSESSMENT_DELETE,
  P.RUBRIC_MANAGE,
  P.CERTIFICATE_TEMPLATE_MANAGE,
  P.ANALYTICS_READ_PLATFORM,
  P.KNOWLEDGE_BASE_MANAGE,
];

const SUPPORT_AGENT_PERMISSIONS: readonly Permission[] = [
  ...SELF_SERVICE,
  P.CONTENT_READ,
  P.COURSE_READ,
  P.USER_READ,
  P.USER_RESET_PASSWORD,
  P.INSTITUTION_READ,
  P.CLASSROOM_READ,
  P.ACTIVATION_CODE_READ,
  P.SUPPORT_TICKET_MANAGE,
  P.KNOWLEDGE_BASE_MANAGE,
  P.AUDIT_LOG_READ,
];

const COMMERCIAL_AGENT_PERMISSIONS: readonly Permission[] = [
  ...SELF_SERVICE,
  P.INSTITUTION_READ,
  P.INSTITUTION_CREATE,
  P.INSTITUTION_UPDATE,
  P.LICENSE_READ,
  P.LICENSE_MANAGE,
  P.COMMERCIAL_READ,
  P.COMMERCIAL_MANAGE,
  P.ANALYTICS_READ_INSTITUTION,
  P.ANALYTICS_EXPORT,
];

const PLATFORM_ADMIN_PERMISSIONS: readonly Permission[] = [
  ...new Set<Permission>([
    ...CONTENT_MANAGER_PERMISSIONS,
    ...SUPPORT_AGENT_PERMISSIONS,
    ...COMMERCIAL_AGENT_PERMISSIONS,
    P.INSTITUTION_DEACTIVATE,
    P.INSTITUTION_ADMIN_CREATE,
    P.TEACHER_CREATE,
    P.USER_CREATE,
    P.USER_UPDATE,
    P.USER_DEACTIVATE,
    P.USER_ASSIGN_ROLE,
    P.CLASSROOM_READ,
    P.ACTIVATION_CODE_GENERATE,
    P.ACTIVATION_CODE_REVOKE,
    P.ASSESSMENT_ASSIGN,
    P.PROGRESS_READ_PLATFORM,
    P.ANALYTICS_READ_PLATFORM,
    P.ANALYTICS_EXPORT,
    P.CERTIFICATE_ISSUE,
    P.CERTIFICATE_REVOKE,
    P.ANNOUNCEMENT_PUBLISH,
    P.PLATFORM_SETTINGS_MANAGE,
  ]),
];

/**
 * Matriz rol -> permisos.
 *
 * El servicio de identidad la resuelve al emitir el token y guarda el resultado
 * en el access token, para que ningun otro servicio tenga que consultar a
 * identidad en cada peticion (evita un punto unico de fallo y una llamada de red
 * por request). El precio es que un cambio de rol tarda como maximo lo que dura
 * el access token en propagarse: por eso su TTL es de 15 minutos.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [ROLES.PLATFORM_OWNER]: Object.values(PERMISSIONS),
  [ROLES.PLATFORM_ADMIN]: PLATFORM_ADMIN_PERMISSIONS,
  [ROLES.CONTENT_MANAGER]: CONTENT_MANAGER_PERMISSIONS,
  [ROLES.SUPPORT_AGENT]: SUPPORT_AGENT_PERMISSIONS,
  [ROLES.COMMERCIAL_AGENT]: COMMERCIAL_AGENT_PERMISSIONS,
  [ROLES.INSTITUTION_ADMIN]: INSTITUTION_ADMIN_PERMISSIONS,
  [ROLES.TEACHER]: TEACHER_PERMISSIONS,
  [ROLES.STUDENT]: STUDENT_PERMISSIONS,
};

/** Permisos efectivos de un conjunto de roles, sin duplicados. */
export function resolvePermissions(roles: readonly Role[]): Permission[] {
  const effective = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) effective.add(permission);
  }
  return [...effective];
}

/**
 * Que roles puede crear cada rol.
 *
 * Se declara explicito para cerrar la escalada de privilegios: sin esta tabla,
 * un administrador de institucion con `user:create` podria fabricarse un
 * `platform_admin`.
 */
export const ROLE_CREATION_MATRIX: Record<Role, readonly Role[]> = {
  [ROLES.PLATFORM_OWNER]: ALL_ROLES,
  [ROLES.PLATFORM_ADMIN]: [
    ROLES.CONTENT_MANAGER,
    ROLES.SUPPORT_AGENT,
    ROLES.COMMERCIAL_AGENT,
    ROLES.INSTITUTION_ADMIN,
    ROLES.TEACHER,
    ROLES.STUDENT,
  ],
  [ROLES.CONTENT_MANAGER]: [],
  [ROLES.SUPPORT_AGENT]: [],
  [ROLES.COMMERCIAL_AGENT]: [],
  [ROLES.INSTITUTION_ADMIN]: [ROLES.TEACHER, ROLES.STUDENT],
  [ROLES.TEACHER]: [],
  [ROLES.STUDENT]: [],
};

export function canCreateRole(actorRoles: readonly Role[], target: Role): boolean {
  return actorRoles.some((role) => ROLE_CREATION_MATRIX[role]?.includes(target));
}

/** Roles de personal interno de GLEXCO (no pertenecen a ninguna institucion). */
export const PLATFORM_ROLES: readonly Role[] = [
  ROLES.PLATFORM_OWNER,
  ROLES.PLATFORM_ADMIN,
  ROLES.CONTENT_MANAGER,
  ROLES.SUPPORT_AGENT,
  ROLES.COMMERCIAL_AGENT,
];

export const isPlatformRole = (role: Role): boolean => PLATFORM_ROLES.includes(role);

/**
 * Portal al que se redirige al usuario tras autenticarse.
 * El orden importa: un usuario con varios roles entra por el de mayor alcance.
 */
export const PORTALS = {
  DISCOVER: 'discover',
  ACADEMY: 'academy',
  TEACHER: 'teacher',
  INSTITUTION: 'institution',
  ADMIN: 'admin',
} as const;

export type Portal = (typeof PORTALS)[keyof typeof PORTALS];
