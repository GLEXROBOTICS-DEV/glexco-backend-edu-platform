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

  const grades: {
    questionId: string;
    points: number;
    feedback?: string;
    rubric?: { criterionId: string; levelIndex: number }[];
  }[] = [];

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

    // Con rúbrica, lo que se envía son los NIVELES y no el total: los puntos
    // los calcula el dominio. La lista de criterios viaja en un campo oculto
    // porque una acción de servidor no tiene el cuestionario delante, y sin
    // ella no habría forma de distinguir «no eligió este criterio» de «esta
    // pregunta no tiene rúbrica».
    const rawCriteria = formData.get(`rubricCriteria:${questionId}`);
    const criterios =
      typeof rawCriteria === 'string' && rawCriteria.trim().length > 0
        ? rawCriteria.split(',').filter((id) => id.length > 0)
        : [];

    const selecciones: { criterionId: string; levelIndex: number }[] = [];

    for (const criterionId of criterios) {
      const rawLevel = formData.get(`rubric:${questionId}:${criterionId}`);
      // Un criterio sin nivel vale cero en el dominio, y cerrar la nota con la
      // rúbrica a medias daría un cero silencioso en ese criterio. Se para aquí
      // antes de publicar una nota que el docente no quiso poner.
      if (typeof rawLevel !== 'string' || rawLevel.length === 0) {
        return { error: 'Elige un nivel en cada criterio de la rúbrica.' };
      }

      const levelIndex = Number(rawLevel);
      if (!Number.isInteger(levelIndex) || levelIndex < 0) {
        return { error: 'Hay un nivel de rúbrica que no reconocemos. Vuelve a abrir la entrega.' };
      }

      selecciones.push({ criterionId, levelIndex });
    }

    grades.push({
      questionId,
      points,
      ...(typeof rawFeedback === 'string' && rawFeedback.trim().length > 0
        ? { feedback: rawFeedback.trim() }
        : {}),
      ...(selecciones.length > 0 ? { rubric: selecciones } : {}),
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
