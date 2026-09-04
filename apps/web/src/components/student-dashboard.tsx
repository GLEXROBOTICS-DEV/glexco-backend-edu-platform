import { BadgeIcon, LevelIcon } from '@glexco/icons';
import {
  fetchMyDashboard,
  scoreTone,
  shortDate,
} from '../lib/analytics';
import { BarList, DonutChart, StatTile, TimelineChart } from './charts';
import { EmptyState, SectionTitle } from './ui';

/**
 * "¿Voy bien?" — el dashboard del alumno.
 *
 * Es el mismo componente para Discover y Academy: los datos son los mismos y la
 * densidad la hereda del layout. Lo que NO lleva, y es deliberado, es la
 * posición del alumno frente a sus compañeros. La propuesta ya lo fija para el
 * ranking y aquí vale igual: *el ranking celebra logros, no señala rezagos*. A
 * un niño de ocho años, "eres el 24 de 30" no le enseña nada.
 *
 * Las medias de GLEXCO y del docente van SEPARADAS. Promediarlas juntas haría
 * que la nota de un alumno suba porque su profesor puso un examen fácil, y eso
 * convierte el número en algo que no significa nada.
 */
export async function StudentDashboard({ portal }: { portal: 'discover' | 'academy' }) {
  const { data, failed } = await fetchMyDashboard();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tu progreso"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  if (data.assessmentsTaken === 0) {
    return (
      <EmptyState
        icon={<LevelIcon size={32} />}
        title={portal === 'discover' ? 'Aún no has hecho ninguna actividad' : 'Aún no tienes evaluaciones'}
        description={
          portal === 'discover'
            ? 'Cuando completes tu primera actividad verás aquí cómo vas avanzando.'
            : 'Cuando entregues tu primera evaluación aparecerá aquí tu progreso.'
        }
      />
    );
  }

  const glexco = scoreTone(data.averageGlexco);
  const institution = scoreTone(data.averageInstitution);
  const pass = scoreTone(data.passRate);
  const gain = data.averageGain;

  return (
    <section aria-labelledby="mi-progreso" className="grid gap-[var(--portal-gap)]">
      <SectionTitle id="mi-progreso">
        {portal === 'discover' ? '¿Cómo voy?' : 'Mi progreso'}
      </SectionTitle>

      {/*
        Anillos y no tarjetas de numero para las tres cifras que son un
        PORCENTAJE sobre cien: el arco dice de un golpe si va por la mitad o por
        el final, y la cifra del centro sigue estando para citarla. La mejora se
        queda como numero porque no es una proporcion -es un salto en puntos- y
        dibujar "+18" como un anillo obligaria a inventar un maximo.
      */}
      <div className="grid gap-[var(--portal-gap)] sm:grid-cols-2 lg:grid-cols-4">
        <DonutChart
          value={data.averageGlexco}
          label="Nota media GLEXCO"
          caption="Las evaluaciones que vienen con tu kit"
          tone={glexco.tone}
          toneLabel={glexco.label}
        />

        <DonutChart
          value={data.averageInstitution}
          label="Nota media de tu docente"
          caption="Las que preparó tu profesor"
          tone={institution.tone}
          toneLabel={institution.label}
        />

        {/*
          El progreso va con su propia tarjeta y su propia explicación porque es
          el número que la gente interpreta mal: no es la nota, es cuánto subió
          desde su primer intento. Un alumno que empieza en 40 y llega a 60
          aprendió más que uno que se quedó en 80.
        */}
        <StatTile
          label="Cuánto has mejorado"
          value={gain === null ? null : gain > 0 ? `+${gain}` : gain}
          unit="pts"
          tone={gain === null ? 'neutral' : gain > 0 ? 'good' : 'neutral'}
          toneLabel={gain !== null && gain > 0 ? 'Vas mejorando' : undefined}
          hint="Desde tu primer intento"
        />

        <DonutChart
          value={data.passRate}
          label="Evaluaciones aprobadas"
          caption={`${data.assessmentsTaken} en total`}
          tone={pass.tone}
          toneLabel={pass.label}
        />
      </div>

      <TimelineChart
        title="Tus resultados, en orden"
        passingScore={60}
        points={data.timeline.map((entry) => ({
          label: `${entry.origin === 'glexco' ? 'GLEXCO' : 'Tu docente'} · ${shortDate(entry.gradedAt)}`,
          value: Math.round(entry.percentage),
          passed: entry.passed,
        }))}
      />

      {portal === 'discover' ? (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <BadgeIcon size={18} />
          Sigue así: cada actividad que terminas suma a tu nivel de Explorador.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Lo que más le cuesta al alumno.
 *
 * Se separa del bloque anterior porque responde otra pregunta: el de arriba es
 * "¿voy bien?" y este es "¿en qué tengo que insistir?". Mezclarlos en una sola
 * pantalla de números hace que ninguna de las dos se lea.
 */
export function StudentWeakSpots({
  items,
}: {
  items: { label: string; missRate: number; answered: number }[];
}) {
  return (
    <BarList
      title="Lo que más te cuesta"
      unit="%"
      emptyMessage="Todavía no hay suficientes respuestas para decirte esto."
      data={items.map((item) => ({
        label: item.label,
        value: item.missRate,
        meta: `${item.answered} intentos`,
        // Aqui la escala va AL REVES que en una nota: un 80 % de fallo es lo
        // peor, no lo mejor. Invertirla es justo el motivo por el que el color
        // no puede salir automatico del numero.
        tone: missTone(item.missRate),
        toneLabel: missLabel(item.missRate),
      }))}
    />
  );
}

/**
 * Estado de una tasa de FALLO.
 *
 * No se puede reutilizar `scoreTone`: alli un numero alto es bueno y aqui es
 * malo. Tenerlo aparte evita el error clasico de pintar de verde la pregunta
 * que mas se falla.
 */
function missTone(missRate: number): 'good' | 'warning' | 'critical' {
  if (missRate >= 60) return 'critical';
  if (missRate >= 35) return 'warning';
  return 'good';
}

function missLabel(missRate: number): string {
  if (missRate >= 60) return 'Repásalo con tu docente';
  if (missRate >= 35) return 'Conviene repasarlo';
  return 'Lo llevas bien';
}
