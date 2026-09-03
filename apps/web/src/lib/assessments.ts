import 'server-only';
import { api } from './api';

/**
 * Evaluaciones desde el portal.
 *
 * Ningún tipo de este archivo incluye `correctOptionIds` ni `explanation`, y no
 * es un descuido: la clave de corrección no forma parte de ningún contrato hacia
 * el cliente. Tenerlo así hace que intentar pintarla rompa la compilación en vez
 * de filtrarse en silencio.
 */

export interface StudentQuestion {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'true_false' | 'short_answer' | 'file_upload';
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
}

export interface OpenAttempt {
  submissionId: string;
  attemptNumber: number;
  attemptsLeft: number;
  timeLimitMinutes: number | null;
  questions: StudentQuestion[];
}

export interface AssessmentSummary {
  assessmentId: string;
  title: string;
  kind: string;
  origin: string;
  status: string;
  questionCount: number;
  totalPoints: number;
  classroomId: string | null;
  editable: boolean;
  dueAt: string | null;
}

export async function fetchAvailableAssessments(
  kitId: string,
): Promise<{ items: AssessmentSummary[]; failed: boolean }> {
  const result = await api<{ items: AssessmentSummary[] }>(
    `/assessments?kitId=${encodeURIComponent(kitId)}`,
  );

  if (!result.ok) {
    console.error('No se pudieron leer las evaluaciones', {
      kitId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  // El alumno solo ve lo publicado. El backend ya lo filtra en la consulta de
  // alumno, pero esta llamada usa el listado general -que el docente también
  // usa- así que el filtro se repite aquí. Repetirlo es barato; olvidarlo
  // mostraría borradores.
  return {
    items: (result.data.items ?? []).filter((item) => item.status === 'published'),
    failed: false,
  };
}
