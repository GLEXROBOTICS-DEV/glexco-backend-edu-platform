import type { TransactionContext } from '@glexco/kernel';

/**
 * Puertos de la proyeccion de lectura.
 *
 * Todo lo que hay detras se puede reconstruir reproduciendo el stream de
 * eventos. Esa propiedad es lo que hace que un error de calculo aqui sea un
 * reproceso y no una perdida de datos, y por eso ninguna operacion de este
 * servicio es la fuente de verdad de nada.
 */

/** Una entrega corregida, tal y como la ve la analitica. */
export interface GradedSubmissionFact {
  studentId: string;
  assessmentId: string;
  institutionId: string | null;
  classroomId: string | null;
  kitId: string;
  origin: 'glexco' | 'institution';
  kind: string;
  score: number;
  maxScore: number;
  passed: boolean;
  attemptNumber: number;
  gradedAt: Date;
}

/** Cuantos fallaron cada pregunta, en un salon. */
export interface QuestionOutcome {
  assessmentId: string;
  questionId: string;
  classroomId: string;
  /** `true` si el alumno NO obtuvo todos los puntos de la pregunta. */
  missed: boolean;
}

export interface AnalyticsProjectionRepository {
  /**
   * Registra una entrega corregida.
   *
   * **Idempotente por (alumno, evaluacion, intento).** JetStream garantiza
   * at-least-once, asi que este metodo se llamara dos veces con el mismo evento
   * mas de una vez en la vida del sistema. Si sumara ciegamente, un evento
   * repetido inflaria el numero de intentos y desplazaria la media: los
   * dashboards mentirian sin que nada fallara.
   *
   * El criterio de "mejor intento" se resuelve aqui y no al consultar: la
   * consulta la hacen cientos de directores a la vez y esto ocurre una vez por
   * entrega.
   */
  upsertSubmissionFact(fact: GradedSubmissionFact, tx: TransactionContext): Promise<void>;

  /** Acumula los fallos por pregunta del salon. */
  recordQuestionOutcomes(outcomes: readonly QuestionOutcome[], tx: TransactionContext): Promise<void>;

  /**
   * Recalcula el resumen de un salon y de su institucion.
   *
   * Se recalcula ENTERO desde los hechos en vez de ajustarse por incrementos.
   * Un contador incremental se desvia con el primer evento perdido o repetido y
   * nadie lo nota hasta que alguien cuestiona una cifra; recalcular desde los
   * hechos hace que la proyeccion sea siempre coherente con ellos, y el coste es
   * una agregacion sobre las filas de un salon, que son decenas.
   */
  refreshRollups(
    input: { classroomId: string | null; institutionId: string | null; teacherId?: string | null; grade?: string | null },
    tx: TransactionContext,
  ): Promise<void>;

  /** Marca de avance, para poder reconstruir. */
  markProjected(projection: string, eventAt: Date, tx: TransactionContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Lecturas: un metodo por pregunta de dashboard
// ---------------------------------------------------------------------------

export interface StudentDashboard {
  studentId: string;
  assessmentsTaken: number;
  /** Media de GLEXCO y del docente POR SEPARADO: mezclarlas hace que una media
   *  suba porque su profesor puso un examen facil. */
  averageGlexco: number | null;
  averageInstitution: number | null;
  passRate: number | null;
  /** Cuanto subio desde su primer intento. Es su aprendizaje, no su nota. */
  averageGain: number | null;
  timeline: {
    assessmentId: string;
    origin: string;
    percentage: number;
    passed: boolean;
    gradedAt: string;
  }[];
}

export interface ClassroomDashboard {
  classroomId: string;
  studentsMeasured: number;
  assessmentsTaken: number;
  averagePercentage: number | null;
  /** La dispersion, que es la mitad de la informacion. */
  stddevPercentage: number | null;
  averageGain: number | null;
  passRate: number | null;
  lastActivityAt: string | null;
  /** Lo que hay que volver a explicar. */
  hardestQuestions: {
    assessmentId: string;
    questionId: string;
    answered: number;
    missed: number;
    missRate: number;
  }[];
}

export interface InstitutionDashboard {
  institutionId: string;
  /**
   * Nombre del colegio, del directorio propio de analitica.
   *
   * Opcional porque llega por evento y puede ir unos segundos por detras: un
   * colegio recien creado que ya tiene actividad aparece sin nombre durante ese
   * rato. Sale `null` y no una cadena vacia para que la pantalla pueda decir
   * "sin nombre todavia" en vez de pintar un hueco que parece un fallo.
   */
  name?: string | null;
  shortName?: string | null;
  city?: string | null;
  status?: string;
  classrooms: number;
  studentsMeasured: number;
  averagePercentage: number | null;
  averageGain: number | null;
  passRate: number | null;
  codesIssued: number;
  codesRedeemed: number;
  /** Comparacion entre salones DEL MISMO grado: comparar 1.º con 5.º no dice
   *  nada. */
  byGrade: {
    grade: string;
    classrooms: number;
    averagePercentage: number | null;
    averageGain: number | null;
  }[];
}

/**
 * Una fila del dashboard de eficacia docente.
 *
 * `sampleSize` no es un extra informativo: con seis alumnos, la diferencia entre
 * dos salones es ruido, y presentarla sin la muestra es engañar a quien decide.
 * Por eso viaja en el mismo objeto y no en una nota al pie.
 */
export interface TeacherEffectivenessRow {
  teacherId: string;
  classroomId: string;
  grade: string | null;
  /** Progreso medio, NO nota media. Un salon que sube de 4 a 6 aprendio mas que
   *  uno que se queda en 8. */
  averageGain: number | null;
  averagePercentage: number | null;
  sampleSize: number;
  /** `false` cuando la muestra es demasiado pequena para concluir nada. */
  statisticallyMeaningful: boolean;
}

export interface AnalyticsQueryRepository {
  studentDashboard(studentId: string): Promise<StudentDashboard>;
  classroomDashboard(classroomId: string): Promise<ClassroomDashboard>;
  institutionDashboard(institutionId: string): Promise<InstitutionDashboard>;
  /** Ordenado por progreso, con la muestra a la vista. */
  teacherEffectiveness(institutionId: string): Promise<TeacherEffectivenessRow[]>;
  /** Kits con peor resultado en TODOS los colegios: si un kit va mal en todas
   *  partes, el problema es del contenido y no de los alumnos. */
  weakestKits(limit: number): Promise<
    {
      kitId: string;
      /**
       * Nombre del kit, del directorio que alimenta `catalog.kit.published.v1`.
       *
       * Vacio cuando el kit tiene resultados y su evento de publicacion es
       * anterior a esta proyeccion. Se devuelve vacio y no se omite la fila: un
       * kit que va mal tiene que salir en esta pantalla aunque no sepamos como
       * se llama, porque la alternativa es ocultar justo el material a rehacer.
       */
      name: string;
      code: string;
      program: string;
      grade: string;
      studentsMeasured: number;
      averagePercentage: number | null;
      /** `false` mientras la muestra sea demasiado pequena para concluir nada.
       *  Viaja CON el dato: si la pantalla tuviera que deducirlo del umbral,
       *  cambiar el umbral obligaria a dos despliegues coordinados. */
      meaningful: boolean;
    }[]
  >;
  /** Todas las instituciones, para el panel de GLEXCO. */
  institutionsOverview(): Promise<InstitutionDashboard[]>;
}

/**
 * Muestra minima para dar por significativa la comparacion de un salon.
 *
 * Quince es una decision de producto, no estadistica: es el tamano de un salon
 * pequeno y por debajo de eso la varianza individual domina. Se declara aqui,
 * con nombre, para que el numero no aparezca suelto en una consulta.
 */
export const MEANINGFUL_SAMPLE_SIZE = 15;
