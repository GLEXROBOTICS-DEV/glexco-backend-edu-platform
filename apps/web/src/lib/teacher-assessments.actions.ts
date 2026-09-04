'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from './api';

/**
 * Crear, duplicar, ampliar y publicar una evaluación.
 *
 * El **origen no se envía nunca**. Lo decide el backend según quién llama, y
 * enviarlo desde aquí permitiría a un docente publicar su cuestionario como
 * contenido de GLEXCO —el mismo para todos los colegios del país— cambiando un
 * campo del formulario.
 */

export interface CreateState {
  error?: string;
}

export async function createAssessment(
  _previous: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const kitId = formData.get('kitId');
  const title = formData.get('title');
  const kind = formData.get('kind');

  if (typeof kitId !== 'string' || kitId.length === 0) {
    return { error: 'Elige el kit al que pertenece.' };
  }
  if (typeof title !== 'string' || title.trim().length < 3) {
    return { error: 'Ponle un título de al menos tres letras.' };
  }

  const classroomId = formData.get('classroomId');
  const timeLimit = formData.get('timeLimitMinutes');
  const passing = formData.get('passingScore');
  const dueAt = formData.get('dueAt');

  const result = await api<{ assessmentId: string }>('/assessments', {
    method: 'POST',
    body: {
      kitId,
      title: title.trim(),
      kind: typeof kind === 'string' && kind.length > 0 ? kind : 'quiz',
      // Vacío significa "para todos mis salones", que es lo que quiere un
      // docente que da el mismo grado en dos aulas.
      ...(typeof classroomId === 'string' && classroomId.length > 0 ? { classroomId } : {}),
      ...(typeof passing === 'string' && passing.length > 0 ? { passingScore: passing } : {}),
      ...(typeof timeLimit === 'string' && timeLimit.length > 0
        ? { timeLimitMinutes: timeLimit }
        : {}),
      // `datetime-local` da "2026-09-30T23:59" SIN zona, y el backend exige un
      // instante completo. Se interpreta en la zona del navegador -que es la del
      // docente, la que tenia en la cabeza al escribirlo- y se manda en UTC. Sin
      // esto, "cierra a las 23:59" se aplicaria a las 23:59 UTC, que en Lima son
      // las 18:59 del mismo dia: cinco horas menos de las que el docente dio.
      ...(typeof dueAt === 'string' && dueAt.length > 0
        ? { dueAt: new Date(dueAt).toISOString() }
        : {}),
    },
  });

  if (!result.ok) {
    return { error: result.error.message };
  }

  revalidatePath('/docentes/evaluaciones');

  // Se va directo al editor: una evaluación sin preguntas no se puede publicar,
  // así que dejarla en el listado sería dejar el trabajo a medias sin decirlo.
  redirect(`/docentes/evaluaciones/${result.data.assessmentId}`);
}

export interface QuestionState {
  ok?: boolean;
  error?: string;
}

/**
 * Añade una pregunta.
 *
 * Las opciones correctas se envían **por posición**, no por identificador: los
 * identificadores los genera el backend. Mandar posiciones deja un solo error
 * posible —un índice fuera de rango— en lugar de tener que validar que el id
 * existe, que no se repite y que no es de otra pregunta.
 */
export async function addQuestion(
  _previous: QuestionState,
  formData: FormData,
): Promise<QuestionState> {
  const assessmentId = formData.get('assessmentId');
  const type = formData.get('type');
  const prompt = formData.get('prompt');
  const points = formData.get('points');

  if (typeof assessmentId !== 'string' || typeof type !== 'string') {
    return { error: 'Falta la evaluación. Vuelve a abrirla.' };
  }
  if (typeof prompt !== 'string' || prompt.trim().length < 3) {
    return { error: 'Escribe el enunciado de la pregunta.' };
  }

  const ordering = type === 'ordering';
  const needsOptions = type === 'single_choice' || type === 'multiple_choice' || ordering;
  const options: { text: string }[] = [];
  const correctOptions: number[] = [];

  if (needsOptions) {
    const texts = formData.getAll('optionText').map((value) => String(value).trim());
    const marked = new Set(formData.getAll('correctOption').map((value) => String(value)));

    texts.forEach((text, index) => {
      if (text.length === 0) return;
      // El índice que se envía es el de la opción YA filtrada: si se enviara el
      // de la fila del formulario, dejar un hueco en blanco desplazaría la
      // respuesta correcta a otra opción sin que nadie lo notase.
      if (!ordering && marked.has(String(index))) correctOptions.push(options.length);
      options.push({ text });
    });

    // En una de ordenar, la clave es la secuencia ENTERA y ya la escribió el
    // docente: el orden de los campos. Se envía como la permutación completa,
    // que es lo que el dominio exige, y por eso no hay ningún control que
    // marcar en pantalla.
    if (ordering) {
      for (let index = 0; index < options.length; index += 1) correctOptions.push(index);
    }

    if (options.length < 2) {
      return {
        error: ordering
          ? 'Una pregunta de ordenar necesita al menos dos pasos.'
          : 'Una pregunta de marcar necesita al menos dos opciones.',
      };
    }
    if (correctOptions.length === 0) {
      return { error: 'Marca cuál es la respuesta correcta.' };
    }
    if (type === 'single_choice' && correctOptions.length > 1) {
      return { error: 'Esta pregunta admite una sola respuesta correcta.' };
    }
  }

  const explanation = formData.get('explanation');

  const result = await api(`/assessments/${assessmentId}/questions`, {
    method: 'POST',
    body: {
      type,
      prompt: prompt.trim(),
      points: typeof points === 'string' && points.length > 0 ? points : 10,
      ...(needsOptions ? { options, correctOptions } : {}),
      ...(typeof explanation === 'string' && explanation.trim().length > 0
        ? { explanation: explanation.trim() }
        : {}),
    },
  });

  if (!result.ok) {
    return { error: result.error.message };
  }

  revalidatePath(`/docentes/evaluaciones/${assessmentId}`);
  return { ok: true };
}

export async function publishAssessment(formData: FormData): Promise<void> {
  const assessmentId = formData.get('assessmentId');
  if (typeof assessmentId !== 'string') return;

  await api(`/assessments/${assessmentId}/publish`, { method: 'POST', body: {} });

  revalidatePath(`/docentes/evaluaciones/${assessmentId}`);
  revalidatePath('/docentes/evaluaciones');
}

/**
 * Duplica una evaluación de GLEXCO para adaptarla.
 *
 * Es la salida al "no puedes editar esta evaluación": lo que quiere el docente
 * no es romper el banco común, es tener su propia versión. La copia nace en
 * borrador y con preguntas de identificador nuevo, así que las respuestas de las
 * dos no se mezclan.
 */
export async function cloneAssessment(formData: FormData): Promise<void> {
  const assessmentId = formData.get('assessmentId');
  if (typeof assessmentId !== 'string') return;

  const result = await api<{ assessmentId: string }>(`/assessments/${assessmentId}/clone`, {
    method: 'POST',
    body: {},
  });

  revalidatePath('/docentes/evaluaciones');

  if (result.ok) {
    redirect(`/docentes/evaluaciones/${result.data.assessmentId}`);
  }
}
