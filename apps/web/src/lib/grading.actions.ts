'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';

export interface GradeState {
  ok?: boolean;
  score?: number | null;
  passed?: boolean | null;
  error?: string;
}

/**
 * Guarda la corrección y cierra la nota.
 *
 * Es **una sola operación**, no "puntuar" y luego "publicar". El backend lo
 * impone y la pantalla lo respeta por el mismo motivo: dejar las dos cosas
 * sueltas produce entregas puntuadas pero sin nota publicada, un estado que
 * nadie mira y en el que las notas se quedan olvidadas hasta que un alumno
 * reclama.
 *
 * Solo se envían las preguntas que el formulario trae con puntuación. Una
 * pregunta de marcar ya la puntuó la máquina, y volver a mandarla con el mismo
 * valor sería pedirle al servidor que reescriba lo que ya estaba bien.
 */
export async function gradeSubmission(
  _previous: GradeState,
  formData: FormData,
): Promise<GradeState> {
  const submissionId = formData.get('submissionId');
  const classroomId = formData.get('classroomId');

  if (typeof submissionId !== 'string') {
    return { error: 'Falta la entrega. Vuelve a abrirla.' };
  }

  const grades: { questionId: string; points: number; feedback?: string }[] = [];

  for (const rawId of formData.getAll('gradableQuestionId')) {
    const questionId = String(rawId);
    const rawPoints = formData.get(`points:${questionId}`);
    const rawFeedback = formData.get(`feedback:${questionId}`);

    if (typeof rawPoints !== 'string' || rawPoints.trim().length === 0) {
      return { error: 'Pon una puntuación en todas las preguntas abiertas.' };
    }

    const points = Number(rawPoints);
    if (!Number.isFinite(points) || points < 0) {
      return { error: 'Las puntuaciones tienen que ser números positivos.' };
    }

    grades.push({
      questionId,
      points,
      ...(typeof rawFeedback === 'string' && rawFeedback.trim().length > 0
        ? { feedback: rawFeedback.trim() }
        : {}),
    });
  }

  const rawOverall = formData.get('feedback');

  const result = await api<{ submissionId: string; score: number | null; passed: boolean | null }>(
    `/assessments/attempts/${submissionId}/grade`,
    {
      method: 'POST',
      body: {
        grades,
        ...(typeof rawOverall === 'string' && rawOverall.trim().length > 0
          ? { feedback: rawOverall.trim() }
          : {}),
      },
    },
  );

  if (!result.ok) {
    return { error: result.error.message };
  }

  // La bandeja y el dashboard del salón cambian los dos: la entrega sale de
  // pendientes y la nota entra en la media. El dashboard se alimenta de una
  // proyección asíncrona, así que puede tardar un par de segundos en reflejarlo.
  if (typeof classroomId === 'string') {
    revalidatePath(`/docentes/salones/${classroomId}/correccion`);
    revalidatePath(`/docentes/salones/${classroomId}`);
  }

  return { ok: true, score: result.data.score, passed: result.data.passed };
}
