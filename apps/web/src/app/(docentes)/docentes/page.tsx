import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { ClassroomIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { fetchMyClassrooms } from '../../../lib/classrooms';
import { fetchPendingSubmissions } from '../../../lib/grading';
import { gradeLabel } from '../../../lib/catalog';
import { Card, CardSkeleton, EmptyState, SectionTitle, Stat } from '../../../components/ui';
import { PageHeader } from '../../../components/page-header';

export const metadata: Metadata = { title: 'Mis salones' };

export default async function DocentesHome() {
  const session = await requireSession();

  // Un director NO tiene salones: tiene los del colegio, y los ve todos. Decirle
  // "mis salones" sobre una lista que incluye los de otros tres docentes es
  // decirle algo falso, y ademas le hace dudar de si esta viendo lo que debe.
  const manages = session.portal === 'institution' || session.portal === 'admin';

  return (
    <>
      {/* El boton va en la cabecera y no solo en el estado vacio: quien ya
          tiene salones tambien crea el del curso siguiente, y ahi el estado
          vacio no aparece nunca. Antes solo se llegaba a crear un salon si no
          tenias ninguno... y el enlace daba 404. */}
      <PageHeader
        title={manages ? 'Dirección' : 'Panel principal'}
        subtitle={`${session.firstName} ${session.lastName} · año académico ${new Date().getFullYear()}`}
        actions={
          <a href="/docentes/salones/nuevo" className="btn btn-sm btn-primary">
            Crear salón
          </a>
        }
      />

      {/* La fila de cifras es lo que el canvas pone arriba del todo, y responde
          a las preguntas con las que el docente entra: cuantos alumnos tengo,
          cuantos sitios quedan y cuanto tengo pendiente de corregir. Antes habia
          que abrir salon por salon para saberlo. */}
      <Suspense fallback={<CifrasSkeleton />}>
        <Cifras />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <Classrooms manages={manages} />
      </Suspense>
    </>
  );
}

async function Cifras() {
  const { items, failed } = await fetchMyClassrooms();
  if (failed || items.length === 0) return null;

  const alumnos = items.reduce((total, c) => total + c.enrolledCount, 0);
  const cupos = items.reduce((total, c) => total + c.capacity, 0);

  return (
    <section aria-labelledby="cifras" className="grid gap-[var(--portal-gap)] sm:grid-cols-3">
      <h2 id="cifras" className="sr-only">
        Resumen de tus salones
      </h2>
      <Stat value={String(items.length)} label="Salones activos" />
      {/* El par y no el porcentaje: "68 de 80" dice cuantos sitios quedan, que
          es lo que el docente va a querer saber antes de admitir a nadie mas. */}
      <Stat value={`${alumnos} de ${cupos}`} label="Alumnos sobre cupos" />

      {/* La correccion pendiente va en su propio Suspense porque cuesta una
          llamada por salon: bloquear con ella las otras dos cifras -que salen de
          una sola- retrasaria toda la fila por el dato mas caro. */}
      <Suspense fallback={<StatSkeleton label="Entregas por calificar" />}>
        <PorCalificar classroomIds={items.map((c) => c.classroomId)} />
      </Suspense>
    </section>
  );
}

async function PorCalificar({ classroomIds }: { classroomIds: readonly string[] }) {
  // En paralelo y no en serie: con cuatro salones, encadenarlas multiplica por
  // cuatro la espera de una cifra que cabe en una linea.
  const results = await Promise.all(classroomIds.map((id) => fetchPendingSubmissions(id)));

  // Si alguna falla no se pinta un cero: un cero es "no tienes nada pendiente",
  // y decirselo a un docente que si lo tiene es peor que no decirle nada.
  if (results.some((r) => r.failed)) return null;

  const total = results.reduce((sum, r) => sum + r.items.length, 0);

  return <Stat value={String(total)} label="Entregas por calificar" />;
}

function StatSkeleton({ label }: { label: string }) {
  return (
    <div
      className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
      aria-hidden="true"
    >
      <p className="eyebrow mb-2">{label}</p>
      <div className="h-7 w-12 animate-pulse rounded bg-surface-200" />
    </div>
  );
}

function CifrasSkeleton() {
  return (
    <div className="grid gap-[var(--portal-gap)] sm:grid-cols-3" aria-hidden="true">
      <StatSkeleton label="Salones activos" />
      <StatSkeleton label="Alumnos sobre cupos" />
      <StatSkeleton label="Entregas por calificar" />
    </div>
  );
}

async function Classrooms({ manages }: { manages: boolean }) {
  const vocab = await getTranslations();
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
        title={manages ? 'El colegio aún no tiene salones' : 'Todavía no tienes salones'}
        description="Crea el primer salón para que los alumnos puedan registrarse en él."
        action={{ href: '/docentes/salones/nuevo', label: 'Crear un salón' }}
      />
    );
  }

  return (
    <section aria-labelledby="salones">
      <SectionTitle id="salones">{manages ? 'Salones del colegio' : 'Mis salones'}</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
        {items.map((classroom) => (
          <Card key={classroom.classroomId}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg font-semibold">{classroom.name}</h3>
                <p className="mt-0.5 text-sm text-ink-500">
                  {gradeLabel(vocab, classroom.grade)}
                  {manages && classroom.teacherName ? ` · ${classroom.teacherName}` : ''}
                </p>
              </div>

              {/*
                Plazas ocupadas sobre el tope. Se muestra el par y no un
                porcentaje: "18 de 20" le dice al docente cuántos caben todavía,
                que es lo que va a querer saber; "90 %" no.
              */}
              <span className="shrink-0 rounded-full bg-state-idle-bg px-3 py-1 text-xs font-medium tabular-nums text-state-idle-fg">
                {classroom.enrolledCount} / {classroom.capacity}
              </span>
            </div>

            <a href={`/docentes/salones/${classroom.classroomId}`} className="btn btn-primary mt-5">
              Ver cómo va
            </a>
          </Card>
        ))}
      </div>
    </section>
  );
}
