import 'server-only';
import { api } from './api';

/** Salón tal y como lo lista el panel del docente. */
export interface ClassroomSummary {
  classroomId: string;
  name: string;
  grade: string;
  capacity: number;
  enrolledCount: number;
  academicYear: number;
  teacherId: string;
  teacherName?: string | null;
}

/**
 * Salones que el actor puede ver.
 *
 * El alcance lo decide su ROL en el backend, no un parámetro de esta llamada:
 * un docente recibe los suyos y un administrador los de su institución. Dejar
 * que el frontend pidiera un alcance permitiría a un docente listar el colegio
 * entero cambiando un parámetro.
 */
export async function fetchMyClassrooms(): Promise<{ items: ClassroomSummary[]; failed: boolean }> {
  const result = await api<{ items: ClassroomSummary[] } | ClassroomSummary[]>('/classrooms');

  if (!result.ok) {
    console.error('No se pudieron leer los salones', {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return { items: [], failed: true };
  }

  const data = result.data;
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  return { items, failed: false };
}
