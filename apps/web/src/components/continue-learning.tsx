import { RobotIcon } from '@glexco/icons';
import { fetchLearningProgress, type CourseProgress } from '../lib/learning';
import { HeroFigure } from './portal-hero';

/**
 * Las tres cifras de la cabecera.
 *
 * Comparten peticion con la tarjeta de "continuar" gracias al `cache()` de
 * `fetchLearningProgress`, asi que tenerlas en dos componentes no cuesta dos
 * llamadas.
 */
export async function HeroLearningFigures({ portal }: { portal: 'discover' | 'academy' }) {
  const { data } = await fetchLearningProgress();

  return (
    <>
      <HeroFigure value={data.courses.length} label={portal === 'discover' ? 'cursos' : 'cursos'} />
      <HeroFigure
        value={data.badges.length}
        label={portal === 'discover' ? 'insignias' : 'logros'}
      />
      <HeroFigure value={data.totalXp} label="puntos" accent />
    </>
  );
}

/**
 * "Continuar aprendiendo" y "Tu nivel".
 *
 * La tarjeta de continuar ocupa dos tercios del ancho porque es lo que el alumno
 * viene a hacer nueve de cada diez veces: entrar y seguir donde lo dejo. Darle
 * el mismo peso que a las demas obliga a buscarla, y buscarla en cada sesion es
 * un coste que se paga entero en los primeros treinta segundos.
 *
 * Si no hay ningun curso empezado no se pinta nada: una tarjeta "continuar" sin
 * nada que continuar promete algo que no existe.
 */
export async function ContinueLearning({ portal }: { portal: 'discover' | 'academy' }) {
  const { data, failed } = await fetchLearningProgress();
  if (failed) return null;

  const course = pickCourse(data.courses);
  const toNext =
    data.xpToNext === null ? 100 : Math.round((data.totalXp / (data.totalXp + data.xpToNext)) * 100);

  return (
    <section
      aria-labelledby="continuar"
      className="grid gap-[var(--portal-gap)] lg:grid-cols-3"
      data-continue={course ? course.courseId : 'ninguno'}
    >
      <h2 id="continuar" className="sr-only">
        Continúa donde lo dejaste
      </h2>

      {course ? (
        <article className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] lg:col-span-2">
          <p className="eyebrow mb-4">Continuar aprendiendo</p>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span
              className="grid size-[6.75rem] shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.875)] bg-brand-200/25 text-brand-600"
              aria-hidden="true"
            >
              <RobotIcon size={56} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-xs text-ink-400">
                Lección {course.lessonsCompleted + 1} de {course.lessonCount}
              </p>
              <h3 className="font-display text-xl font-semibold">{course.title}</h3>

              <ProgressBar
                percent={percentOf(course)}
                label={`Avance de ${course.title}`}
                className="mt-3"
              />
              <p className="mt-1.5 text-xs text-ink-500">{percentOf(course)} % completado</p>
            </div>

            <a
              href={`/${portal}/biblioteca?kit=${encodeURIComponent(course.kitId)}`}
              className="inline-flex h-[2.875rem] shrink-0 items-center rounded-[var(--nav-radius)] bg-brand-600 px-6 font-display text-[15px] font-medium text-white transition hover:bg-brand-700"
            >
              Continuar
            </a>
          </div>
        </article>
      ) : null}

      <article
        className={`rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] ${
          course ? '' : 'lg:col-span-3'
        }`}
      >
        <p className="eyebrow mb-4">Tu nivel</p>

        <div className="flex items-center gap-3.5">
          <LevelRing level={data.explorerLevel} percent={toNext} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">{data.levelName}</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {data.xpToNext === null
                ? `${data.totalXp} puntos acumulados`
                : `${data.xpToNext} pts para ${data.nextLevelName}`}
            </p>
          </div>
        </div>

        {/* Las insignias van como puntos y no como iconos: aqui solo importa
            CUANTAS hay; el detalle vive en "Mi progreso" y duplicarlo obliga a
            mantener dos veces la misma lista. */}
        {data.badges.length > 0 ? (
          <p className="mt-4 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
            <span className="sr-only">{data.badges.length} insignias conseguidas</span>
            {data.badges.slice(0, 8).map((badge) => (
              <span
                key={badge.code}
                title={badge.name}
                className="size-2.5 rounded-full bg-[var(--portal-accent)]"
                aria-hidden="true"
              />
            ))}
          </p>
        ) : null}
      </article>
    </section>
  );
}

/** Barra de avance. Lleva siempre su cifra al lado: el color no es un dato. */
export function ProgressBar({
  percent,
  label,
  className = '',
}: {
  percent: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`h-2.5 w-full overflow-hidden rounded-full bg-surface-200 ${className}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-[var(--portal-accent)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * Anillo de nivel.
 *
 * El numero va dentro del anillo y no debajo: el anillo por si solo dice
 * "cuanto llevas" pero no "de que", y son dos preguntas distintas que el alumno
 * hace a la vez.
 */
function LevelRing({ level, percent }: { level: number; percent: number }) {
  // Circunferencia de r=26. Se calcula aqui y no se escribe a mano para que
  // cambiar el radio no deje el arco descuadrado en silencio.
  const circumference = 2 * Math.PI * 26;

  return (
    <span className="relative grid size-[3.875rem] shrink-0 place-items-center">
      <svg width="62" height="62" viewBox="0 0 62 62" aria-hidden="true" className="absolute">
        <circle cx="31" cy="31" r="26" fill="none" stroke="#EDF1F5" strokeWidth="7" />
        <circle
          cx="31"
          cy="31"
          r="26"
          fill="none"
          stroke="var(--portal-accent)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(Math.max(percent, 0), 100) / 100)}
          transform="rotate(-90 31 31)"
        />
      </svg>
      <span className="relative font-display text-xl font-semibold">{level}</span>
    </span>
  );
}

function percentOf(course: CourseProgress): number {
  if (course.lessonCount === 0) return 0;
  return Math.round((course.lessonsCompleted / course.lessonCount) * 100);
}

/**
 * Cual es "el curso a continuar".
 *
 * El mas reciente de los que estan a medias. Se descartan los terminados: darle
 * a "Continuar" un curso ya completo lleva a una pantalla donde no queda nada
 * que hacer, y el alumno concluye que el boton no funciona.
 */
function pickCourse(courses: readonly CourseProgress[]): CourseProgress | null {
  const open = courses.filter((c) => c.lessonsCompleted < c.lessonCount);
  if (open.length === 0) return null;

  return [...open].sort((a, b) => {
    // Sin actividad va al final: es un curso que existe pero que el alumno
    // todavia no ha tocado, y "continuar" algo que no se ha empezado suena raro.
    const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0;
    const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0;
    return bt - at;
  })[0]!;
}
