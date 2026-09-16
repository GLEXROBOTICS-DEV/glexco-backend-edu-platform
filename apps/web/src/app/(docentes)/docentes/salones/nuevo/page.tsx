import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireSession } from '../../../../../lib/session';
import { fetchInstitutionTeachers } from '../../../../../lib/classrooms';
import { PageHeader } from '../../../../../components/page-header';
import { ClassroomForm } from '../../../../../components/classroom-form';

export const metadata: Metadata = { title: 'Nuevo salón' };

/**
 * Crear un salón.
 *
 * **Esta pantalla no existía**, y el estado vacío del panel del docente llevaba
 * a ella desde el principio: cualquiera que no tuviera salones pulsaba «crear»
 * y aterrizaba en un 404. Los salones solo entraban por el sembrador.
 */
export default async function NuevoSalon() {
  await requireSession();

  // Devuelve vacío para un docente -403, que aquí es lo normal- y la lista real
  // para la dirección. El formulario se adapta solo.
  const t = await getTranslations('docente');
  const teachers = await fetchInstitutionTeachers();

  return (
    <>
      <PageHeader
        title={t('nuevoSalon')}
        subtitle={t('nuevoSalonAyuda')}
      />

      <ClassroomForm teachers={teachers} />
    </>
  );
}
