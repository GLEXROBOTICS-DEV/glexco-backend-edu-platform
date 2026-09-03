import 'server-only';
import { api } from './api';

export interface CourseProgress {
  courseId: string;
  kitId: string;
  title: string;
  lessonCount: number;
  lessonsCompleted: number;
  lessonsStarted: number;
  lastActivityAt: string | null;
}

export interface LearningProgress {
  studentId: string;
  totalXp: number;
  explorerLevel: number;
  levelName: string;
  xpToNext: number | null;
  nextLevelName: string | null;
  lessonsCompleted: number;
  coursesCompleted: number;
  badges: { code: string; name: string; category: string; awardedAt: string }[];
  courses: CourseProgress[];
}

export interface ClassroomProgressRow {
  studentId: string;
  fullName: string;
  lessonsCompleted: number;
  lessonsStarted: number;
  lastActivityAt: string | null;
  stale: boolean;
}

const EMPTY: LearningProgress = {
  studentId: '',
  totalXp: 0,
  explorerLevel: 1,
  levelName: 'Explorador',
  xpToNext: 500,
  nextLevelName: 'Inventor',
  lessonsCompleted: 0,
  coursesCompleted: 0,
  badges: [],
  courses: [],
};

/**
 * El progreso propio por consumo de contenido.
 *
 * El alcance lo decide el token en el backend, no un parametro: aceptar un
 * `studentId` permitiria leer el progreso de cualquier alumno.
 *
 * Devuelve el estado vacio -y no un error- cuando falla, porque esta pantalla
 * tiene que pintarse igualmente. Un alumno de ocho anos que ve una pantalla de
 * error completa asume que rompio algo.
 */
export async function fetchLearningProgress(): Promise<{
  data: LearningProgress;
  failed: boolean;
}> {
  const result = await api<LearningProgress>('/learning/me');

  if (!result.ok) {
    console.error('No se pudo leer el progreso de contenido', {
      status: result.status,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { data: EMPTY, failed: true };
  }

  return { data: result.data, failed: false };
}

/**
 * Quien del salon se ha descolgado.
 *
 * `staleAfterDays` viaja CON los datos y no se fija aqui: si la pantalla llevara
 * su propia copia del umbral, cambiarlo en el backend dejaria la explicacion
 * mintiendo hasta el siguiente despliegue del portal.
 */
export async function fetchClassroomLearning(classroomId: string): Promise<{
  items: ClassroomProgressRow[];
  staleAfterDays: number;
  failed: boolean;
}> {
  const result = await api<{ items: ClassroomProgressRow[]; staleAfterDays: number }>(
    `/learning/classrooms/${encodeURIComponent(classroomId)}`,
  );

  if (!result.ok) {
    console.error('No se pudo leer el progreso del salon', {
      classroomId,
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], staleAfterDays: 14, failed: true };
  }

  return {
    items: result.data.items ?? [],
    staleAfterDays: result.data.staleAfterDays ?? 14,
    failed: false,
  };
}
