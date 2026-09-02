import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Clock,
  type ExecutionContext,
  type LoggerPort,
  type UnitOfWork,
  type UseCase,
} from '@glexco/kernel';
import { PERMISSIONS } from '@glexco/contracts';
import { Institution } from '../domain/institution/institution.aggregate';
import {
  ContactInfo,
  EducationLevels,
  InstitutionCode,
  InstitutionId,
  InstitutionName,
} from '../domain/institution/value-objects';
import type { InstitutionRepository } from '../domain/repositories';

export interface CreateInstitutionInput {
  code: string;
  name: string;
  shortName?: string;
  educationLevels: string[];
  responsibleName: string;
  contactEmail: string;
  phone?: string;
  city: string;
  address?: string;
}

export interface CreateInstitutionOutput {
  institutionId: string;
  code: string;
  name: string;
  shortName: string;
}

/**
 * Alta de una institucion educativa.
 *
 * **Solo personal de GLEXCO.** Es la raiz del aislamiento multi-tenant: quien
 * puede crear instituciones puede crear el contenedor de datos de un colegio
 * entero, asi que el permiso no se delega a nadie de fuera de la empresa.
 */
export class CreateInstitutionUseCase
  implements UseCase<CreateInstitutionInput, CreateInstitutionOutput>
{
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: CreateInstitutionInput,
    context: ExecutionContext,
  ): Promise<CreateInstitutionOutput> {
    const actor = context.actor;
    if (!actor?.permissions.includes(PERMISSIONS.INSTITUTION_CREATE)) {
      throw new ForbiddenError(
        'INSUFFICIENT_PERMISSIONS',
        'No tienes permiso para crear instituciones.',
      );
    }

    const now = this.clock.now();
    const code = InstitutionCode.create(input.code);

    // El codigo es la clave que los alumnos teclean en la pantalla de ingreso,
    // asi que debe ser unico. La restriccion unica de la base es la garantia
    // real; esta comprobacion previa solo sirve para dar un mensaje claro.
    if (await this.institutions.existsByCode(code)) {
      throw new ConflictError(
        'INSTITUTION_CODE_TAKEN',
        'Ya existe una institucion con ese codigo.',
        { field: 'code' },
      );
    }

    const institution = Institution.create({
      id: InstitutionId.create(),
      code,
      name: InstitutionName.create(input.name, input.shortName),
      educationLevels: EducationLevels.create(input.educationLevels),
      contact: ContactInfo.create({
        responsibleName: input.responsibleName,
        email: input.contactEmail,
        phone: input.phone,
        city: input.city,
        address: input.address,
      }),
      createdBy: actor.userId,
      now,
    });

    await this.unitOfWork.run(async (tx) => {
      await this.institutions.save(institution, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...institution.pullDomainEvents());
    });

    this.logger.info('Institucion creada', {
      institutionId: institution.id.value,
      code: code.value,
    });

    return {
      institutionId: institution.id.value,
      code: code.value,
      name: institution.name.value,
      shortName: institution.name.short,
    };
  }
}

// ---------------------------------------------------------------------------
// Licencias
// ---------------------------------------------------------------------------

export interface GrantLicenseInput {
  institutionId: string;
  seats: number;
  startsAt: string;
  expiresAt: string;
  reference?: string;
}

export class GrantLicenseUseCase implements UseCase<GrantLicenseInput, { licenseId: string }> {
  constructor(
    private readonly institutions: InstitutionRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  async execute(
    input: GrantLicenseInput,
    context: ExecutionContext,
  ): Promise<{ licenseId: string }> {
    const actor = context.actor;
    if (!actor?.permissions.includes(PERMISSIONS.LICENSE_MANAGE)) {
      throw new ForbiddenError(
        'INSUFFICIENT_PERMISSIONS',
        'No tienes permiso para gestionar licencias.',
      );
    }

    const institution = await this.institutions.findById(
      InstitutionId.create(input.institutionId),
    );
    if (!institution) {
      throw new NotFoundError('INSTITUTION_NOT_FOUND', 'La institucion no existe.');
    }

    const licenseId = randomUUID();

    institution.grantLicense({
      licenseId,
      seats: input.seats,
      startsAt: new Date(input.startsAt),
      expiresAt: new Date(input.expiresAt),
      reference: input.reference,
      grantedBy: actor.userId,
      now: this.clock.now(),
    });

    await this.unitOfWork.run(async (tx) => {
      await this.institutions.save(institution, tx);
      (tx as { enqueue(...events: unknown[]): void }).enqueue(...institution.pullDomainEvents());
    });

    this.logger.info('Licencia concedida', {
      institutionId: input.institutionId,
      licenseId,
      seats: input.seats,
    });

    return { licenseId };
  }
}

// ---------------------------------------------------------------------------
// Busqueda publica por codigo institucional
// ---------------------------------------------------------------------------

export interface LookupInstitutionInput {
  code: string;
}

export interface LookupInstitutionOutput {
  institutionId: string;
  name: string;
  shortName: string;
  city: string;
  educationLevels: string[];
}

/**
 * Busca una institucion por su codigo, para la pantalla de ingreso.
 *
 * Es PUBLICA (sin autenticar) y por eso devuelve el minimo: nombre, ciudad y
 * niveles. Nunca conteos de alumnos, datos del responsable ni estado de la
 * licencia; esa informacion no le interesa a un alumno y a un tercero le daria
 * un mapa comercial gratis de la cartera de clientes de GLEXCO.
 *
 * Una institucion suspendida responde como inexistente: no queremos que un
 * alumno complete un registro que va a fallar al final.
 */
export class LookupInstitutionUseCase
  implements UseCase<LookupInstitutionInput, LookupInstitutionOutput>
{
  constructor(private readonly institutions: InstitutionRepository) {}

  async execute(input: LookupInstitutionInput): Promise<LookupInstitutionOutput> {
    const institution = await this.institutions.findByCode(InstitutionCode.create(input.code));

    if (!institution || institution.status !== 'active') {
      throw new NotFoundError(
        'INSTITUTION_NOT_FOUND',
        'No encontramos una institucion con ese codigo.',
      );
    }

    return {
      institutionId: institution.id.value,
      name: institution.name.value,
      shortName: institution.name.short,
      city: institution.contact.city,
      educationLevels: [...institution.educationLevels.levels],
    };
  }
}
