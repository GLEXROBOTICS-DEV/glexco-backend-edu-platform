import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { requireSession } from '../../../../../lib/session';
import { fetchClassroomDashboard, scoreTone, shortDate } from '../../../../../lib/analytics';
import { BarList, StatTile } from '../../../../../components/charts';
import { CardSkeleton, EmptyState, SectionTitle } from '../../../../../components/ui';
import { ClassroomRoster } from '../../../../../components/classroom-roster';

export const metadata: Metadata = { title: 'Salón' };

export default async function ClassroomDashboardPage({
  params,
}: {
  params: Promise<{ classroomId: string }>;
}) {
  await requireSession();
  const { classroomId } = await params;
  const t = await getTranslations('docente');

  return (
    <>
      <section>
        <a href="/docentes" className="text-sm font-medium text-brand-600 hover:underline">
          {t('volverAMisSalones')}
        </a>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 style={{ fontSize: 'var(--portal-title-size)' }} className="font-semibold">
            {t('comoVaElSalon')}
          </h1>
          {/*
            La bandeja se enlaza desde aquí y no desde el menú: se entra a
            corregir DE un salón, y un enlace global obligaría a elegir el salón
            otra vez en la pantalla siguiente.
          */}
          <a
            href={`/docentes/salones/${classroomId}/correccion`}
            className="btn btn-primary"
          >
            {t('porCorregir')}
          </a>
        </div>
      </section>

      {/* La lista va ANTES de las cifras. La pregunta con la que un docente
          entra es "quien necesita ayuda", y la media del grupo no la responde:
          la responde una fila con un nombre. Las cifras explican al grupo, y eso
          se mira despues. */}
      <section aria-labelledby="clase">
        <SectionTitle id="clase">{t('tuClase')}</SectionTitle>
        <Suspense fallback={<CardSkeleton />}>
          <ClassroomRoster classroomId={classroomId} />
        </Suspense>
      </section>

      <Suspense fallback={<CardSkeleton />}>
        <Dashboard classroomId={classroomId} />
      </Suspense>
    </>
  );
}

/**
 * "¿Quién necesita ayuda y en qué?" — el dashboard del salón.
 *
 * Las dos piezas responden a las dos mitades de esa pregunta, y por eso están
 * las dos:
 *
 * - **Media y dispersión juntas.** Una media de 70 con todos en 70 y una media
 *   de 70 con la mitad en 100 y la mitad en 40 son dos clases distintas y piden
 *   dos cosas distintas. Mostrar solo la media las presenta como iguales, que es
 *   el error más común de un panel de aula.
 *
 * - **Las preguntas que más falla el salón.** Es el dato más accionable que
 *   existe para un docente: no le dice "tu clase va mal", le dice qué volver a
 *   explicar el lunes.
 */
async function Dashboard({ classroomId }: { classroomId: string }) {
  const vocab = await getTranslations();
  const t = await getTranslations('docente');
  // Espacio de SERVIDOR: sus textos contienen la palabra "correcta" y no deben
  // viajar en el catalogo serializado, donde harian chocar la comprobacion que
  // exige que la clave de correccion no aparezca en ningun sitio del HTML.
  const servidor = await getTranslations('docenteServidor');
  const format = await getFormatter();
  const { data, failed } = await fetchClassroomDashboard(classroomId);

  if (failed || !data) {
    return (
      // Antes este mensaje decia "puede que no sea uno de tus salones", y
      // mezclaba tres cosas distintas: que el salon no sea tuyo, que aun no haya
      // datos, y que la llamada fallara. Al docente le decia que quiza estaba
      // donde no debia cuando lo unico que pasaba era que la analitica no habia
      // respondido. Ahora habla solo de lo que si sabemos, y la lista de arriba
      // -que se pinta igual- ya le deja trabajar.
      <EmptyState
        title={t('cifrasNoDisponibles')}
        description={servidor('cifrasNoDisponiblesAyuda')}
      />
    );
  }

  if (data.studentsMeasured === 0) {
    return (
      <EmptyState
        title={t('sinResultadosSalon')}
        description={t('sinResultadosSalonAyuda')}
      />
    );
  }

  const level = scoreTone(vocab, data.averagePercentage);
  const spread = data.stddevPercentage;

  return (
    <section aria-labelledby="salon" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="salon">{t('resumen')}</SectionTitle>

      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t('notaMedia')}
          value={data.averagePercentage}
          unit="%"
          tone={level.tone}
          toneLabel={level.label}
          hint={t('notaMediaAyuda')}
        />

        {/*
          La dispersión con su lectura escrita al lado. Un número como "18,4"
          no le dice nada a nadie sin la frase que lo interpreta: el docente no
          necesita saber qué es una desviación típica, necesita saber si su clase
          va junta o partida en dos.
        */}
        <StatTile
          label={t('queTanParejo')}
          value={spread}
          unit={t('unidadPuntos')}
          tone={spread === null ? 'neutral' : spread > 20 ? 'warning' : 'good'}
          toneLabel={
            spread === null ? undefined : spread > 20 ? t('muyDesigual') : t('bastanteParejo')
          }
          hint={t('queTanParejoAyuda')}
        />

        <StatTile
          label={t('cuantoHaMejorado')}
          value={data.averageGain === null ? null : data.averageGain > 0 ? `+${data.averageGain}` : data.averageGain}
          unit={t('unidadPuntos')}
          hint={t('cuantoHaMejoradoAyuda')}
        />

        <StatTile
          label={t('alumnosConResultados')}
          value={data.studentsMeasured}
          hint={
            data.lastActivityAt
              ? t('ultimaActividadEl', { fecha: shortDate(format, data.lastActivityAt) })
              : t('sinActividadReciente')
          }
        />
      </div>

      <BarList
        title={t('loQueMasFalla')}
        unit="%"
        emptyMessage={t('loQueMasFallaVacio')}
        data={data.hardestQuestions.map((question, index) => ({
          // El enunciado, que es lo que convierte esta lista en algo accionable:
          // "Pregunta 3" no le dice a nadie qué volver a explicar.
          //
          // Llega por evento al directorio de la analítica. Si todavía no está
          // -una evaluación publicada antes de que ese directorio existiera- se
          // numera, que es honesto: inventar un título sería peor.
          label:
            question.prompt ??
            t('preguntaNumero', { numero: question.position ?? index + 1 }),
          value: Math.round(question.missRate),
          meta: t('falladasDe', { fallos: question.missed, respuestas: question.answered }),
          tone: question.missRate >= 60 ? 'critical' : question.missRate >= 40 ? 'warning' : 'neutral',
          toneLabel:
            question.missRate >= 60
              ? t('convieneRexplicar')
              : question.missRate >= 40
                ? t('mitadDeLaClaseFalla')
                : undefined,
        }))}
      />
    </section>
  );
}
