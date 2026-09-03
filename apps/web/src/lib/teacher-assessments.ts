import 'server-only';
import { api } from './api';
import type { AssessmentSummary } from './assessments';

/**
 * El banco de evaluaciones del docente.
 *
 * Trae dos cosas mezcladas y el backend las marca: las de **GLEXCO**, que vienen
 * con el kit y son las mismas para todos los colegios, y las de **su
 * institución**. El campo que las separa es `editable`, y lo decide el servidor
 * —nunca esta pantalla— porque de él depende que un docente no cambie el examen
 * de todo el país.
 */

export interface KitOption {
  kitId: string;
  code: string;
  name: string;
  program: string;
  grade: string;
}

export async function fetchAssessmentBank(): Promise<{
  glexco: AssessmentSummary[];
  own: AssessmentSummary[];
  failed: boolean;
}> {
  const result = await api<{ items: AssessmentSummary[] }>('/assessments?limit=100');

  if (!result.ok) {
    console.error('No se pudo leer el banco de evaluaciones', {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { glexco: [], own: [], failed: true };
  }

  const items = result.data.items ?? [];

  return {
    glexco: items.filter((item) => item.origin === 'glexco'),
    own: items.filter((item) => item.origin !== 'glexco'),
    failed: false,
  };
}

/**
 * Kits entre los que elegir al crear una evaluación.
 *
 * Se pide por grado porque es como se pregunta —"qué kit lleva 6.º"— y porque un
 * docente rara vez da más de dos o tres grados. Sin grado devuelve el catálogo
 * publicado completo, que sirve para el equipo de GLEXCO.
 */
export async function fetchKitOptions(grade?: string): Promise<KitOption[]> {
  const result = await api<{ items: KitOption[] }>(
    grade ? `/catalog/kits?grade=${encodeURIComponent(grade)}` : '/catalog/kits',
  );

  if (!result.ok) {
    console.error('No se pudieron leer los kits', {
      grade,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return [];
  }

  return result.data.items ?? [];
}

/**
 * Una evaluación con sus preguntas, tal y como la ve quien la edita.
 *
 * `correctOptionIds` y `explanation` son **opcionales** en el tipo porque el
 * backend solo los envía a quien puede editar. Un docente mirando el banco de
 * GLEXCO -para decidir si lo duplica- recibe las preguntas sin la clave: son las
 * mismas que van a responder sus alumnos.
 */
export interface AuthoredQuestion {
  id: string;
  type: string;
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
  correctOptionIds?: string[];
  explanation?: string | null;
}

export interface AssessmentDetail extends AssessmentSummary {
  description: string;
  kitId: string;
  passingScore: number;
  maxAttempts: number;
  timeLimitMinutes: number | null;
  submissionCount: number;
  questions: AuthoredQuestion[];
}

export async function fetchAssessmentDetail(
  assessmentId: string,
): Promise<{ data: AssessmentDetail | null; failed: boolean }> {
  const result = await api<AssessmentDetail>(`/assessments/${assessmentId}`);

  if (!result.ok) {
    console.error('No se pudo leer la evaluación', {
      assessmentId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: null, failed: true };
  }

  return { data: result.data, failed: false };
}

export const KIND_LABEL: Record<string, string> = {
  quiz: 'Cuestionario',
  practical: 'Práctica',
  project: 'Proyecto',
  stem_activity: 'Actividad STEM',
};

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  in_review: 'En revisión',
  published: 'Publicada',
  archived: 'Archivada',
};
