import 'server-only';
import { api } from './api';

/**
 * La bandeja de corrección del docente.
 *
 * A diferencia de [assessments.ts](assessments.ts), aquí los tipos **sí**
 * incluyen `correctOptionIds` y `explanation`: quien lee esto es quien corrige.
 * La separación en dos archivos no es de orden, es la frontera: un import
 * equivocado en una pantalla de alumno se ve a simple vista.
 */

export interface PendingSubmission {
  submissionId: string;
  assessmentId: string;
  assessmentTitle: string;
  kind: string;
  origin: string;
  studentId: string;
  attemptNumber: number;
  submittedAt: string | null;
  autoScore: number | null;
  maxScore: number;
  pendingQuestions: number;
}

export interface GradableQuestion {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  correctOptionIds: string[];
  explanation: string | null;
  answer: {
    selectedOptionIds: string[];
    text: string | null;
    mediaAssetId: string | null;
    awardedPoints: number | null;
    feedback: string | null;
  } | null;
  needsManualGrading: boolean;
}

export interface SubmissionForGrading {
  submissionId: string;
  assessmentId: string;
  assessmentTitle: string;
  passingScore: number;
  studentId: string;
  classroomId: string | null;
  attemptNumber: number;
  status: string;
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  feedback: string | null;
  submittedAt: string | null;
  questions: GradableQuestion[];
}

export interface RosterEntry {
  studentId: string;
  fullName: string | null;
  status: string;
  kitId: string | null;
  enrolledAt: string;
}

export async function fetchPendingSubmissions(
  classroomId: string,
): Promise<{ items: PendingSubmission[]; failed: boolean }> {
  const result = await api<{ items: PendingSubmission[] }>(
    `/assessments/submissions/pending?classroomId=${encodeURIComponent(classroomId)}`,
  );

  if (!result.ok) {
    console.error('No se pudo leer la bandeja de corrección', {
      classroomId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  return { items: result.data.items ?? [], failed: false };
}

export async function fetchSubmissionForGrading(
  submissionId: string,
): Promise<{ data: SubmissionForGrading | null; failed: boolean }> {
  const result = await api<SubmissionForGrading>(`/assessments/submissions/${submissionId}`);

  if (!result.ok) {
    console.error('No se pudo leer la entrega', {
      submissionId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: null, failed: true };
  }

  return { data: result.data, failed: false };
}

/**
 * Los nombres de la clase.
 *
 * Se pide aparte y no viene con la bandeja porque el servicio de evaluación no
 * conoce los nombres —son de instituciones—, y no debería: replicarlos allí
 * sumaría una proyección más de la que hay que preocuparse. Al portal le cuesta
 * una llamada en paralelo.
 */
export async function fetchRoster(
  classroomId: string,
): Promise<{ byId: Map<string, string>; failed: boolean }> {
  const result = await api<{ items: RosterEntry[] }>(`/classrooms/${classroomId}/roster`);

  if (!result.ok) {
    console.error('No se pudo leer la clase', {
      classroomId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { byId: new Map(), failed: true };
  }

  const byId = new Map<string, string>();
  for (const entry of result.data.items ?? []) {
    if (entry.fullName) byId.set(entry.studentId, entry.fullName);
  }

  return { byId, failed: false };
}

/**
 * Nombre del alumno, o un identificador corto si todavía no está.
 *
 * El directorio se alimenta por evento, así que puede ir unos segundos por
 * detrás. Cortar el identificador es mejor que dejar el hueco vacío: el docente
 * puede al menos distinguir dos filas.
 */
export function studentLabel(studentId: string, names: Map<string, string>): string {
  return names.get(studentId) ?? `Alumno ${studentId.slice(0, 8)}`;
}

/**
 * La clase entera, con nombres.
 *
 * `fetchRoster` devuelve un mapa porque la bandeja de correccion solo necesita
 * traducir identificador a nombre. La lista de alumnos necesita las filas: quien
 * esta, desde cuando y si activo su kit.
 */
export async function fetchClassroomRoster(
  classroomId: string,
): Promise<{ items: RosterEntry[]; failed: boolean }> {
  const result = await api<{ items: RosterEntry[] }>(`/classrooms/${classroomId}/roster`);

  if (!result.ok) {
    console.error('No se pudo leer la lista del salon', {
      classroomId,
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  return { items: result.data.items ?? [], failed: false };
}
