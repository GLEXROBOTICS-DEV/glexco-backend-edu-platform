import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import {
  PERMISSIONS,
  createClassroomSchema,
  createInstitutionSchema,
  enrollStudentSchema,
  grantLicenseSchema,
  listClassroomsQuerySchema,
  selectableClassroomsQuerySchema,
  updateClassroomSchema,
  type CreateClassroomRequest,
  type CreateInstitutionRequest,
  type GrantLicenseRequest,
  type ListClassroomsQuery,
  type SelectableClassroomsQuery,
  type UpdateClassroomRequest,
} from '@glexco/contracts';
import {
  InternalOnlyGuard,
  Public,
  RequirePermissions,
  zodBody,
  zodQuery,
} from '@glexco/nest-platform';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  CreateInstitutionUseCase,
  GrantLicenseUseCase,
  LookupInstitutionUseCase,
} from '../../application/manage-institutions.usecase';
import {
  CreateClassroomUseCase,
  ListClassroomRosterUseCase,
  ListInstitutionTeachersUseCase,
  ListMyClassroomsUseCase,
  ListClassroomsUseCase,
  ListSelectableClassroomsUseCase,
  UpdateClassroomUseCase,
} from '../../application/manage-classrooms.usecase';
import {
  EnrollStudentUseCase,
  PrecheckClassroomUseCase,
} from '../../application/enroll-student.usecase';
import type { InstitutionRepository as InstitutionRepositoryPort } from '../../domain/repositories';
import { InstitutionId } from '../../domain/institution/value-objects';
import { INSTITUTION_REPOSITORY } from '../../tokens';

/**
 * Construye el contexto de ejecucion desde la peticion HTTP.
 *
 * Es el unico punto del servicio que toca Express; los casos de uso reciben un
 * objeto plano y no saben que existe un servidor web.
 */
function contextFrom(request: Request): UseCaseContext {
  const header = request.headers['accept-language'];
  const locale = typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';

  return {
    correlationId: (request.headers['x-correlation-id'] as string) ?? randomUUID(),
    actor: request.actor
      ? {
          userId: request.actor.userId,
          roles: request.actor.roles,
          institutionId: request.actor.institutionId,
          permissions: request.actor.permissions,
          sessionId: request.actor.sessionId,
        }
      : undefined,
    locale,
    requestedAt: new Date(),
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  };
}

// ---------------------------------------------------------------------------
// Instituciones
// ---------------------------------------------------------------------------

@Controller({ path: 'institutions', version: '1' })
export class InstitutionsController {
  constructor(
    private readonly createInstitution: CreateInstitutionUseCase,
    private readonly grantLicense: GrantLicenseUseCase,
    private readonly lookupInstitution: LookupInstitutionUseCase,
  ) {}

  /** Alta de institucion. Solo personal de GLEXCO. */
  @Post()
  @RequirePermissions(PERMISSIONS.INSTITUTION_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodBody(createInstitutionSchema)) input: CreateInstitutionRequest,
    @Req() request: Request,
  ) {
    return this.createInstitution.execute(input, contextFrom(request));
  }

  @Post(':institutionId/licenses')
  @RequirePermissions(PERMISSIONS.LICENSE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async license(
    @Param('institutionId') institutionId: string,
    @Body(zodBody(grantLicenseSchema)) input: GrantLicenseRequest,
    @Req() request: Request,
  ) {
    return this.grantLicense.execute({ institutionId, ...input }, contextFrom(request));
  }

  /**
   * Busqueda por codigo institucional para la pantalla de ingreso.
   *
   * PUBLICA: se usa antes de que exista una cuenta. Devuelve solo nombre, ciudad
   * y niveles; nunca conteos de alumnos ni datos del responsable, que a un
   * tercero le darian un mapa comercial de la cartera de clientes.
   */
  @Get('by-code/:code')
  @Public()
  async byCode(@Param('code') code: string) {
    return this.lookupInstitution.execute({ code });
  }
}

// ---------------------------------------------------------------------------
// Salones
// ---------------------------------------------------------------------------

@Controller({ path: 'classrooms', version: '1' })
export class ClassroomsController {
  constructor(
    private readonly createClassroom: CreateClassroomUseCase,
    private readonly updateClassroom: UpdateClassroomUseCase,
    private readonly listClassrooms: ListClassroomsUseCase,
    private readonly listSelectable: ListSelectableClassroomsUseCase,
    private readonly enrollStudent: EnrollStudentUseCase,
    private readonly listRoster: ListClassroomRosterUseCase,
    private readonly listMine: ListMyClassroomsUseCase,
    private readonly listTeachers: ListInstitutionTeachersUseCase,
  ) {}

  /**
   * Docentes del colegio, para asignarles un salon.
   *
   * Va ANTES de `:classroomId` en el archivo, y no es cosmetico: Nest resuelve
   * las rutas en orden, asi que declarada despues, "teachers" entraria como
   * identificador de salon y esta ruta no existiria.
   */
  @Get('teachers')
  @RequirePermissions(PERMISSIONS.TEACHER_CREATE)
  async teachers(@Req() request: Request) {
    return this.listTeachers.execute(undefined, contextFrom(request));
  }

  /** Crear salon. Lo pueden hacer el docente y el administrador de institucion. */
  @Post()
  @RequirePermissions(PERMISSIONS.CLASSROOM_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(zodBody(createClassroomSchema)) input: CreateClassroomRequest,
    @Req() request: Request,
  ) {
    return this.createClassroom.execute(input, contextFrom(request));
  }

  /**
   * Salones que el actor puede ver.
   *
   * El alcance lo decide su rol, no un parametro de la peticion: dejar que el
   * cliente pida el alcance seria delegarle una decision de autorizacion.
   */
  @Get()
  @RequirePermissions(PERMISSIONS.CLASSROOM_READ)
  async list(
    @Query(zodQuery(listClassroomsQuerySchema)) query: ListClassroomsQuery,
    @Req() request: Request,
  ) {
    return this.listClassrooms.execute(query, contextFrom(request));
  }

  @Patch(':classroomId')
  @RequirePermissions(PERMISSIONS.CLASSROOM_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async update(
    @Param('classroomId') classroomId: string,
    @Body(zodBody(updateClassroomSchema)) input: UpdateClassroomRequest,
    @Req() request: Request,
  ): Promise<void> {
    await this.updateClassroom.execute({ classroomId, ...input }, contextFrom(request));
  }

  /** Matricula manual desde el panel del docente o del administrador. */
  @Post(':classroomId/enrollments')
  @RequirePermissions(PERMISSIONS.CLASSROOM_MANAGE_ROSTER)
  @HttpCode(HttpStatus.CREATED)
  async enroll(
    @Param('classroomId') classroomId: string,
    @Body(zodBody(enrollStudentSchema)) input: { studentId: string; kitId?: string },
    @Req() request: Request,
  ) {
    const context = contextFrom(request);
    return this.enrollStudent.execute(
      {
        classroomId,
        studentId: input.studentId,
        kitId: input.kitId,
        institutionId: context.actor?.institutionId ?? '',
      },
      context,
    );
  }

  /**
   * El salon del propio alumno.
   *
   * Sin `@RequirePermissions`: basta estar autenticado, porque solo devuelve lo
   * del actor. Un alumno no tiene `CLASSROOM_READ` a proposito -no debe listar
   * salones- pero necesita saber en cual esta para entregar una evaluacion.
   *
   * Se declara ANTES de `:classroomId/roster` para que `mine` no se interprete
   * como un identificador.
   */
  @Get('mine')
  async mine(@Req() request: Request) {
    return this.listMine.execute(undefined, contextFrom(request));
  }

  /**
   * La clase de un salon, con nombres.
   *
   * Va con `CLASSROOM_READ` y no con un permiso propio porque es exactamente la
   * misma informacion que el listado de salones, con una fila por alumno en vez
   * de un contador. El ambito sobre ESTE salon lo comprueba el caso de uso.
   */
  @Get(':classroomId/roster')
  @RequirePermissions(PERMISSIONS.CLASSROOM_READ)
  async roster(@Param('classroomId') classroomId: string, @Req() request: Request) {
    return this.listRoster.execute({ classroomId }, contextFrom(request));
  }

  /**
   * Salones elegibles en el formulario de registro.
   *
   * PUBLICA, porque se consulta antes de que la cuenta exista. Devuelve lo
   * minimo: id, nombre, docente y si hay cupo.
   */
  @Get('selectable')
  @Public()
  async selectable(
    @Query(zodQuery(selectableClassroomsQuerySchema)) query: SelectableClassroomsQuery,
  ) {
    return this.listSelectable.execute(query);
  }
}

// ---------------------------------------------------------------------------
// API interna entre microservicios
// ---------------------------------------------------------------------------

/**
 * Endpoints que consumen otros servicios, no el navegador.
 *
 * Van bajo `/internal` y NO se publican en el gateway, ademas de exigir el token
 * interno compartido. Dos barreras en vez de una: la tabla de rutas del gateway
 * no los expone, y aunque alguien alcanzase la red interna necesitaria el token.
 */
/**
 * `VERSION_NEUTRAL`: la API interna lleva su version en la propia ruta
 * (`internal/v1/...`). Sin esto, el versionado por URI de Nest anade ademas su
 * propio segmento y la ruta real pasa a ser `/api/v1/internal/v1/...`, que no
 * es la que llaman los otros servicios: el resultado era un 404 que el
 * consumidor interpretaba como "ese codigo no existe".
 */
@Controller({ path: 'internal/v1/classrooms', version: VERSION_NEUTRAL })
@UseGuards(InternalOnlyGuard)
export class InternalClassroomsController {
  constructor(private readonly precheck: PrecheckClassroomUseCase) {}

  /**
   * Comprobacion previa del salon que hace el servicio de identidad durante el
   * registro. Informativa y sin bloqueo: el cupo real se vuelve a comprobar
   * dentro de la transaccion de matricula.
   */
  @Get('precheck')
  @Public()
  async check(
    @Query('institutionId') institutionId: string,
    @Query('classroomId') classroomId: string,
  ) {
    return this.precheck.execute({ institutionId, classroomId });
  }
}


/**
 * Comprobacion de existencia de institucion para el servicio de identidad.
 *
 * La consulta identidad antes de crear un administrador de institucion o un
 * docente. Sin ella, un identificador mal tecleado crearia una cuenta con
 * permisos sobre una institucion que no existe: no fallaria en el alta, fallaria
 * despues, de forma confusa, cuando esa persona intentara trabajar.
 *
 * Devuelve el minimo necesario para decidir y para mostrar un mensaje util.
 */
/**
 * `VERSION_NEUTRAL`: la API interna lleva su version en la propia ruta
 * (`internal/v1/...`). Sin esto, el versionado por URI de Nest anade ademas su
 * propio segmento y la ruta real pasa a ser `/api/v1/internal/v1/...`, que no
 * es la que llaman los otros servicios: el resultado era un 404 que el
 * consumidor interpretaba como "ese codigo no existe".
 */
@Controller({ path: 'internal/v1/institutions', version: VERSION_NEUTRAL })
@UseGuards(InternalOnlyGuard)
export class InternalInstitutionsController {
  constructor(
    // Puerto del dominio, no clase: su tipo se borra al compilar y Nest solo
    // puede resolverlo por token explicito.
    @Inject(INSTITUTION_REPOSITORY) private readonly institutions: InstitutionRepositoryPort,
  ) {}

  @Get(':institutionId/summary')
  @Public()
  async summary(@Param('institutionId') institutionId: string) {
    const institution = await this.institutions.findById(InstitutionId.create(institutionId));

    if (!institution) {
      return { exists: false, acceptsNewMembers: false };
    }

    return {
      exists: true,
      // Una institucion suspendida existe pero no admite altas nuevas. Los
      // usuarios que ya tiene conservan su acceso: suspender es una medida
      // administrativa contra la institucion, no un castigo a sus alumnos.
      acceptsNewMembers: institution.status === 'active',
      name: institution.name.value,
      shortName: institution.name.short,
      status: institution.status,
      educationLevels: [...institution.educationLevels.levels],
    };
  }
}
