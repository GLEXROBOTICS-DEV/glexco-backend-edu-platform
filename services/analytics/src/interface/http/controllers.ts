import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSIONS } from '@glexco/contracts';
import { RequirePermissions } from '@glexco/nest-platform';
import { NotFoundError } from '@glexco/kernel';
import type { AnalyticsQueryRepository } from '../../application/projections';
import type { ClassroomDirectory } from '../../application/directory';
import { CLASSROOM_DIRECTORY, QUERY_REPOSITORY } from '../../tokens';

/**
 * Los cinco dashboards.
 *
 * **El ámbito se comprueba DOS veces y las dos hacen falta.** El guard de
 * permisos sabe si alguien puede "leer analitica de salon"; solo aqui, con el
 * salon concreto delante, se sabe si ESE salon es suyo. Aqui hay datos de
 * menores de edad: un permiso sin comprobacion de recurso significa que conocer
 * un identificador basta para ver el progreso de los alumnos de otro colegio.
 */
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(
    // Los dos son puertos, no clases: su tipo se borra al compilar y Nest solo
    // puede resolverlos por token explicito.
    @Inject(QUERY_REPOSITORY) private readonly queries: AnalyticsQueryRepository,
    @Inject(CLASSROOM_DIRECTORY) private readonly directory: ClassroomDirectory,
  ) {}

  /**
   * Dashboard del alumno: "¿voy bien?".
   *
   * El identificador sale del TOKEN, no de la ruta. Aceptarlo de la ruta
   * permitiria a cualquier alumno ver el progreso de otro cambiando un UUID, y
   * es el error mas facil de cometer y mas dificil de detectar mirando la
   * pantalla, porque la pantalla se ve bien.
   */
  @Get('me')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_OWN)
  async myDashboard(@Req() request: Request) {
    return this.queries.studentDashboard(actorOf(request).userId);
  }

  /** Dashboard del salon: "¿quién necesita ayuda y en qué?". */
  @Get('classrooms/:classroomId')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ_CLASSROOM)
  async classroom(@Param('classroomId') classroomId: string, @Req() request: Request) {
    await this.assertClassroomInScope(classroomId, request);
    return this.queries.classroomDashboard(classroomId);
  }

  /**
   * Dashboard de un alumno concreto, visto por su docente.
   *
   * Exige que el alumno esté en un salon del actor. Un docente ve a SUS alumnos,
   * no a los del colegio: la diferencia importa porque el permiso es de salon y
   * sin esta comprobacion se comportaria como si fuera de institucion.
   */
  @Get('classrooms/:classroomId/students/:studentId')
  @RequirePermissions(PERMISSIONS.PROGRESS_READ_CLASSROOM)
  async classroomStudent(
    @Param('classroomId') classroomId: string,
    @Param('studentId') studentId: string,
    @Req() request: Request,
  ) {
    await this.assertClassroomInScope(classroomId, request);

    if (!(await this.directory.isStudentInClassroom(studentId, classroomId))) {
      // Mismo error que si no existiera: distinguirlos permitiria averiguar en
      // que salon esta un alumno probando identificadores.
      throw new NotFoundError('STUDENT_NOT_IN_CLASSROOM', 'Ese alumno no esta en este salon.');
    }

    return this.queries.studentDashboard(studentId);
  }

  /** Dashboard de institución: "¿cómo va mi colegio?". */
  @Get('institutions/:institutionId')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ_INSTITUTION)
  async institution(@Param('institutionId') institutionId: string, @Req() request: Request) {
    this.assertInstitutionInScope(institutionId, request);
    return this.queries.institutionDashboard(institutionId);
  }

  /**
   * Eficacia docente: "¿dónde hace falta apoyo?".
   *
   * Ordenado por PROGRESO y no por nota, y con el tamaño de la muestra en cada
   * fila. Las dos cosas son deliberadas y están explicadas en `docs/DOMINIO.md`:
   * ordenar por nota mide con qué alumnado empieza cada profesor, y una
   * diferencia entre salones de seis alumnos es ruido.
   *
   * Lo ven el administrador de institución y GLEXCO. **Un docente no ve el dato
   * de sus compañeros**: que un profesor descubra su posición en una lista por un
   * dashboard, y no por una conversación, es la peor forma de gestionar un
   * equipo.
   */
  @Get('institutions/:institutionId/teaching')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ_INSTITUTION)
  async teaching(@Param('institutionId') institutionId: string, @Req() request: Request) {
    this.assertInstitutionInScope(institutionId, request);

    const rows = await this.queries.teacherEffectiveness(institutionId);

    return {
      rows,
      // El aviso viaja con los datos, no en la documentación. Quien mire esta
      // pantalla tiene que ver qué mide y qué no sin ir a buscarlo.
      metric: 'progreso medio (mejor intento menos primer intento), solo con evaluaciones GLEXCO',
      caveat:
        'El progreso depende del punto de partida del salon. Un salon de refuerzo y ' +
        'un grupo avanzado no son comparables aunque su docente sea igual de bueno. ' +
        'Las filas con muestra pequena no permiten concluir nada.',
    };
  }

  /** Panel de GLEXCO: una vista por institución. */
  @Get('institutions')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ_PLATFORM)
  async institutions() {
    return { institutions: await this.queries.institutionsOverview() };
  }

  /**
   * Kits con peor resultado en todas partes.
   *
   * Es la señal más valiosa para el equipo académico: si un kit va mal en todos
   * los colegios, el problema es del contenido y no de los alumnos. Solo con
   * evaluaciones de GLEXCO, que son las únicas comparables entre centros.
   */
  @Get('kits/weakest')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ_PLATFORM)
  async weakestKits(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '10', 10);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 10;
    return { kits: await this.queries.weakestKits(safe) };
  }

  private async assertClassroomInScope(classroomId: string, request: Request): Promise<void> {
    const actor = actorOf(request);

    // Quien puede leer la institución entera puede leer cualquiera de sus
    // salones; solo hay que comprobar que el salón sea de su institución.
    const classroom = await this.directory.find(classroomId);

    if (!classroom) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
    }

    if (actor.permissions.includes(PERMISSIONS.ANALYTICS_READ_PLATFORM)) return;

    if (classroom.institutionId !== (actor.institutionId ?? null)) {
      throw new NotFoundError('CLASSROOM_NOT_FOUND', 'El salon indicado no existe.');
    }

    if (actor.permissions.includes(PERMISSIONS.ANALYTICS_READ_INSTITUTION)) return;

    // Un docente, solo sus salones.
    if (classroom.teacherId !== actor.userId) {
      throw new ForbiddenException({
        code: 'CLASSROOM_NOT_OWNED',
        message: 'Ese salon no es tuyo.',
      });
    }
  }

  private assertInstitutionInScope(institutionId: string, request: Request): void {
    const actor = actorOf(request);

    if (actor.permissions.includes(PERMISSIONS.ANALYTICS_READ_PLATFORM)) return;

    if (institutionId !== (actor.institutionId ?? null)) {
      // Aislamiento entre instituciones: un colegio no ve datos de otro NUNCA,
      // ni siquiera agregados. Con pocos colegios por grado, un agregado es
      // reidentificable.
      throw new NotFoundError('INSTITUTION_NOT_FOUND', 'La institucion indicada no existe.');
    }
  }
}

function actorOf(request: Request): {
  userId: string;
  institutionId: string | null;
  permissions: string[];
} {
  const actor = request.actor;
  if (!actor) {
    throw new ForbiddenException({ code: 'MISSING_TOKEN', message: 'Se requiere autenticacion.' });
  }
  return {
    userId: actor.userId,
    institutionId: actor.institutionId ?? null,
    permissions: actor.permissions ?? [],
  };
}
