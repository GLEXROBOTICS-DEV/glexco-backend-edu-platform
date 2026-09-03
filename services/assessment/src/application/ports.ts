import type { CursorPage, CursorQuery, TransactionContext } from '@glexco/kernel';
import type { Assessment, AssessmentId } from '../domain/assessment.aggregate';
import type { Submission, SubmissionId } from '../domain/submission.aggregate';

export interface AssessmentRepository {
  findById(id: AssessmentId): Promise<Assessment | null>;
  findByIdForUpdate(id: AssessmentId, tx: TransactionContext): Promise<Assessment | null>;
  save(assessment: Assessment, tx: TransactionContext): Promise<void>;

  /**
   * Evaluaciones que un alumno puede ver de un kit.
   *
   * Recibe la institucion y el salon de forma OBLIGATORIA, aunque puedan ser
   * `null`: obliga a quien llama a decidir el ambito. Sin eso, el listado
   * devolveria tambien las evaluaciones de otros colegios, que es la fuga que
   * este servicio no se puede permitir.
   */
  listForStudent(input: {
    kitId: string;
    institutionId: string | null;
    classroomId: string | null;
  }): Promise<Assessment[]>;

  /**
   * Varias evaluaciones de una vez.
   *
   * Existe para los listados que necesitan el titulo de la evaluacion de cada
   * fila -la bandeja de correccion, por ejemplo-: sin esto, una clase de
   * treinta entregas del mismo examen haria treinta consultas identicas.
   */
  findManyByIds(ids: string[]): Promise<Assessment[]>;

  /** Banco del docente: las suyas mas las que vienen con el kit. */
  listForTeacher(input: {
    kitId?: string | undefined;
    institutionId: string;
    classroomId?: string | undefined;
    page: CursorQuery;
  }): Promise<CursorPage<Assessment>>;
}

export interface SubmissionRepository {
  findById(id: SubmissionId): Promise<Submission | null>;
  findByIdForUpdate(id: SubmissionId, tx: TransactionContext): Promise<Submission | null>;
  save(submission: Submission, tx: TransactionContext): Promise<void>;

  /**
   * Intentos de un alumno sobre una evaluacion, BLOQUEANDO.
   *
   * Es lo que hace valer el tope de intentos. Sin el bloqueo, dos peticiones
   * simultaneas contarian ambas "llevas 2 de 3" y crearian el tercero y el
   * cuarto. Se bloquea la fila de la EVALUACION y no las de los intentos,
   * porque el problema es el intento que todavia no existe y una fila
   * inexistente no se puede bloquear.
   */
  countAttempts(assessmentId: string, studentId: string, tx: TransactionContext): Promise<number>;

  findInProgress(assessmentId: string, studentId: string): Promise<Submission | null>;

  listByStudent(assessmentId: string, studentId: string): Promise<Submission[]>;

  /** Bandeja de correccion del docente. */
  listPendingForClassroom(classroomId: string, page: CursorQuery): Promise<CursorPage<Submission>>;
}
