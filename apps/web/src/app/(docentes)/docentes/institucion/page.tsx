import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import {
  fetchInstitutionDashboard,
  fetchTeachingReport,
  scoreTone,
} from '../../../../lib/analytics';
import { gradeLabel } from '../../../../lib/catalog';
import { BarList, StatTile } from '../../../../components/charts';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../../components/ui';

export const metadata: Metadata = { title: 'Mi institución' };

export default async function InstitucionPage() {
  const session = await requireSession();

  // Un docente no tiene esta pantalla. Se le devuelve a la suya en vez de
  // mostrarle un error: no ha hecho nada mal, simplemente no es para él.
  if (session.portal !== 'institution' && session.portal !== 'admin') {
    redirect('/docentes');
  }

  if (!session.institutionId) {
    return (
      <EmptyState
        title="Tu cuenta no está asociada a una institución"
        description="Escribe a soporte para que la vinculen."
      />
    );
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
        Mi institución
      </h1>

      <Suspense fallback={<CardSkeleton />}>
        <Overview institutionId={session.institutionId} />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <Teaching institutionId={session.institutionId} />
      </Suspense>
    </>
  );
}

/** "¿Cómo va mi colegio?" */
async function Overview({ institutionId }: { institutionId: string }) {
  const vocab = await getTranslations();
  const { data, failed } = await fetchInstitutionDashboard(institutionId);

  if (failed || !data) {
    return (
      <EmptyState
        title="No pudimos cargar el resumen"
        description="Vuelve a intentarlo en un momento."
      />
    );
  }

  const level = scoreTone(vocab, data.averagePercentage);

  // Códigos comprados que nadie activó. Es la métrica comercial y la señal más
  // temprana de que un colegio no va a renovar: se paga por libros que no se
  // usan.
  const unredeemed = data.codesIssued - data.codesRedeemed;
  const activationRate =
    data.codesIssued > 0 ? Math.round((data.codesRedeemed / data.codesIssued) * 100) : null;

  return (
    <section aria-labelledby="resumen-institucion" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="resumen-institucion">Resumen del colegio</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Nota media"
          value={data.averagePercentage}
          unit="%"
          tone={level.tone}
          toneLabel={level.label}
          hint="Solo evaluaciones GLEXCO"
        />
        <StatTile
          label="Cuánto ha mejorado"
          value={data.averageGain === null ? null : data.averageGain > 0 ? `+${data.averageGain}` : data.averageGain}
          unit=" pts"
          hint="Progreso medio desde el primer intento"
        />
        <StatTile label="Salones con resultados" value={data.classrooms} hint={`${data.studentsMeasured} alumnos`} />
        <StatTile
          label="Códigos activados"
          value={activationRate}
          unit="%"
          tone={activationRate === null ? 'neutral' : activationRate < 70 ? 'warning' : 'good'}
          toneLabel={
            activationRate === null
              ? undefined
              : activationRate < 70
                ? `${unredeemed} libros sin activar`
                : 'Buena activación'
          }
          hint={`${data.codesRedeemed} de ${data.codesIssued}`}
        />
      </div>

      {/*
        Por grado, y no un ranking global de salones. Comparar 1.º de primaria
        con 5.º de secundaria no dice nada de ninguno de los dos: son contenidos
        distintos y edades distintas.
      */}
      <BarList
        title="Nota media por grado"
        unit="%"
        emptyMessage="Todavía no hay resultados por grado."
        data={data.byGrade.map((entry) => {
          const { tone, label } = scoreTone(vocab, entry.averagePercentage);
          return {
            label: gradeLabel(vocab, entry.grade),
            value: Math.round(entry.averagePercentage ?? 0),
            meta: `${entry.classrooms} ${entry.classrooms === 1 ? 'salón' : 'salones'}`,
            tone,
            toneLabel: label,
          };
        })}
      />
    </section>
  );
}

/**
 * "¿Dónde hace falta apoyo?"
 *
 * **No es un ranking de profesores, y la pantalla lo dice.** Se ordena por
 * progreso —cuánto avanzó cada salón desde su punto de partida— y no por nota,
 * porque la nota mide sobre todo con qué alumnado empieza cada docente: dos
 * profesores igual de buenos dan números muy distintos si uno tiene el salón de
 * refuerzo.
 *
 * El aviso del backend se pinta **arriba y visible**, no en un pie de página.
 * Quien mire esta pantalla va a tomar decisiones sobre personas con ella; tiene
 * que ver qué mide y qué no antes de leer la primera fila.
 */
async function Teaching({ institutionId }: { institutionId: string }) {
  const vocab = await getTranslations();
  const { data, failed } = await fetchTeachingReport(institutionId);

  if (failed || !data) return null;

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="Aún no hay datos por salón"
        description="Cuando los alumnos entreguen evaluaciones podrás ver en qué salones hace falta más acompañamiento."
      />
    );
  }

  return (
    <section aria-labelledby="apoyo" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="apoyo">Dónde hace falta apoyo</SectionTitle>

      <Card>
        <p className="text-sm text-ink-700">
          <strong className="font-semibold">Qué mide:</strong> {data.metric}
        </p>
        <p className="mt-2 text-sm text-ink-500">{data.caveat}</p>
      </Card>

      <BarList
        title="Progreso medio por salón"
        unit=" pts"
        max={40}
        data={data.rows.map((row) => ({
          label: `${row.grade ? gradeLabel(vocab, row.grade) : 'Salón'} · ${row.classroomId.slice(0, 8)}`,
          value: Math.round(row.averageGain ?? 0),
          meta: `${row.sampleSize} alumnos`,
          // El aviso de muestra insuficiente va POR FILA, no una vez arriba:
          // quien lee una tabla mira la fila, no la cabecera.
          tone: row.statisticallyMeaningful ? 'neutral' : 'warning',
          toneLabel: row.statisticallyMeaningful
            ? undefined
            : 'Muestra pequeña: no permite concluir nada',
        }))}
      />
    </section>
  );
}
