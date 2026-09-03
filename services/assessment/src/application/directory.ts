import type { Pool } from 'pg';

/**
 * De quien es cada salon.
 *
 * Se resuelve con una proyeccion propia del servicio de evaluacion, no
 * llamando a instituciones. El motivo esta en la migracion
 * `0003_classroom_directory.sql`: esta comprobacion corre en cada apertura de
 * la bandeja de correccion, y una llamada HTTP entre servicios la volveria
 * dependiente de que instituciones este arriba justo mientras un docente
 * corrige en clase.
 */
export interface ClassroomScope {
  classroomId: string;
  institutionId: string;
  teacherId: string | null;
}

export interface ClassroomDirectory {
  find(classroomId: string): Promise<ClassroomScope | null>;
  upsert(scope: ClassroomScope & { grade: string | null }, client: Pick<Pool, 'query'>): Promise<void>;
}

export class PgClassroomDirectory implements ClassroomDirectory {
  constructor(private readonly readPool: Pool) {}

  async find(classroomId: string): Promise<ClassroomScope | null> {
    const { rows } = await this.readPool.query<{
      classroom_id: string;
      institution_id: string;
      teacher_id: string | null;
    }>(
      `SELECT classroom_id, institution_id, teacher_id
         FROM assessment.classroom_directory WHERE classroom_id = $1`,
      [classroomId],
    );

    const row = rows[0];
    return row
      ? {
          classroomId: row.classroom_id,
          institutionId: row.institution_id,
          teacherId: row.teacher_id,
        }
      : null;
  }

  /**
   * Recibe el cliente por parametro y no usa su propio pool.
   *
   * La escritura tiene que ocurrir DENTRO de la transaccion que el consumidor
   * abrio para su marca de deduplicacion. Si escribiera por el pool, la marca y
   * el efecto podrian confirmarse por separado: un evento entregado dos veces
   * -que JetStream garantiza al menos una vez, es decir, a veces dos- dejaria la
   * marca sin la fila o la fila sin la marca.
   */
  async upsert(
    scope: ClassroomScope & { grade: string | null },
    client: Pick<Pool, 'query'>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO assessment.classroom_directory
         (classroom_id, institution_id, teacher_id, grade)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (classroom_id) DO UPDATE
          SET institution_id = EXCLUDED.institution_id,
              teacher_id = COALESCE(EXCLUDED.teacher_id, assessment.classroom_directory.teacher_id),
              grade = COALESCE(EXCLUDED.grade, assessment.classroom_directory.grade),
              updated_at = now()`,
      [scope.classroomId, scope.institutionId, scope.teacherId, scope.grade],
    );
  }
}
