import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClassroomIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyClassrooms } from '../../../lib/classrooms';
import { gradeLabel } from '../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../components/ui';

export const metadata: Metadata = { title: 'Mis salones' };

export default async function DocentesHome() {
  const session = await requireSession();

  return (
    <>
      <section>
        <p className="text-sm font-medium text-ink-500">
          {session.firstName} {session.lastName}
        </p>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
          Mis salones
        </h1>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Classrooms />
      </Suspense>
    </>
  );
}

async function Classrooms() {
  const { items, failed } = await fetchMyClassrooms();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus salones"
        description="Vuelve a intentarlo en un momento. Si continúa, escribe a soporte."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ClassroomIcon size={32} />}
        title="Todavía no tienes salones"
        description="Crea tu primer salón para que tus alumnos puedan registrarse en él."
        action={{ href: '/docentes/salones/nuevo', label: 'Crear un salón' }}
      />
    );
  }

  return (
    <section aria-labelledby="salones">
      <SectionTitle id="salones">Este año académico</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
        {items.map((classroom) => (
          <Card key={classroom.classroomId}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-semibold">{classroom.name}</h3>
                <p className="mt-0.5 text-sm text-ink-500">{gradeLabel(classroom.grade)}</p>
              </div>

              {/*
                Plazas ocupadas sobre el tope. Se muestra el par y no un
                porcentaje: "18 de 20" le dice al docente cuántos caben todavía,
                que es lo que va a querer saber; "90 %" no.
              */}
              <span className="shrink-0 rounded-full bg-surface-200 px-3 py-1 text-xs font-medium tabular-nums text-ink-700">
                {classroom.enrolledCount} / {classroom.capacity}
              </span>
            </div>

            <a
              href={`/docentes/salones/${classroom.classroomId}`}
              className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Ver cómo va
            </a>
          </Card>
        ))}
      </div>
    </section>
  );
}
