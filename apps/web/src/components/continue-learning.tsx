import { getTranslations } from 'next-intl/server';
import { RobotIcon } from '@glexco/icons';
import { fetchLearningProgress, type CourseProgress } from '../lib/learning';
import { HeroFigure } from './portal-hero';

/**
 * Nombre del nivel, traducido en el PORTAL y no en el servicio.
 *
 * El servicio de aprendizaje devuelve "Explorador" o "Maestro Robotico" porque
 * son vocabulario del dominio, y el dominio no tiene idioma de usuario: un
 * evento vive dias en el stream y no sabe quien lo va a leer. Traducirlo alli
 * obligaria a que cada evento y cada respuesta cargaran con el locale de quien
 * pregunta.
 *
 * Se traduce por NUMERO de nivel, que es lo estable. El nombre que llega de la
 * API queda como respaldo: si algun dia hay un sexto nivel, la pantalla dice
 * "Maestro Robotico" en espanol antes que una clave sin traducir.
 */
function levelNameOf(t: (key: string) => string, level: number, fallback: string): string {
  if (level < 1 || level > 5) return fallback;
  return t('niveles.' + level);
}

/**
 * Las tres cifras de la cabecera.
 *
 * Comparten peticion con la tarjeta de "continuar" gracias al `cache()` de
 * `fetchLearningProgress`, asi que tenerlas en dos componentes no cuesta dos
 * llamadas.
 */
export async function HeroLearningFigures({ portal }: { portal: 'discover' | 'academy' }) {
  const { data } = await fetchLearningProgress();
  const t = await getTranslations('portada');

  return (
    <>
      <HeroFigure value={data.courses.length} label={t('cifraCursos')} />
      {/* Discover dice "insignias" y Academy "logros": es la misma cifra, lo que
          cambia con la edad es el registro y no el dato. */}
      <HeroFigure
        value={data.badges.length}
        label={portal === 'discover' ? t('cifraInsignias') : t('cifraLogros')}
      />
      <HeroFigure value={data.totalXp} label={t('cifraPuntos')} accent />
    </>
  );
}

/**
 * Subtitulo de la banda de bienvenida.
 *
 * El canvas dice "Continua tu aventura en <curso>", con el nombre del curso
 * destacado. Nombrarlo importa: el alumno reconoce donde se quedo antes de leer
 * ninguna tarjeta, y es lo que convierte un saludo generico en un punto de
 * retorno.
 */
export async function HeroSubtitle({
  portal = 'discover',
}: {
  portal?: 'discover' | 'academy';
}) {
  const { data, failed } = await fetchLearningProgress();
  const t = await getTranslations('portada');
  const course = failed ? null : pickCourse(data.courses);

  // "Aventura" en Discover y "formacion" en Academy: la palabra que engancha a
  // un nino de nueve anos es la que hace que un universitario cierre la pestana.
  const clave = portal === 'academy' ? 'retoma' : 'aventura';

  if (!course) return <>{t(clave + 'Generica')}</>;

  // `t.rich` y no partir la frase en tres trozos para meter el `<strong>` en
  // medio: partirla obliga al traductor a mantener el orden del espanol, y en
  // ingles el nombre del curso no cae donde cae aqui.
  return (
    <>
      {t.rich(clave + 'EnCurso', {
        curso: () => (
          <strong className="font-semibold text-[var(--portal-accent)]">{course.title}</strong>
        ),
      })}
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

  const t = await getTranslations('portada');
  // Sin espacio: los nombres de nivel viven en su propia seccion.
  const tn = await getTranslations();

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
        {t('continuaDondeLoDejaste')}
      </h2>

      {course ? (
        <article className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h3 className="eyebrow">{t('continuarAprendiendo')}</h3>
            <a
              href={portal === 'academy' ? '/academy/cursos' : '/discover/kits'}
              className="text-sm font-medium text-brand-600 hover:text-brand-400"
            >
              {portal === 'academy' ? t('verTodosLosCursos') : t('verTodosMisKits')}
            </a>
          </div>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span
              className="grid size-[6.75rem] shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.875)] bg-brand-200/25 text-brand-600"
              aria-hidden="true"
            >
              <RobotIcon size={56} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-xs text-ink-400">
                {t('leccionDe', {
                  actual: course.lessonsCompleted + 1,
                  total: course.lessonCount,
                })}
              </p>
              <p className="font-display text-xl font-semibold">{course.title}</p>

              <ProgressBar
                percent={percentOf(course)}
                label={t('avanceDe', { curso: course.title })}
                className="mt-3"
              />
              <p className="mt-1.5 text-xs text-ink-500">
                {t('porcentajeCompletado', { porcentaje: percentOf(course) })}
              </p>
            </div>

            <a
              href={`/${portal}/biblioteca?kit=${encodeURIComponent(course.kitId)}`}
              className="btn btn-primary shrink-0"
            >
              {t('continuar')}
            </a>
          </div>
        </article>
      ) : null}

      <article
        className={`rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)] ${
          course ? '' : 'lg:col-span-3'
        }`}
      >
        <p className="eyebrow mb-4">{t('tuNivel')}</p>

        <div className="flex items-center gap-3.5">
          <LevelRing level={data.explorerLevel} percent={toNext} />
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold">
              {levelNameOf(tn, data.explorerLevel, data.levelName)}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {data.xpToNext === null
                ? t('puntosAcumulados', { puntos: data.totalXp })
                : t('ptsParaSiguiente', {
                    puntos: data.xpToNext,
                    nivel: levelNameOf(tn, data.explorerLevel + 1, data.nextLevelName ?? ''),
                  })}
            </p>
          </div>
        </div>

        {/* Los cinco tramos del canvas: uno por nivel de la escalera. Dicen de
            un vistazo cuantos quedan por delante, que es lo que el anillo solo
            -que mide el tramo actual- no puede decir. */}
        <p className="mt-4 flex gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((step) => (
            <span
              key={step}
              className={`h-1.5 flex-1 rounded-full ${
                step <= data.explorerLevel ? 'bg-[var(--portal-accent)]' : 'bg-surface-200'
              }`}
            />
          ))}
        </p>
        <p className="sr-only">
          {t('nivelDeCinco', { nivel: data.explorerLevel, insignias: data.badges.length })}
        </p>
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
        <circle cx="31" cy="31" r="26" fill="none" stroke="var(--color-surface-200)" strokeWidth="7" />
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
