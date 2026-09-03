import type { Metadata } from 'next';
import { requireSession } from '../../../../../../../lib/session';
import {
  fetchRoster,
  fetchSubmissionForGrading,
  studentLabel,
} from '../../../../../../../lib/grading';
import { shortDate } from '../../../../../../../lib/analytics';
import { GradingForm } from '../../../../../../../components/grading-form';
import { EmptyState } from '../../../../../../../components/ui';

export const metadata: Metadata = { title: 'Corregir entrega' };

export default async function GradeSubmissionPage({
  params,
}: {
  params: Promise<{ classroomId: string; submissionId: string }>;
}) {
  await requireSession();
  const { classroomId, submissionId } = await params;

  const [submission, roster] = await Promise.all([
    fetchSubmissionForGrading(submissionId),
    fetchRoster(classroomId),
  ]);

  if (submission.failed || !submission.data) {
    return (
      <EmptyState
        title="No pudimos abrir esta entrega"
        description="Puede que no pertenezca a uno de tus salones."
        action={{ href: `/docentes/salones/${classroomId}/correccion`, label: 'Volver a la bandeja' }}
      />
    );
  }

  const data = submission.data;
  const studentName = studentLabel(data.studentId, roster.byId);

  return (
    <>
      <section>
        <a
          href={`/docentes/salones/${classroomId}/correccion`}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          ← Por corregir
        </a>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="mt-1 font-semibold">
          {studentName}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {data.assessmentTitle} · intento {data.attemptNumber}
          {data.submittedAt ? ` · entregó el ${shortDate(data.submittedAt)}` : ''}
          {' · aprueba con '}
          {data.passingScore}%
        </p>
      </section>

      <GradingForm submission={data} studentName={studentName} />
    </>
  );
}
