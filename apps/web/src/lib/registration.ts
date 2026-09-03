import 'server-only';
import { gatewayUrl } from './api';

/**
 * Lecturas publicas del formulario de registro.
 *
 * No usan `api()` a proposito: `api()` adjunta el token de sesion, y estas dos
 * llamadas ocurren cuando todavia no hay cuenta. Enviar una cabecera de
 * autorizacion vacia no rompe nada, pero pasar por el mismo camino que las
 * llamadas autenticadas invita a que alguien anada mas tarde una cache por
 * usuario a un endpoint que es anonimo.
 *
 * Las dos son deliberadamente parcas. `by-code` no devuelve conteos de alumnos
 * ni datos del responsable, y `selectable` devuelve `hasCapacity` en vez del
 * numero de matriculados: un endpoint publico que dijera "27 de 30" permitiria
 * a un tercero medir la matricula de cualquier colegio sondeandolo.
 */

export interface PublicInstitution {
  institutionId: string;
  name: string;
  shortName: string;
  city: string;
  educationLevels: string[];
}

export interface SelectableClassroom {
  id: string;
  name: string;
  teacherName: string | null;
  hasCapacity: boolean;
}

/**
 * Busca el colegio por el codigo que el centro reparte a sus alumnos.
 *
 * Devuelve `null` tanto si no existe como si el servicio no responde. El
 * formulario no distingue los dos casos hacia el usuario: en ambos lo unico que
 * puede hacer es revisar el codigo o volver a intentarlo, y separarlos
 * confirmaria a un tercero que codigos son reales.
 */
export async function lookupInstitution(code: string): Promise<PublicInstitution | null> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;

  try {
    const response = await fetch(
      `${gatewayUrl}/api/v1/institutions/by-code/${encodeURIComponent(trimmed)}`,
      { headers: { accept: 'application/json' }, cache: 'no-store' },
    );

    if (!response.ok) return null;
    return (await response.json()) as PublicInstitution;
  } catch (error) {
    console.error('No se pudo buscar la institucion por codigo', error);
    return null;
  }
}

/**
 * Salones del colegio abiertos a matricula para un grado.
 *
 * Devuelve lista vacia si algo falla. La pantalla lo trata como "este grado no
 * tiene salones disponibles", que es lo unico accionable para el alumno.
 */
export async function fetchSelectableClassrooms(
  institutionId: string,
  grade: string,
): Promise<SelectableClassroom[]> {
  const url = new URL(`${gatewayUrl}/api/v1/classrooms/selectable`);
  url.searchParams.set('institutionId', institutionId);
  url.searchParams.set('grade', grade);

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) return [];

    const body: unknown = await response.json();
    // El endpoint devuelve un array desnudo; se admite tambien la forma
    // envuelta para que un cambio de convencion en el backend no deje la
    // pantalla en blanco sin que nadie lo note.
    if (Array.isArray(body)) return body as SelectableClassroom[];
    return ((body as { items?: SelectableClassroom[] })?.items ?? []) as SelectableClassroom[];
  } catch (error) {
    console.error('No se pudieron leer los salones elegibles', error);
    return [];
  }
}
