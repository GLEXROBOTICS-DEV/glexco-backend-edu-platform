/**
 * Catalogo de eventos de integracion.
 *
 * Convencion: `<contexto>.<agregado>.<hecho-en-pasado>.v<N>`
 *
 * La version va en el nombre y no en el payload porque los consumidores de NATS
 * se suscriben por patron de asunto. Cuando un evento cambie de forma de manera
 * incompatible publicamos `...v2` en paralelo y retiramos `v1` cuando ya nadie
 * lo consuma, sin coordinar un despliegue simultaneo de todos los servicios.
 *
 * Regla: un evento describe un HECHO del negocio, nunca un cambio de fila. No
 * existe `user.updated`; existen `user.email_verified`, `user.deactivated`, etc.
 * Asi el consumidor sabe reaccionar sin comparar estados.
 */

export const EVENTS = {
  // --- identity ---
  USER_REGISTERED: 'identity.user.registered.v1',
  USER_EMAIL_VERIFIED: 'identity.user.email_verified.v1',
  USER_PASSWORD_CHANGED: 'identity.user.password_changed.v1',
  USER_ROLE_GRANTED: 'identity.user.role_granted.v1',
  USER_ROLE_REVOKED: 'identity.user.role_revoked.v1',
  USER_DEACTIVATED: 'identity.user.deactivated.v1',
  USER_REACTIVATED: 'identity.user.reactivated.v1',
  USER_PROFILE_UPDATED: 'identity.user.profile_updated.v1',
  SESSION_STARTED: 'identity.session.started.v1',
  SESSION_REVOKED: 'identity.session.revoked.v1',
  /** Familia de refresh tokens reutilizada: indicio de robo de credencial. */
  SESSION_REUSE_DETECTED: 'identity.session.reuse_detected.v1',

  // --- institutions ---
  INSTITUTION_CREATED: 'institutions.institution.created.v1',
  INSTITUTION_UPDATED: 'institutions.institution.updated.v1',
  INSTITUTION_SUSPENDED: 'institutions.institution.suspended.v1',
  LICENSE_GRANTED: 'institutions.license.granted.v1',
  LICENSE_RENEWED: 'institutions.license.renewed.v1',
  LICENSE_EXPIRED: 'institutions.license.expired.v1',
  CLASSROOM_CREATED: 'institutions.classroom.created.v1',
  CLASSROOM_UPDATED: 'institutions.classroom.updated.v1',
  CLASSROOM_ARCHIVED: 'institutions.classroom.archived.v1',
  STUDENT_ENROLLED: 'institutions.enrollment.student_enrolled.v1',
  STUDENT_WITHDRAWN: 'institutions.enrollment.student_withdrawn.v1',
  TEACHER_ASSIGNED: 'institutions.classroom.teacher_assigned.v1',

  // --- catalog ---
  KIT_PUBLISHED: 'catalog.kit.published.v1',
  COURSE_PUBLISHED: 'catalog.course.published.v1',
  COURSE_UNPUBLISHED: 'catalog.course.unpublished.v1',
  LESSON_PUBLISHED: 'catalog.lesson.published.v1',
  CONTENT_PUBLISHED: 'catalog.content.published.v1',
  CONTENT_ARCHIVED: 'catalog.content.archived.v1',
  ACTIVATION_CODE_BATCH_GENERATED: 'catalog.activation_code.batch_generated.v1',
  ACTIVATION_CODE_REDEEMED: 'catalog.activation_code.redeemed.v1',
  ACTIVATION_CODE_REVOKED: 'catalog.activation_code.revoked.v1',
  /** Un alumno gano acceso al contenido de un kit. Lo consumen learning y analytics. */
  KIT_ENTITLEMENT_GRANTED: 'catalog.entitlement.granted.v1',
  KIT_ENTITLEMENT_REVOKED: 'catalog.entitlement.revoked.v1',

  // --- learning ---
  LESSON_STARTED: 'learning.progress.lesson_started.v1',
  LESSON_COMPLETED: 'learning.progress.lesson_completed.v1',
  COURSE_COMPLETED: 'learning.progress.course_completed.v1',
  CHALLENGE_COMPLETED: 'learning.challenge.completed.v1',
  PORTFOLIO_ITEM_ADDED: 'learning.portfolio.item_added.v1',
  XP_AWARDED: 'learning.gamification.xp_awarded.v1',
  BADGE_AWARDED: 'learning.gamification.badge_awarded.v1',
  EXPLORER_LEVEL_REACHED: 'learning.gamification.level_reached.v1',

  // --- assessment ---
  ASSESSMENT_PUBLISHED: 'assessment.assessment.published.v1',
  ASSESSMENT_ASSIGNED: 'assessment.assignment.created.v1',
  SUBMISSION_RECEIVED: 'assessment.submission.received.v1',
  SUBMISSION_GRADED: 'assessment.submission.graded.v1',
  CERTIFICATE_ISSUED: 'assessment.certificate.issued.v1',
  CERTIFICATE_REVOKED: 'assessment.certificate.revoked.v1',

  // --- engagement ---
  ANNOUNCEMENT_PUBLISHED: 'engagement.announcement.published.v1',
  NOTIFICATION_REQUESTED: 'engagement.notification.requested.v1',
  SUPPORT_TICKET_OPENED: 'engagement.support_ticket.opened.v1',
  SUPPORT_TICKET_RESOLVED: 'engagement.support_ticket.resolved.v1',

  // --- media ---
  MEDIA_UPLOAD_COMPLETED: 'media.asset.upload_completed.v1',
  MEDIA_PROCESSING_FAILED: 'media.asset.processing_failed.v1',
  MEDIA_ASSET_DELETED: 'media.asset.deleted.v1',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Contextos que publican eventos; coincide con el nombre del microservicio. */
export const EVENT_CONTEXTS = [
  'identity',
  'institutions',
  'catalog',
  'learning',
  'assessment',
  'engagement',
  'media',
] as const;
export type EventContext = (typeof EVENT_CONTEXTS)[number];

/** Asunto NATS de un evento. Coincide con su nombre: el patron `identity.>`
 *  suscribe a todo lo que publique identidad. */
export const subjectFor = (event: EventName): string => event;

/** Stream JetStream unico con un asunto raiz por contexto. */
export const STREAM_SUBJECTS = EVENT_CONTEXTS.map((context) => `${context}.>`);
