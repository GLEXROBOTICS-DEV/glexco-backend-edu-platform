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

/** El salón del propio alumno, tal y como lo devuelve `/classrooms/mine`. */
export interface MyClassroom {
  classroomId: string;
  institutionId: string;
  name: string;
  grade: string;
  teacherName: string | null;
  academicYear: number;
}

/**
 * El salón del alumno que está viendo la página.
 *
 * Hace falta al abrir un intento de evaluación: una entrega sin salón no
 * aparece en la bandeja de corrección de ningún docente, así que el alumno
 * respondería al vacío. Devuelve `null` sin error para un alumno
 * independiente —que no tiene salón y es la mitad del modelo de negocio— y
 * también si la llamada falla: un cuestionario que no se puede abrir es peor
 * que uno que se entrega sin salón.
 */
export async function fetchMyClassroom(): Promise<string | null> {
  const result = await api<{ items: MyClassroom[] }>('/classrooms/mine');

  if (!result.ok) {
    console.error('No se pudo leer el salón del alumno', {
      code: result.error.code,
      correlationId: result.error.correlationId,
    });
    return null;
  }

  return result.data.items?.[0]?.classroomId ?? null;
}

/**
 * Docentes del colegio, para asignarles un salon.
 *
 * Solo lo puede pedir la direccion; un docente recibe 403 y la pantalla se
 * limita a crear el salon a su propio nombre, que es lo unico que puede hacer.
 */
export async function fetchInstitutionTeachers(): Promise<
  Array<{ userId: string; fullName: string }>
> {
  const result = await api<{ items: Array<{ userId: string; fullName: string }> }>(
    '/classrooms/teachers',
  );

  if (!result.ok) {
    // Un 403 aqui es lo normal para un docente y no se registra como error: se
    // devuelve la lista vacia y la pantalla se adapta.
    if (result.status !== 403) {
      console.error('No se pudo leer el listado de docentes', {
        status: result.status,
        code: result.error.code,
        correlationId: result.error.correlationId,
      });
    }
    return [];
  }

  return result.data.items ?? [];
}
