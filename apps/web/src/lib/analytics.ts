import 'server-only';
import { api } from './api';

/**
 * Lecturas de los dashboards.
 *
 * Todas devuelven un valor utilizable cuando la llamada falla, en vez de
 * propagar el error. Un dashboard es información, no una operación: si la
 * analítica no responde, la pantalla tiene que pintarse y decirlo, no
 * desaparecer. El detalle del fallo va al log del servidor, que es donde sirve.
 */

export interface StudentDashboard {
  studentId: string;
  assessmentsTaken: number;
  averageGlexco: number | null;
  averageInstitution: number | null;
  passRate: number | null;
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
  stddevPercentage: number | null;
  averageGain: number | null;
  passRate: number | null;
  lastActivityAt: string | null;
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
  classrooms: number;
  studentsMeasured: number;
  averagePercentage: number | null;
  averageGain: number | null;
  passRate: number | null;
  codesIssued: number;
  codesRedeemed: number;
  byGrade: {
    grade: string;
    classrooms: number;
    averagePercentage: number | null;
    averageGain: number | null;
  }[];
}

export interface TeachingReport {
  rows: {
    teacherId: string;
    classroomId: string;
    grade: string | null;
    averageGain: number | null;
    averagePercentage: number | null;
    sampleSize: number;
    statisticallyMeaningful: boolean;
  }[];
  metric: string;
  caveat: string;
}

const EMPTY_STUDENT: StudentDashboard = {
  studentId: '',
  assessmentsTaken: 0,
  averageGlexco: null,
  averageInstitution: null,
  passRate: null,
  averageGain: null,
  timeline: [],
};

export async function fetchMyDashboard(): Promise<{ data: StudentDashboard; failed: boolean }> {
  const result = await api<StudentDashboard>('/analytics/me');

  if (!result.ok) {
    console.error('No se pudo leer el dashboard del alumno', {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: EMPTY_STUDENT, failed: true };
  }

  return { data: result.data, failed: false };
}

export async function fetchClassroomDashboard(
  classroomId: string,
): Promise<{ data: ClassroomDashboard | null; failed: boolean }> {
  const result = await api<ClassroomDashboard>(
    `/analytics/classrooms/${encodeURIComponent(classroomId)}`,
  );

  if (!result.ok) {
    console.error('No se pudo leer el dashboard del salon', {
      classroomId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: null, failed: true };
  }

  return { data: result.data, failed: false };
}

export async function fetchInstitutionDashboard(
  institutionId: string,
): Promise<{ data: InstitutionDashboard | null; failed: boolean }> {
  const result = await api<InstitutionDashboard>(
    `/analytics/institutions/${encodeURIComponent(institutionId)}`,
  );

  if (!result.ok) {
    console.error('No se pudo leer el dashboard de la institucion', {
      institutionId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: null, failed: true };
  }

  return { data: result.data, failed: false };
}

export async function fetchTeachingReport(
  institutionId: string,
): Promise<{ data: TeachingReport | null; failed: boolean }> {
  const result = await api<TeachingReport>(
    `/analytics/institutions/${encodeURIComponent(institutionId)}/teaching`,
  );

  if (!result.ok) {
    console.error('No se pudo leer el informe de eficacia docente', {
      institutionId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: null, failed: true };
  }

  return { data: result.data, failed: false };
}

/**
 * Traduce una nota a un estado.
 *
 * El corte de aviso está en el umbral de aprobación y el crítico diez puntos por
 * debajo. No es una escala fina a propósito: un semáforo con cinco colores no
 * dice nada más que uno con tres, y multiplica las decisiones de diseño.
 */
export function scoreTone(
  percentage: number | null,
  passingScore = 60,
): { tone: 'neutral' | 'good' | 'warning' | 'critical'; label: string } {
  if (percentage === null) return { tone: 'neutral', label: '' };
  if (percentage >= passingScore + 15) return { tone: 'good', label: 'Buen nivel' };
  if (percentage >= passingScore) return { tone: 'good', label: 'Aprobado' };
  if (percentage >= passingScore - 10) return { tone: 'warning', label: 'Justo por debajo' };
  return { tone: 'critical', label: 'Necesita apoyo' };
}

/** Fecha corta y legible. El ISO completo en una tarjeta no lo lee nadie. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
}
