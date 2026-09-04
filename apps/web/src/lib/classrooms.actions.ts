'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api } from './api';

export interface NewClassroomState {
  error?: string;
  /** Campo concreto que falla, para marcarlo en el formulario. */
  field?: string;
}

/**
 * Crea un salon.
 *
 * **Esta accion no existia y el enlace para crear salones llevaba a un 404**, asi
 * que ni la direccion ni los docentes podian crear ninguno desde el portal: los
 * salones solo entraban por el sembrador. El permiso y el endpoint llevaban ahi
 * desde la Fase 2.
 *
 * `teacherId` solo se envia cuando de verdad se eligio a alguien. El backend lo
 * ignora si quien lo manda no es administrador -y hace bien-, pero enviarlo
 * vacio hace fallar la validacion del uuid con un mensaje que no dice nada.
 */
export async function createClassroom(
  _previous: NewClassroomState,
  formData: FormData,
): Promise<NewClassroomState> {
  const name = String(formData.get('name') ?? '').trim();
  const grade = String(formData.get('grade') ?? '').trim();
  const capacity = String(formData.get('capacity') ?? '').trim();
  const teacherId = String(formData.get('teacherId') ?? '').trim();

  if (!name) return { error: 'Ponle un nombre al salón, por ejemplo «4.º A».', field: 'name' };
  if (!grade) return { error: 'Elige el grado del salón.', field: 'grade' };

  const result = await api<{ classroomId: string }>('/classrooms', {
    method: 'POST',
    body: {
      name,
      grade,
      capacity: capacity ? Number(capacity) : undefined,
      ...(teacherId ? { teacherId } : {}),
    },
  });

  if (!result.ok) {
    // El duplicado tiene mensaje propio: es el error que de verdad ocurre, y
    // "no pudimos crear el salon" dejaria al director buscando qué falló cuando
    // lo unico que pasa es que ya lo creo antes.
    if (result.error.code === 'CLASSROOM_ALREADY_EXISTS' || result.status === 409) {
      return {
        error: 'Ya tienes un salón con ese nombre y ese grado este año.',
        field: 'name',
      };
    }
    if (result.status === 403) {
      return { error: 'No tienes permiso para crear salones en este colegio.' };
    }
    return { error: 'No pudimos crear el salón. Vuelve a intentarlo en un momento.' };
  }

  revalidatePath('/docentes');
  redirect(`/docentes/salones/${result.data.classroomId}`);
}
