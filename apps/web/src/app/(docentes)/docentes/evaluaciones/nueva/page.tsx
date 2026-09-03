import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import { fetchMyClassrooms } from '../../../../../lib/classrooms';
import { fetchKitOptions } from '../../../../../lib/teacher-assessments';
import { AssessmentCreateForm } from '../../../../../components/assessment-create-form';

export const metadata: Metadata = { title: 'Nueva evaluación' };

export default async function NewAssessmentPage() {
  await requireSession();

  const { items: classrooms } = await fetchMyClassrooms();

  // Los kits se piden por los grados que este docente REALMENTE da. Sin ese
  // filtro, el desplegable trae el catálogo entero y elegir el kit se convierte
  // en buscar entre kits de grados que no le tocan.
  const grades = [...new Set(classrooms.map((classroom) => classroom.grade))];
  const kitsByGrade = await Promise.all(grades.map((grade) => fetchKitOptions(grade)));

  // Sin salones -un docente recién dado de alta- se ofrece el catálogo
  // publicado completo: es preferible a un desplegable vacío que bloquea la
  // pantalla sin explicar por qué.
  const kits =
    grades.length > 0
      ? [...new Map(kitsByGrade.flat().map((kit) => [kit.kitId, kit])).values()]
      : await fetchKitOptions();

  return (
    <>
      <section>
        <a
          href="/docentes/evaluaciones"
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Evaluaciones
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          Crear una evaluación
        </h1>
      </section>

      <AssessmentCreateForm
        kits={kits}
        classrooms={classrooms.map((classroom) => ({
          classroomId: classroom.classroomId,
          name: classroom.name,
          grade: classroom.grade,
        }))}
      />
    </>
  );
}
