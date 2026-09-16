'use server';

import { getTranslations } from 'next-intl/server';
import { revalidatePath } from 'next/cache';
import { api } from './api';

/**
 * Publicar una mision semanal.
 *
 * El **origen no se envia nunca**, igual que en las evaluaciones: lo decide el
 * backend segun quien llama. Mandarlo desde aqui dejaria que un administrador
 * de colegio publicara una mision como contenido de GLEXCO y la colara en todos
 * los colegios que tienen ese kit.
 *
 * Una mision nace PUBLICADA y no en borrador. No tiene preguntas que preparar
 * aparte -sus objetivos viajan con ella-, asi que un estado intermedio solo
 * anadiria un paso que nadie querria dar.
 */

export interface MissionState {
  error?: string;
  /** Campo concreto que falla, para marcarlo en el formulario. */
  field?: string;
  ok?: boolean;
}

/** Tope de objetivos por mision; el mismo que acepta el esquema del contrato. */
const MAX_OBJETIVOS = 10;

export async function publishMission(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const t = await getTranslations('errores');

  const kitId = String(formData.get('kitId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  const weekNumber = Number(formData.get('weekNumber'));
  const xpReward = Number(formData.get('xpReward'));

  if (!kitId) return { error: t('eligeElKit'), field: 'kitId' };
  if (title.length < 3) return { error: t('tituloDeTresLetras'), field: 'title' };
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return { error: t('semanaInvalida'), field: 'weekNumber' };
  }
  if (!Number.isInteger(xpReward) || xpReward < 1) {
    return { error: t('recompensaInvalida'), field: 'xpReward' };
  }

  // Los objetivos llegan como dos listas paralelas -tipo y cantidad- porque asi
  // es como los manda un formulario nativo, y este formulario tiene que
  // funcionar sin JavaScript. Se emparejan por posicion y se descartan las
  // filas que el docente dejo en blanco.
  const kinds = formData.getAll('objectiveKind').map(String);
  const targets = formData.getAll('objectiveTarget').map(String);

  const objectives = kinds
    .map((kind, index) => ({ kind, target: Number(targets[index] ?? '') }))
    .filter((objective) => objective.kind && Number.isInteger(objective.target) && objective.target > 0)
    .slice(0, MAX_OBJETIVOS);

  if (objectives.length === 0) {
    return { error: t('misionSinObjetivos'), field: 'objectives' };
  }

  const result = await api<{ missionId: string }>('/learning/missions', {
    method: 'POST',
    body: {
      kitId,
      weekNumber,
      title,
      ...(description ? { description } : {}),
      objectives,
      xpReward,
    },
  });

  if (!result.ok) {
    if (result.status === 403) return { error: t('sinPermisoParaMisiones') };
    return { error: result.error.message || t('noPudimosPublicarMision') };
  }

  // La lista de arriba tiene que reflejar la mision nueva: es la que dice que
  // semanas estan ocupadas, y sin refrescarla el siguiente alta se hace con
  // informacion vieja.
  revalidatePath('/admin/misiones');

  return { ok: true };
}
