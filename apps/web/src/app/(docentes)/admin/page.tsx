import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PERMISSIONS } from '@glexco/contracts';
import { requireSession } from '../../../lib/session';
import {
  fetchPlatformInstitutions,
  fetchWeakestKits,
  kitLabel,
  scoreTone,
  type InstitutionDashboard,
} from '../../../lib/analytics';
import { BarList, StatTile } from '../../../components/charts';
import { Card, CardSkeleton, EmptyState, SectionTitle } from '../../../components/ui';

export const metadata: Metadata = { title: 'Panel de GLEXCO' };

/**
 * Panel de plataforma.
 *
 * **Esta ruta existia como destino y no como pantalla.** `portalPath` manda aqui
 * a los administradores de institucion y al personal de GLEXCO desde que hay
 * ingreso, asi que hasta ahora un director aterrizaba en un 404 nada mas entrar.
 * No se habia visto porque las comprobaciones del portal arman la cookie a mano
 * y van directas a `/docentes/institucion`.
 *
 * Un admin de institucion NO ve esto: lo suyo es su colegio. Se le lleva a su
 * panel en vez de mostrarle un error, que es la misma regla del resto del
 * portal: quien llega a una pantalla que no le toca no ha hecho nada mal.
 */
export default async function AdminPage() {
  const session = await requireSession();

  const isPlatform = session.permissions.includes(PERMISSIONS.ANALYTICS_READ_PLATFORM);
  if (!isPlatform) redirect('/docentes/institucion');

  return (
    <>
      <div>
        <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
          Panel de GLEXCO
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Todas las instituciones, y el contenido que peor funciona en todas ellas.
        </p>
      </div>

      <Suspense fallback={<CardSkeleton />}>
        <Plataforma />
      </Suspense>

      <Suspense fallback={<CardSkeleton />}>
        <KitsDebiles />
      </Suspense>
    </>
  );
}

async function Plataforma() {
  const { items, failed } = await fetchPlatformInstitutions();
  const t = await getTranslations('admin');
  const comun = await getTranslations('comun');

  if (failed) {
    return (
      <EmptyState
        title={t('noPudimosCargarPlataforma')}
        description={comun('reintentar')}
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('sinActividadMedida')}
        description={t('sinActividadMedidaAyuda')}
      />
    );
  }

  const totals = items.reduce(
    (acc, row) => ({
      students: acc.students + row.studentsMeasured,
      classrooms: acc.classrooms + row.classrooms,
      issued: acc.issued + row.codesIssued,
      redeemed: acc.redeemed + row.codesRedeemed,
    }),
    { students: 0, classrooms: 0, issued: 0, redeemed: 0 },
  );

  // La activación es la métrica comercial: los libros comprados que nadie
  // activó son dinero que el colegio pagó y no usa, y la señal más temprana de
  // que no va a renovar.
  const activacion =
    totals.issued > 0 ? Math.round((totals.redeemed / totals.issued) * 100) : null;

  return (
    <section aria-labelledby="plataforma" data-institutions={items.length}>
      <SectionTitle id="plataforma">{t('resumenPlataforma')}</SectionTitle>

      <div className="mb-[var(--portal-gap)] grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t('institucionesConActividad')} value={String(items.length)} />
        <StatTile label={t('alumnosMedidos')} value={String(totals.students)} />
        <StatTile label={t('salones')} value={String(totals.classrooms)} />
        {/* Con cero emitidos NO se dice "10 de 0": es una proporcion imposible y
            quien la lee concluye que la cifra esta mal, no que falte el dato.
            Pasa cuando hay canjes de lotes que nunca se marcaron como
            distribuidos a un colegio, y entonces lo cierto es que no sabemos
            cuantos se emitieron. */}
        <StatTile
          label={t('codigosActivados')}
          value={activacion === null ? '—' : `${activacion}%`}
          hint={
            totals.issued > 0
              ? t('deEmitidos', { activados: totals.redeemed, emitidos: totals.issued })
              : t('sinLotesAsignados', { activados: totals.redeemed })
          }
        />
      </div>

      <Card>
        {/* La tabla desborda en horizontal dentro de su propio contenedor: en un
            portátil de 13 pulgadas son ocho columnas, y sin esto la página
            entera se desplaza de lado. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">
              Instituciones con actividad, ordenadas por su última actividad
            </caption>
            <thead>
              <tr className="border-b border-line-200 text-left text-ink-500">
                <th scope="col" className="py-2 pr-4 font-medium">{t('columnaInstitucion')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('columnaSalones')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">{t('columnaAlumnosMedidos')}</th>
                <th scope="col" className="py-2 pr-4 font-medium">Media</th>
                <th scope="col" className="py-2 pr-4 font-medium">Mejora</th>
                <th scope="col" className="py-2 font-medium">{t('columnaActivacion')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <Fila key={row.institutionId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

async function Fila({ row }: { row: InstitutionDashboard }) {
  const { label } = scoreTone(await getTranslations(), row.averagePercentage);
  const t = await getTranslations('admin');
  const activacion =
    row.codesIssued > 0 ? Math.round((row.codesRedeemed / row.codesIssued) * 100) : null;

  return (
    <tr className="border-b border-line-200 last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-medium text-ink-900">
        {/* Un colegio recién creado puede no tener nombre todavía: llega por
            evento y la proyección va unos segundos por detrás. Se dice, en vez
            de pintar un hueco que parece un fallo. */}
        {row.name ?? <span className="text-ink-400">{t('sinNombreTodavia')}</span>}
        {row.city ? <span className="block text-xs font-normal text-ink-500">{row.city}</span> : null}
        {row.status === 'suspended' ? (
          <span className="mt-1 inline-block rounded-full bg-surface-200 px-2 py-0.5 text-xs font-medium text-ink-700">
            {t('suspendida')}
          </span>
        ) : null}
      </th>
      <td className="py-3 pr-4 tabular-nums text-ink-700">{row.classrooms}</td>
      <td className="py-3 pr-4 tabular-nums text-ink-700">{row.studentsMeasured}</td>
      <td className="py-3 pr-4 tabular-nums text-ink-900">
        {row.averagePercentage === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          <>
            {Math.round(row.averagePercentage)}%{' '}
            {/* El estado va SIEMPRE con su etiqueta de texto y nunca solo con
                color: el par verde/ámbar queda en ΔE 6.9 para protanopía. */}
            <span className="text-xs font-medium text-ink-500">{label}</span>
          </>
        )}
      </td>
      <td className="py-3 pr-4 tabular-nums text-ink-700">
        {row.averageGain === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          `${row.averageGain > 0 ? '+' : ''}${Math.round(row.averageGain)}`
        )}
      </td>
      <td className="py-3 tabular-nums text-ink-700">
        {activacion === null ? (
          <span className="text-ink-400">—</span>
        ) : (
          <>
            {activacion}%
            <span className="block text-xs text-ink-500">
              {row.codesRedeemed} de {row.codesIssued}
            </span>
          </>
        )}
      </td>
    </tr>
  );
}

/**
 * Kits con peor resultado en todas partes.
 *
 * Es la señal más valiosa que produce esta plataforma para el equipo académico:
 * si un kit va mal en TODOS los colegios, el problema es del contenido y no de
 * los alumnos. Solo cuenta con evaluaciones de GLEXCO, que son las únicas
 * comparables entre centros.
 */
async function KitsDebiles() {
  const vocab = await getTranslations();
  const t = await getTranslations('admin');
  const { items, failed } = await fetchWeakestKits(10);

  if (failed || items.length === 0) {
    return (
      <EmptyState
        title={t('sinEntregasGlexco')}
        description={t('sinEntregasGlexcoAyuda')}
      />
    );
  }

  // Los que ya tienen muestra suficiente van arriba y son los unicos sobre los
  // que se decide; los demas se listan aparte diciendo cuanto les falta. Antes
  // se ocultaban, y con pocos colegios la pantalla salia vacia con un mensaje
  // que no decia cuanto quedaba: un panel vacio se lee como roto.
  const solidos = items.filter((kit) => kit.meaningful !== false);
  const pocos = items.filter((kit) => kit.meaningful === false);

  return (
    <section aria-labelledby="kits-debiles" data-weak-kits={items.length}>
      <SectionTitle id="kits-debiles">{t('kitsPeorResultado')}</SectionTitle>
      <p className="-mt-2 mb-4 max-w-2xl text-sm text-ink-500">
        {t('soloEvaluacionesComparables')}
      </p>

      {solidos.length === 0 ? (
        <p className="mb-4 rounded-[var(--portal-radius)] border border-line-200 bg-white px-4 py-3 text-sm text-ink-700">
          {t('ningunKitConMuestra')}
        </p>
      ) : null}

      {solidos.length > 0 ? (
      <BarList
        title={t('mediaPorKit')}
        data={solidos.map((kit) => {
          const { tone, label } = scoreTone(vocab, kit.averagePercentage);
          return {
            label: t('kitConAlumnos', { kit: kitLabel(kit), cuantos: kit.studentsMeasured }),
            value: kit.averagePercentage === null ? 0 : Math.round(kit.averagePercentage),
            // El color es el que hace util esta lista de un vistazo: la pregunta
            // que se hace aqui es "cual esta en rojo", no "cual mide 62".
            tone,
            toneLabel: label,
          };
        })}
        emptyMessage={t('sinKitsConDatos')}
      />
      ) : null}

      {pocos.length > 0 ? (
        <div className="mt-4 rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]">
          <p className="eyebrow mb-3">{t('sinMuestraSuficiente')}</p>
          <ul className="grid gap-2">
            {pocos.map((kit) => (
              <li
                key={kit.kitId}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span className="text-ink-700">{kitLabel(kit)}</span>
                <span className="tabular-nums text-ink-500">
                  {t('alumnosContados', { cuantos: kit.studentsMeasured })} ·{' '}
                  {t('faltanParaComparar', {
                    cuantos: Math.max(15 - kit.studentsMeasured, 0),
                  })}
                </span>
              </li>
            ))}
          </ul>
          {/* Se dice POR QUE no se usan, no solo que no se usan. Sin esto, quien
              lo mire concluye que el panel esta a medias en vez de que la
              muestra es corta. */}
          <p className="mt-3 text-xs text-ink-500">
            Con menos de 15 alumnos la media de un kit dice más del salón que le tocó que del
            contenido, así que no se usa para decidir nada.
          </p>
        </div>
      ) : null}
    </section>
  );
}
