import {
  AggregateRoot,
  DomainEvent,
  ForbiddenError,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import { EVENTS } from '@glexco/contracts';

export class EntitlementId extends defineId('Entitlement') {}

const AGGREGATE = 'Entitlement';

export interface EntitlementGrantedPayload {
  entitlementId: string;
  studentId: string;
  kitId: string;
  grade: string;
  institutionId: string | null;
  sourceActivationCodeId: string;
  grantedAt: string;
}

export class EntitlementGranted extends DomainEvent<EntitlementGrantedPayload> {
  constructor(payload: EntitlementGrantedPayload, version: number, context?: DomainEventContext) {
    super(
      EVENTS.KIT_ENTITLEMENT_GRANTED,
      AGGREGATE,
      payload.entitlementId,
      version,
      payload,
      context,
    );
  }
}

export interface EntitlementRevokedPayload {
  entitlementId: string;
  studentId: string;
  kitId: string;
  reason: string;
  revokedAt: string;
}

export class EntitlementRevoked extends DomainEvent<EntitlementRevokedPayload> {
  constructor(payload: EntitlementRevokedPayload, version: number, context?: DomainEventContext) {
    super(
      EVENTS.KIT_ENTITLEMENT_REVOKED,
      AGGREGATE,
      payload.entitlementId,
      version,
      payload,
      context,
    );
  }
}

interface EntitlementState {
  studentId: string;
  kitId: string;
  grade: string;
  institutionId: string | null;
  sourceActivationCodeId: string;
  active: boolean;
  revokedReason: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
}

/**
 * Derecho de acceso de un alumno al contenido de un kit.
 *
 * Es la respuesta a la regla central del negocio: *"un alumno puede ver los
 * contenidos pertenecientes unicamente al kit del libro que compro"*. Todo
 * acceso a contenido pasa por aqui.
 *
 * **No caduca.** Se concede al canjear el codigo y dura mientras la cuenta
 * exista. Quitarle el acceso a un alumno al terminar el curso seria retirarle
 * material que ya pago y al que puede querer volver; ademas, su progreso y sus
 * certificados quedarian apuntando a contenido que no puede abrir.
 *
 * Se revoca solo por anulacion del codigo de origen: error de impresion,
 * devolucion o fraude.
 */
export class Entitlement extends AggregateRoot<EntitlementId> {
  private constructor(
    id: EntitlementId,
    private state: EntitlementState,
  ) {
    super(id);
  }

  static grant(input: {
    id: EntitlementId;
    studentId: string;
    kitId: string;
    grade: string;
    institutionId: string | null;
    sourceActivationCodeId: string;
    now: Date;
  }): Entitlement {
    const entitlement = new Entitlement(input.id, {
      studentId: input.studentId,
      kitId: input.kitId,
      grade: input.grade,
      institutionId: input.institutionId,
      sourceActivationCodeId: input.sourceActivationCodeId,
      active: true,
      revokedReason: null,
      grantedAt: input.now,
      revokedAt: null,
    });

    entitlement.record(
      (version) =>
        new EntitlementGranted(
          {
            entitlementId: input.id.value,
            studentId: input.studentId,
            kitId: input.kitId,
            grade: input.grade,
            institutionId: input.institutionId,
            sourceActivationCodeId: input.sourceActivationCodeId,
            grantedAt: input.now.toISOString(),
          },
          version,
          { actorId: input.studentId, tenantId: input.institutionId ?? undefined },
        ),
    );

    return entitlement;
  }

  static rehydrate(id: EntitlementId, state: EntitlementState, version: number): Entitlement {
    const entitlement = new Entitlement(id, state);
    entitlement.setVersion(version);
    return entitlement;
  }

  /**
   * Retira el acceso.
   *
   * Solo por anulacion del codigo de origen. No borra el registro: el historial
   * de quien tuvo acceso a que y por que dejo de tenerlo tiene valor de
   * auditoria, sobre todo si la anulacion fue por fraude.
   */
  revoke(reason: string, now: Date): void {
    if (!this.state.active) return;

    this.state.active = false;
    this.state.revokedReason = reason;
    this.state.revokedAt = now;

    this.record(
      (version) =>
        new EntitlementRevoked(
          {
            entitlementId: this.id.value,
            studentId: this.state.studentId,
            kitId: this.state.kitId,
            reason,
            revokedAt: now.toISOString(),
          },
          version,
          { tenantId: this.state.institutionId ?? undefined },
        ),
    );
  }

  /**
   * Comprueba que este derecho pertenece al alumno que pide el contenido.
   *
   * Se llama con el recurso ya cargado, que es el unico momento en que se puede
   * comprobar. El guard de permisos sabe que un alumno puede "leer contenido";
   * solo aqui se sabe si ESTE contenido es suyo.
   */
  assertBelongsTo(studentId: string): void {
    if (this.state.studentId !== studentId) {
      throw new ForbiddenError('ENTITLEMENT_NOT_OWNED', 'Este contenido no esta en tu kit.');
    }
    if (!this.state.active) {
      throw new ForbiddenError(
        'ENTITLEMENT_REVOKED',
        'Tu acceso a este contenido fue retirado. Contacta con soporte.',
      );
    }
  }

  get studentId(): string {
    return this.state.studentId;
  }
  get kitId(): string {
    return this.state.kitId;
  }
  get grade(): string {
    return this.state.grade;
  }
  get institutionId(): string | null {
    return this.state.institutionId;
  }
  get isActive(): boolean {
    return this.state.active;
  }
  get grantedAt(): Date {
    return this.state.grantedAt;
  }
  get sourceActivationCodeId(): string {
    return this.state.sourceActivationCodeId;
  }

  snapshot(): Readonly<EntitlementState> {
    return this.state;
  }
}
