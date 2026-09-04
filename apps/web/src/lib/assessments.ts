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
  type:
    | 'single_choice'
    | 'multiple_choice'
    | 'true_false'
    | 'short_answer'
    | 'ordering'
    | 'file_upload';
  prompt: string;
  options: { id: string; text: string }[];
  points: number;
}

export interface OpenAttempt {
  submissionId: string;
  attemptNumber: number;
  attemptsLeft: number;
  timeLimitMinutes: number | null;
  /**
   * Instante ABSOLUTO en que se acaba este intento, calculado por el servidor.
   *
   * Va absoluto y no como "te quedan N minutos" porque el cronometro tiene que
   * contar contra un instante fijo: contando desde que carga la pagina,
   * recargar regalaria el tiempo entero otra vez.
   */
  expiresAt: string | null;
  /** Fecha limite de la evaluacion entera, si la tiene. */
  dueAt: string | null;
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

export interface UpcomingActivity extends AssessmentSummary {
  kitId: string;
  kitName: string;
}

/**
 * Lo que el alumno tiene por delante, en todos sus kits.
 *
 * Las evaluaciones publicadas SON las proximas actividades del alumno. El canvas
 * dibuja aqui "retos" y "misiones", que son de la fase de gamificacion y todavia
 * no existen; poner tarjetas de reto inventadas llenaria la portada de cosas que
 * no se pueden abrir.
 *
 * Se piden en paralelo por kit: en serie, un alumno con tres kits espera tres
 * viajes de red seguidos por un bloque que ocupa un tercio de la pantalla.
 */
export async function fetchUpcomingActivities(
  kits: readonly { kitId: string; name: string }[],
): Promise<{ items: UpcomingActivity[]; failed: boolean }> {
  if (kits.length === 0) return { items: [], failed: false };

  const results = await Promise.all(
    kits.map(async (kit) => {
      const { items, failed } = await fetchAvailableAssessments(kit.kitId);
      return {
        failed,
        items: items.map((item) => ({ ...item, kitId: kit.kitId, kitName: kit.name })),
      };
    }),
  );

  const items = results.flatMap((r) => r.items);

  // Por fecha de entrega, y las que no tienen al final. Una evaluacion sin fecha
  // no es urgente, y colarla entre dos que si la tienen desordena justo la
  // lectura por la que existe esta lista.
  items.sort((a, b) => {
    if (a.dueAt && b.dueAt) return Date.parse(a.dueAt) - Date.parse(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title, 'es');
  });

  return { items, failed: results.every((r) => r.failed) };
}

export interface MyAttempt {
  submissionId: string;
  attemptNumber: number;
  status: 'in_progress' | 'submitted' | 'graded';
  score: number | null;
  maxScore: number;
  passed: boolean | null;
  feedback: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  /** La evidencia que entregó el propio alumno. Vacío si no entregó ninguna,
   *  que es lo normal cuando el docente lo revisó en clase. */
  evidenceAssetIds?: string[];
}

export interface MyResult {
  assessmentId: string;
  title: string;
  passingScore: number;
  maxAttempts: number;
  attemptsUsed: number;
  attemptsLeft: number;
  best: MyAttempt | null;
  inProgress: MyAttempt | null;
  attempts: MyAttempt[];
  recommendations: string[];
}

/**
 * Como le fue al alumno en una evaluacion.
 *
 * Es de LECTURA y no abre ningun intento. Esa es toda la razon de que exista:
 * antes, para saber la nota habia que abrir un intento, asi que volver a la
 * pantalla gastaba uno de los tres y el alumno acababa viendo "ya agotaste tus
 * intentos" sin haber respondido nada mas.
 */
export async function fetchMyResult(assessmentId: string): Promise<MyResult | null> {
  const result = await api<MyResult>(
    `/assessments/${encodeURIComponent(assessmentId)}/my-result`,
  );

  if (!result.ok) {
    console.error('No se pudo leer el resultado de la evaluacion', {
      assessmentId,
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return null;
  }

  return result.data;
}
