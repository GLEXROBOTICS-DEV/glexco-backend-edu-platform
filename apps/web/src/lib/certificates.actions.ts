'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

export interface IssueState {
  error?: string;
  issued?: number;
  notReady?: number;
}

/**
 * Emision masiva de certificados de un curso, para un salon entero.
 *
 * Emite a **todos los que han terminado** y no falla si alguno va por la mitad:
 * devuelve el reparto. Una emision masiva que se cae entera porque un alumno de
 * treinta no ha acabado obliga al docente a mirar uno por uno, que es justo lo
 * que venia a evitar.
 *
 * Es idempotente en el backend: pulsarlo dos veces no crea dos tandas.
 */
export async function issueClassroomCertificates(
  _previous: IssueState,
  formData: FormData,
): Promise<IssueState> {
  const classroomId = String(formData.get('classroomId') ?? '').trim();
  const courseId = String(formData.get('courseId') ?? '').trim();

  if (!classroomId || !courseId) {
    return { error: 'Elige el curso del que quieres emitir los certificados.' };
  }

  const result = await api<{ issued: unknown[]; notReady: number }>(
    `/certificates/classrooms/${encodeURIComponent(classroomId)}`,
    { method: 'POST', body: { courseId } },
  );

  if (!result.ok) {
    if (result.status === 503) {
      return { error: 'Los certificados todavía no están activos en esta plataforma.' };
    }
    return { error: 'No pudimos emitir los certificados. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath(`/docentes/salones/${classroomId}`);
  return { issued: result.data.issued.length, notReady: result.data.notReady };
}
