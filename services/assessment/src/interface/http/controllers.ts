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
import type { ExecutionContext as UseCaseContext } from '@glexco/kernel';
import {
  AddQuestionUseCase,
  CloneAssessmentUseCase,
  CreateAssessmentUseCase,
  ListAssessmentsUseCase,
  PublishAssessmentUseCase,
} from '../../application/manage-assessment.usecase';
import {
  GradeSubmissionUseCase,
  SaveAnswerUseCase,
  StartAttemptUseCase,
  SubmitAttemptUseCase,
} from '../../application/take-assessment.usecase';

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
  ) {}

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
