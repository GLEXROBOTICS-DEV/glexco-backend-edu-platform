'use server';

import { revalidatePath } from 'next/cache';
import { api } from './api';
import type { OpenAttempt } from './assessments';

/**
 * Acciones de un cuestionario.
 *
 * Son Server Actions y no llamadas desde el navegador por el mismo motivo que el
 * ingreso: el token vive en una cookie `httpOnly` que el JavaScript de la página
 * no puede leer, así que la llamada autenticada tiene que salir del servidor.
 *
 * Aquí hay además una razón de fondo: **la corrección ocurre en el servidor y en
 * ningún otro sitio.** El cliente no conoce las respuestas correctas y no puede
 * conocerlas; lo único que hace es enviar lo que marcó el alumno.
 */

export interface AttemptState {
  attempt?: OpenAttempt;
  error?: string;
}

export async function startAttempt(
  assessmentId: string,
  classroomId: string | null,
): Promise<AttemptState> {
  const result = await api<OpenAttempt>(`/assessments/${assessmentId}/attempts`, {
    method: 'POST',
    body: classroomId ? { classroomId } : {},
  });

  if (!result.ok) {
    return { error: result.error.message };
  }

  return { attempt: result.data };
}

export interface SubmitState {
  status?: 'graded' | 'submitted';
  score?: number | null;
  maxScore?: number;
  passed?: boolean | null;
  awaitingManualGrading?: boolean;
  error?: string;
}

/**
 * Guarda todas las respuestas y entrega.
 *
 * Se guardan una a una **antes** de entregar, aunque parezca redundante con el
 * envío final. El motivo es que un cuestionario largo en el portátil de un
 * laboratorio se pierde con cualquier cosa -la sesión que se cierra, el equipo
 * que se apaga-, y las respuestas guardadas sobreviven. El backend permite
 * reescribirlas mientras el intento siga abierto.
 */
export async function submitAttempt(
  _previous: SubmitState,
  formData: FormData,
): Promise<SubmitState> {
  const submissionId = formData.get('submissionId');
  const questionIds = formData.getAll('questionId');

  if (typeof submissionId !== 'string' || questionIds.length === 0) {
    return { error: 'Faltan datos del intento. Vuelve a abrirlo.' };
  }

  for (const rawId of questionIds) {
    const questionId = String(rawId);
    const selected = formData
      .getAll(`answer:${questionId}`)
      .map(String)
      .filter((value) => value.length > 0);
    const text = formData.get(`text:${questionId}`);

    // Ordenar viaja como un campo por paso (`orden:pregunta:opcion` -> puesto) y
    // NO como una lista de opciones marcadas. Es la unica forma de conocer el
    // orden que eligio el alumno: `getAll` devuelve los valores en el orden del
    // DOM, que es el de la pantalla y no el de su respuesta.
    const ordenados = ordering(formData, questionId);

    const saved = await api(`/assessments/attempts/${submissionId}/answers`, {
      method: 'POST',
      body: {
        questionId,
        ...(ordenados.length > 0
          ? { selectedOptionIds: ordenados }
          : selected.length > 0
            ? { selectedOptionIds: selected }
            : {}),
        ...(typeof text === 'string' && text.trim().length > 0 ? { text: text.trim() } : {}),
      },
    });

    if (!saved.ok) {
      return { error: saved.error.message };
    }
  }

  const submitted = await api<{
    status: 'graded' | 'submitted';
    score: number | null;
    maxScore: number;
    passed: boolean | null;
    awaitingManualGrading: boolean;
  }>(`/assessments/attempts/${submissionId}/submit`, { method: 'POST', body: {} });

  if (!submitted.ok) {
    return { error: submitted.error.message };
  }

  // El dashboard se alimenta de una proyección asíncrona, así que invalidar la
  // ruta no garantiza que el número esté ya ahí. Se invalida igualmente: cuando
  // el alumno llegue, la página se habrá recalculado y en la mayoría de los
  // casos el evento ya estará aplicado.
  revalidatePath('/discover/progreso');
  revalidatePath('/academy/progreso');

  return {
    status: submitted.data.status,
    score: submitted.data.score,
    maxScore: submitted.data.maxScore,
    passed: submitted.data.passed,
    awaitingManualGrading: submitted.data.awaitingManualGrading,
  };
}

/**
 * La secuencia que eligio el alumno en una pregunta de ordenar.
 *
 * Llega como un campo por paso -`orden:<pregunta>:<opcion>` con el puesto- y no
 * como una lista de opciones marcadas. Es la unica forma de saber el orden:
 * `formData.getAll` devuelve los valores en el orden del DOM, que es el de la
 * pantalla y no el de la respuesta.
 *
 * Un paso sin puesto se descarta, y la respuesta queda incompleta: el dominio la
 * puntua a cero, que es lo correcto. Rellenar los huecos aqui inventaria un
 * orden que el alumno no eligio.
 *
 * Si repite un numero, se ordena por puesto y, a igualdad, por como venian. No
 * se rechaza: repetir un numero obliga a dejar otro sin usar, asi que la
 * secuencia ya esta mal y la puntuacion parcial mide igual lo que si acerto.
 * Devolver un error aqui castigaria dos veces el mismo despiste.
 */
function ordering(formData: FormData, questionId: string): string[] {
  const prefijo = `orden:${questionId}:`;
  const puestos: { optionId: string; puesto: number }[] = [];

  for (const [campo, valor] of formData.entries()) {
    if (!campo.startsWith(prefijo)) continue;

    const puesto = Number(String(valor));
    if (!Number.isInteger(puesto) || puesto < 1) continue;

    puestos.push({ optionId: campo.slice(prefijo.length), puesto });
  }

  return puestos.sort((a, b) => a.puesto - b.puesto).map((entrada) => entrada.optionId);
}
