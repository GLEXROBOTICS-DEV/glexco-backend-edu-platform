import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import {
  PERMISSIONS,
  addQuestionSchema,
  createAssessmentSchema,
  gradeSubmissionSchema,
  listAssessmentsSchema,
  saveAnswerSchema,
  type AddQuestionRequest,
  type CreateAssessmentRequest,
  type GradeSubmissionRequest,
  type ListAssessmentsQuery,
  type SaveAnswerRequest,
} from '@glexco/contracts';
import { RequirePermissions, zodBody, zodQuery } from '@glexco/nest-platform';
import { z } from 'zod';
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  AddQuestionUseCase,
  CloneAssessmentUseCase,
  CreateAssessmentUseCase,
  GetAssessmentUseCase,
  ListAssessmentsUseCase,
  PublishAssessmentUseCase,
} from '../../application/manage-assessment.usecase';
import {
  GradeSubmissionUseCase,
  SaveAnswerUseCase,
  MyResultUseCase,
  StartAttemptUseCase,
  SubmitAttemptUseCase,
} from '../../application/take-assessment.usecase';
import {
  GetSubmissionForGradingUseCase,
  ListPendingSubmissionsUseCase,
} from '../../application/grading.usecase';

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

/**
 * Creacion y gestion de evaluaciones.
 *
 * Lo usan el equipo academico de GLEXCO -que produce el banco comun que viene
 * con cada kit- y los docentes, que crean las suyas para su salon. La diferencia
 * la decide el backend segun quien llama, nunca un campo de la peticion.
 */
@Controller({ path: 'assessments', version: '1' })
export class AssessmentsController {
  constructor(
    private readonly create: CreateAssessmentUseCase,
    private readonly addQuestion: AddQuestionUseCase,
    private readonly publish: PublishAssessmentUseCase,
    private readonly clone: CloneAssessmentUseCase,
    private readonly list: ListAssessmentsUseCase,
    private readonly get: GetAssessmentUseCase,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.ASSESSMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async createAssessment(
    @Body(zodBody(createAssessmentSchema)) input: CreateAssessmentRequest,
    @Req() request: Request,
  ) {
    return this.create.execute(input, contextFrom(request));
  }

  /** Banco visible para quien llama: el comun de GLEXCO mas el de su institucion. */
  @Get()
  @RequirePermissions(PERMISSIONS.ASSESSMENT_READ)
  async listAssessments(
    @Query(zodQuery(listAssessmentsSchema)) query: ListAssessmentsQuery,
    @Req() request: Request,
  ) {
    return this.list.execute(
      {
        kitId: query.kitId,
        classroomId: query.classroomId,
        page: { limit: query.limit, cursor: query.cursor },
      },
      contextFrom(request),
    );
  }

  /**
   * Una evaluacion con sus preguntas, para la pantalla que la edita.
   *
   * Se declara DESPUES del listado y de `submissions/...`, que son rutas de un
   * segmento distinto, asi que no compiten. La clave de correccion la incluye o
   * no el caso de uso segun quien pregunte.
   */
  @Get(':assessmentId')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_READ)
  async getAssessment(@Param('assessmentId') assessmentId: string, @Req() request: Request) {
    return this.get.execute({ assessmentId }, contextFrom(request));
  }

  @Post(':assessmentId/questions')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_UPDATE)
  @HttpCode(HttpStatus.CREATED)
  async createQuestion(
    @Param('assessmentId') assessmentId: string,
    @Body(zodBody(addQuestionSchema)) input: AddQuestionRequest,
    @Req() request: Request,
  ) {
    return this.addQuestion.execute({ assessmentId, ...input }, contextFrom(request));
  }

  @Post(':assessmentId/publish')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_UPDATE)
  @HttpCode(HttpStatus.OK)
  async publishAssessment(
    @Param('assessmentId') assessmentId: string,
    @Req() request: Request,
  ) {
    return this.publish.execute({ assessmentId }, contextFrom(request));
  }

  /**
   * Duplica para adaptar.
   *
   * Es la salida al "no puedes editar esta evaluacion" que recibe un docente al
   * intentar tocar el banco de GLEXCO. Lo que quiere no es romper el banco
   * comun: quiere su propia version.
   */
  @Post(':assessmentId/clone')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async cloneAssessment(
    @Param('assessmentId') assessmentId: string,
    @Body() body: { classroomId?: string },
    @Req() request: Request,
  ) {
    return this.clone.execute(
      { assessmentId, classroomId: body?.classroomId },
      contextFrom(request),
    );
  }
}

/**
 * Lo que hace un alumno: abrir, responder y entregar.
 *
 * Ninguna respuesta de este controlador incluye la clave de correccion. El
 * agregado la filtra en `forStudent()`, y no depende de que aqui nadie se
 * equivoque al serializar.
 */
@Controller({ path: 'assessments', version: '1' })
export class AttemptsController {
  constructor(
    private readonly start: StartAttemptUseCase,
    private readonly saveAnswer: SaveAnswerUseCase,
    private readonly submit: SubmitAttemptUseCase,
    private readonly grade: GradeSubmissionUseCase,
    private readonly myResult: MyResultUseCase,
  ) {}

  /**
   * Como le fue al alumno en esta evaluacion.
   *
   * Es de LECTURA y no consume ningun intento, que es justo el motivo de que
   * exista: la pantalla de resultados tenia que abrir un intento para saber la
   * nota, asi que recargarla gastaba uno de los tres hasta dejar al alumno con
   * "ya agotaste tus intentos" sin haber vuelto a responder nada.
   */
  @Get(':assessmentId/my-result')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_SUBMIT)
  async myResultFor(@Param('assessmentId') assessmentId: string, @Req() request: Request) {
    return this.myResult.execute({ assessmentId }, contextFrom(request));
  }

  /** Abre un intento, o devuelve el que ya estaba abierto. */
  @Post(':assessmentId/attempts')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_SUBMIT)
  @HttpCode(HttpStatus.CREATED)
  async startAttempt(
    @Param('assessmentId') assessmentId: string,
    @Body() body: { classroomId?: string },
    @Req() request: Request,
  ) {
    return this.start.execute(
      { assessmentId, classroomId: body?.classroomId },
      contextFrom(request),
    );
  }

  /** Guarda una respuesta sin entregar. */
  @Post('attempts/:submissionId/answers')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_SUBMIT)
  @HttpCode(HttpStatus.OK)
  async answer(
    @Param('submissionId') submissionId: string,
    @Body(zodBody(saveAnswerSchema)) input: SaveAnswerRequest,
    @Req() request: Request,
  ) {
    return this.saveAnswer.execute({ submissionId, ...input }, contextFrom(request));
  }

  /** Entrega. Lo de marcar se corrige al instante. */
  @Post('attempts/:submissionId/submit')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_SUBMIT)
  @HttpCode(HttpStatus.OK)
  async submitAttempt(
    @Param('submissionId') submissionId: string,
    @Req() request: Request,
  ) {
    return this.submit.execute({ submissionId }, contextFrom(request));
  }

  /** Correccion manual del docente. */
  @Post('attempts/:submissionId/grade')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_GRADE)
  @HttpCode(HttpStatus.OK)
  async gradeAttempt(
    @Param('submissionId') submissionId: string,
    @Body(zodBody(gradeSubmissionSchema)) input: GradeSubmissionRequest,
    @Req() request: Request,
  ) {
    return this.grade.execute({ submissionId, ...input }, contextFrom(request));
  }
}

// ---------------------------------------------------------------------------
// Bandeja de correccion
// ---------------------------------------------------------------------------

const pendingQuerySchema = z.object({
  classroomId: z.string().uuid(),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Lo que el docente necesita para corregir.
 *
 * Va en su propio controlador y no en el de intentos porque las respuestas de
 * aqui SI llevan la clave de correccion. Tenerlas separadas hace visible de un
 * vistazo cual es el controlador que puede filtrar un examen y cual no: en el
 * de intentos, ninguna respuesta la incluye nunca.
 *
 * El `classroomId` es obligatorio en el listado. No es un filtro opcional: es
 * lo que define el ambito, y sin el la pregunta seria "dame todo lo pendiente",
 * que no tiene respuesta legitima para un docente.
 */
@Controller({ path: 'assessments', version: '1' })
export class GradingController {
  constructor(
    private readonly listPending: ListPendingSubmissionsUseCase,
    private readonly getForGrading: GetSubmissionForGradingUseCase,
  ) {}

  @Get('submissions/pending')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_GRADE)
  async pending(
    @Query(zodQuery(pendingQuerySchema)) query: { classroomId: string; cursor?: string; limit: number },
    @Req() request: Request,
  ) {
    return this.listPending.execute(query, contextFrom(request));
  }

  @Get('submissions/:submissionId')
  @RequirePermissions(PERMISSIONS.ASSESSMENT_GRADE)
  async detail(@Param('submissionId') submissionId: string, @Req() request: Request) {
    return this.getForGrading.execute({ submissionId }, contextFrom(request));
  }
}
