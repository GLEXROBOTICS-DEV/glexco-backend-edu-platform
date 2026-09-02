import {
  AggregateRoot,
  BusinessRuleError,
  DomainEvent,
  ForbiddenError,
  type DomainEventContext,
} from '@glexco/kernel';
import {
  EVENTS,
  GRADE_LEVEL,
  INSTITUTION_STATUS,
  LICENSE_STATUS,
  type Grade,
  type InstitutionStatus,
  type LicenseStatus,
} from '@glexco/contracts';
import {
  ContactInfo,
  EducationLevels,
  InstitutionCode,
  InstitutionId,
  InstitutionName,
} from './value-objects';

const AGGREGATE = 'Institution';

// ---------------------------------------------------------------------------
// Licencia
// ---------------------------------------------------------------------------

/**
 * Licencia de uso de la plataforma.
 *
 * Es una entidad interna del agregado Institution, no una raiz propia: no tiene
 * sentido fuera de su institucion y su regla principal -"una institucion no
 * puede tener dos licencias activas solapadas"- necesita ver todas las licencias
 * a la vez.
 *
 * `seats` es el numero de alumnos contratado. Se comprueba de forma informativa
 * y NO bloquea la matricula: dejar a un nino sin acceso a mitad de curso por un
 * asunto administrativo es un problema comercial resuelto de la peor manera
 * posible. Se avisa y se factura, no se corta.
 */
export interface License {
  id: string;
  seats: number;
  startsAt: Date;
  expiresAt: Date;
  status: LicenseStatus;
  /** Referencia al contrato o la orden de compra, para el equipo comercial. */
  reference: string | null;
  grantedBy: string;
  grantedAt: Date;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export interface InstitutionCreatedPayload {
  institutionId: string;
  code: string;
  name: string;
  shortName: string;
  educationLevels: string[];
  city: string;
  createdBy: string;
  createdAt: string;
}

export class InstitutionCreated extends DomainEvent<InstitutionCreatedPayload> {
  constructor(payload: InstitutionCreatedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.INSTITUTION_CREATED, AGGREGATE, payload.institutionId, version, payload, context);
  }
}

export interface InstitutionSuspendedPayload {
  institutionId: string;
  reason: string;
  suspendedBy: string;
  at: string;
}

export class InstitutionSuspended extends DomainEvent<InstitutionSuspendedPayload> {
  constructor(payload: InstitutionSuspendedPayload, version: number, context?: DomainEventContext) {
    super(
      EVENTS.INSTITUTION_SUSPENDED,
      AGGREGATE,
      payload.institutionId,
      version,
      payload,
      context,
    );
  }
}

export interface LicenseGrantedPayload {
  institutionId: string;
  licenseId: string;
  seats: number;
  startsAt: string;
  expiresAt: string;
  grantedBy: string;
}

export class LicenseGranted extends DomainEvent<LicenseGrantedPayload> {
  constructor(payload: LicenseGrantedPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.LICENSE_GRANTED, AGGREGATE, payload.institutionId, version, payload, context);
  }
}

export interface LicenseExpiredPayload {
  institutionId: string;
  licenseId: string;
  expiredAt: string;
}

export class LicenseExpired extends DomainEvent<LicenseExpiredPayload> {
  constructor(payload: LicenseExpiredPayload, version: number, context?: DomainEventContext) {
    super(EVENTS.LICENSE_EXPIRED, AGGREGATE, payload.institutionId, version, payload, context);
  }
}

// ---------------------------------------------------------------------------
// Agregado
// ---------------------------------------------------------------------------

interface InstitutionState {
  code: InstitutionCode;
  name: InstitutionName;
  educationLevels: EducationLevels;
  contact: ContactInfo;
  status: InstitutionStatus;
  licenses: License[];
  /** Conteo denormalizado para el panel. La verdad esta en el servicio de
   *  identidad; esto es una proyeccion que se actualiza por evento y solo se usa
   *  para mostrar cifras, nunca para decidir nada. */
  studentCount: number;
  teacherCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Institucion educativa.
 *
 * Es la raiz del aislamiento multi-tenant: casi todo dato de la plataforma
 * cuelga, directa o indirectamente, de una institucion. Solo el personal de
 * GLEXCO puede crearlas.
 */
export class Institution extends AggregateRoot<InstitutionId> {
  private constructor(
    id: InstitutionId,
    private state: InstitutionState,
  ) {
    super(id);
  }

  static create(input: {
    id: InstitutionId;
    code: InstitutionCode;
    name: InstitutionName;
    educationLevels: EducationLevels;
    contact: ContactInfo;
    createdBy: string;
    now: Date;
  }): Institution {
    const institution = new Institution(input.id, {
      code: input.code,
      name: input.name,
      educationLevels: input.educationLevels,
      contact: input.contact,
      status: INSTITUTION_STATUS.ACTIVE,
      licenses: [],
      studentCount: 0,
      teacherCount: 0,
      createdAt: input.now,
      updatedAt: input.now,
    });

    institution.record(
      (version) =>
        new InstitutionCreated(
          {
            institutionId: input.id.value,
            code: input.code.value,
            name: input.name.value,
            shortName: input.name.short,
            educationLevels: [...input.educationLevels.levels],
            city: input.contact.city,
            createdBy: input.createdBy,
            createdAt: input.now.toISOString(),
          },
          version,
          { actorId: input.createdBy, tenantId: input.id.value },
        ),
    );

    return institution;
  }

  static rehydrate(id: InstitutionId, state: InstitutionState, version: number): Institution {
    const institution = new Institution(id, state);
    institution.setVersion(version);
    return institution;
  }

  // -------------------------------------------------------------------------
  // Licencias
  // -------------------------------------------------------------------------

  /** Licencia vigente en una fecha dada, si la hay. */
  activeLicenseAt(reference: Date): License | null {
    return (
      this.state.licenses.find(
        (license) =>
          license.status !== LICENSE_STATUS.CANCELLED &&
          license.startsAt <= reference &&
          license.expiresAt > reference,
      ) ?? null
    );
  }

  grantLicense(input: {
    licenseId: string;
    seats: number;
    startsAt: Date;
    expiresAt: Date;
    reference?: string | null;
    grantedBy: string;
    now: Date;
  }): void {
    if (input.expiresAt <= input.startsAt) {
      throw new BusinessRuleError(
        'LICENSE_INVALID_PERIOD',
        'La licencia debe terminar despues de empezar.',
      );
    }
    if (input.seats < 1) {
      throw new BusinessRuleError('LICENSE_INVALID_SEATS', 'La licencia debe cubrir al menos una plaza.');
    }

    // Dos licencias solapadas harian ambiguo cual manda al contar plazas y al
    // avisar de vencimientos. Renovar es extender o sustituir, no acumular.
    const overlapping = this.state.licenses.find(
      (license) =>
        license.status !== LICENSE_STATUS.CANCELLED &&
        license.startsAt < input.expiresAt &&
        license.expiresAt > input.startsAt,
    );

    if (overlapping) {
      throw new BusinessRuleError(
        'LICENSE_PERIOD_OVERLAPS',
        'Ya existe una licencia vigente en ese periodo. Cancelala o renuevala en vez de anadir otra.',
        { existingLicenseId: overlapping.id },
      );
    }

    this.state.licenses.push({
      id: input.licenseId,
      seats: input.seats,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      status: LICENSE_STATUS.ACTIVE,
      reference: input.reference ?? null,
      grantedBy: input.grantedBy,
      grantedAt: input.now,
    });

    this.state.updatedAt = input.now;

    this.record(
      (version) =>
        new LicenseGranted(
          {
            institutionId: this.id.value,
            licenseId: input.licenseId,
            seats: input.seats,
            startsAt: input.startsAt.toISOString(),
            expiresAt: input.expiresAt.toISOString(),
            grantedBy: input.grantedBy,
          },
          version,
          { actorId: input.grantedBy, tenantId: this.id.value },
        ),
    );
  }

  /**
   * Recalcula el estado de las licencias segun la fecha.
   *
   * `expiring_soon` se marca 30 dias antes: es el aviso que el equipo comercial
   * necesita para renovar sin que el colegio note nada. Se ejecuta desde una
   * tarea periodica.
   */
  refreshLicenseStatuses(now: Date): void {
    const THIRTY_DAYS_MS = 30 * 86_400_000;

    for (const license of this.state.licenses) {
      if (license.status === LICENSE_STATUS.CANCELLED) continue;

      const previous = license.status;

      if (license.expiresAt <= now) {
        license.status = LICENSE_STATUS.EXPIRED;
        if (previous !== LICENSE_STATUS.EXPIRED) {
          this.record(
            (version) =>
              new LicenseExpired(
                {
                  institutionId: this.id.value,
                  licenseId: license.id,
                  expiredAt: license.expiresAt.toISOString(),
                },
                version,
                { tenantId: this.id.value },
              ),
          );
        }
      } else if (license.expiresAt.getTime() - now.getTime() <= THIRTY_DAYS_MS) {
        license.status = LICENSE_STATUS.EXPIRING_SOON;
      } else {
        license.status = LICENSE_STATUS.ACTIVE;
      }
    }

    this.state.updatedAt = now;
  }

  /**
   * Comprueba si quedan plazas de licencia.
   *
   * Devuelve un aviso en vez de lanzar. Es deliberado: la falta de plazas es un
   * asunto comercial, y cortarle el acceso a un alumno a mitad de curso por eso
   * castiga a quien no tiene culpa. Se avisa al panel y se factura.
   */
  seatUsageAt(reference: Date): { seats: number; used: number; exceeded: boolean } | null {
    const license = this.activeLicenseAt(reference);
    if (!license) return null;

    return {
      seats: license.seats,
      used: this.state.studentCount,
      exceeded: this.state.studentCount > license.seats,
    };
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  suspend(reason: string, by: string, now: Date): void {
    if (this.state.status === INSTITUTION_STATUS.SUSPENDED) return;

    this.state.status = INSTITUTION_STATUS.SUSPENDED;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new InstitutionSuspended(
          { institutionId: this.id.value, reason, suspendedBy: by, at: now.toISOString() },
          version,
          { actorId: by, tenantId: this.id.value },
        ),
    );
  }

  reactivate(now: Date): void {
    if (this.state.status !== INSTITUTION_STATUS.SUSPENDED) return;
    this.state.status = INSTITUTION_STATUS.ACTIVE;
    this.state.updatedAt = now;
  }

  updateContact(contact: ContactInfo, now: Date): void {
    this.state.contact = contact;
    this.state.updatedAt = now;
  }

  updateName(name: InstitutionName, now: Date): void {
    this.state.name = name;
    this.state.updatedAt = now;
  }

  /** Actualiza los conteos de la proyeccion al consumir eventos de identidad. */
  applyMemberCounts(input: { students?: number; teachers?: number }, now: Date): void {
    if (input.students !== undefined) this.state.studentCount = Math.max(0, input.students);
    if (input.teachers !== undefined) this.state.teacherCount = Math.max(0, input.teachers);
    this.state.updatedAt = now;
  }

  // -------------------------------------------------------------------------
  // Reglas de uso
  // -------------------------------------------------------------------------

  /**
   * Comprueba que la institucion admite un grado concreto.
   *
   * Impide que un colegio de solo primaria cree un salon de 4.º de secundaria,
   * que es un error de tecleo frecuente y produce salones que ningun alumno
   * puede encontrar.
   */
  assertOffersGrade(grade: Grade): void {
    if (!this.state.educationLevels.includes(GRADE_LEVEL[grade])) {
      throw new BusinessRuleError(
        'GRADE_NOT_OFFERED',
        'La institucion no atiende el nivel educativo de ese grado.',
        { grade, offeredLevels: [...this.state.educationLevels.levels] },
      );
    }
  }

  /** Una institucion suspendida no admite altas nuevas, pero los usuarios que ya
   *  existen conservan su acceso: suspender es una medida administrativa contra
   *  la institucion, no un castigo a sus alumnos. */
  assertAcceptsNewMembers(): void {
    if (this.state.status !== INSTITUTION_STATUS.ACTIVE) {
      throw new ForbiddenError(
        'INSTITUTION_NOT_ACTIVE',
        'La institucion no admite nuevos registros en este momento.',
        { status: this.state.status },
      );
    }
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  get code(): InstitutionCode {
    return this.state.code;
  }
  get name(): InstitutionName {
    return this.state.name;
  }
  get educationLevels(): EducationLevels {
    return this.state.educationLevels;
  }
  get contact(): ContactInfo {
    return this.state.contact;
  }
  get status(): InstitutionStatus {
    return this.state.status;
  }
  get licenses(): readonly License[] {
    return this.state.licenses;
  }
  get studentCount(): number {
    return this.state.studentCount;
  }
  get teacherCount(): number {
    return this.state.teacherCount;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }

  snapshot(): Readonly<InstitutionState> {
    return this.state;
  }
}
