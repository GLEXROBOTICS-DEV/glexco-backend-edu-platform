import type { Pool } from 'pg';

/**
 * Quién manda en qué salón, para comprobar el ámbito de cada dashboard.
 *
 * **Se resuelve con las propias proyecciones de la analítica, no llamando a
 * instituciones.** Es una decisión con motivo: esta comprobación corre en CADA
 * petición de dashboard, y hacerla con una llamada HTTP entre servicios
 * convertiría el panel del director en algo que no abre si instituciones tiene
 * un mal día, además de sumar una ida y vuelta de red a cada pantalla.
 *
 * Los datos llegan por evento (`institutions.classroom.created.v1`) y por los
 * propios hechos de evaluación. La contrapartida asumida es que un salón creado
 * hace medio segundo puede no estar todavía: para una comprobación de ámbito
 * eso significa un 404 momentáneo en un salón recién creado que aún no tiene
 * ningún dato que mostrar.
 */
export interface ClassroomScope {
  classroomId: string;
  institutionId: string;
  teacherId: string | null;
}

export interface ClassroomDirectory {
  find(classroomId: string): Promise<ClassroomScope | null>;
  isStudentInClassroom(studentId: string, classroomId: string): Promise<boolean>;
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
       FROM analytics.classroom_rollups WHERE classroom_id = $1`,
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
   * Si este alumno tiene actividad medida en este salón.
   *
   * Es la pregunta correcta para un dashboard, y no "¿está matriculado?": lo que
   * el docente va a ver son datos de evaluación, así que si no hay ninguno, no
   * hay dashboard que mostrar aunque la matrícula exista. Y evita que la
   * analítica tenga que replicar la tabla de matrículas, que es de
   * instituciones.
   */
  async isStudentInClassroom(studentId: string, classroomId: string): Promise<boolean> {
    const { rows } = await this.readPool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM analytics.student_assessment_facts
         WHERE student_id = $1 AND classroom_id = $2
       ) AS exists`,
      [studentId, classroomId],
    );
    return rows[0]?.exists ?? false;
  }
}
