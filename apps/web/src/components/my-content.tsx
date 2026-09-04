import { KitIcon, RobotIcon } from '@glexco/icons';
import { fetchMyKits, gradeLabel, type MyKit } from '../lib/catalog';
import { fetchLearningProgress, type CourseProgress } from '../lib/learning';
import { ProgressBar } from './continue-learning';
import { EmptyState, StatePill } from './ui';

/**
 * Mis kits / Mis cursos: el contenido activado, con su avance.
 *
 * Es la pantalla que faltaba detras de dos destinos de la barra que llevaban a
 * un 404 -"Mis kits" en Discover y "Cursos" en Academy-. Las dos ensenan lo
 * mismo porque el alumno tiene lo mismo; cambia el vocabulario, que es como
 * cambia en todo el producto: en primaria se compra un KIT, y en secundaria lo
 * que importa es el CURSO que va dentro.
 *
 * La portada ya ensena el kit, pero solo para entrar. Aqui esta el desglose por
 * curso con cuantas lecciones lleva de cuantas, que en la portada ocuparia toda
 * la pantalla y taparia lo que el alumno viene a hacer.
 */
export async function MyContent({ portal }: { portal: 'discover' | 'academy' }) {
  const [{ kits, failed }, progress] = await Promise.all([
    fetchMyKits(),
    fetchLearningProgress(),
  ]);

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tu contenido"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  if (kits.length === 0) {
    return (
      <EmptyState
        icon={<KitIcon size={32} />}
        title={
          portal === 'discover'
            ? 'Todavía no tienes ningún kit'
            : 'Aún no tienes contenido activado'
        }
        description="Activa el código que viene dentro de tu libro para desbloquear tu contenido."
        action={{ href: `/${portal}/activar`, label: 'Activar mi código' }}
      />
    );
  }

  // Los cursos se agrupan por kit para que cada uno aparezca bajo el suyo. Un
  // curso cuyo kit ya no esta activo no se pinta en ninguna parte: seria
  // ensenar contenido al que el alumno ya no tiene derecho.
  const byKit = new Map<string, CourseProgress[]>();
  for (const course of progress.data.courses) {
    byKit.set(course.kitId, [...(byKit.get(course.kitId) ?? []), course]);
  }

  return (
    <div className="grid gap-[var(--portal-gap)]">
      {kits.map((kit) => (
        <KitCard
          key={kit.kitId}
          kit={kit}
          courses={byKit.get(kit.kitId) ?? []}
          portal={portal}
          // Solo se avisa de que el progreso no cargo si de verdad fallo. Sin
          // esta distincion, un kit recien activado -que legitimamente no tiene
          // cursos todavia- se veria como un error del sistema.
          progressFailed={progress.failed}
        />
      ))}
    </div>
  );
}

function KitCard({
  kit,
  courses,
  portal,
  progressFailed,
}: {
  kit: MyKit;
  courses: readonly CourseProgress[];
  portal: 'discover' | 'academy';
  progressFailed: boolean;
}) {
  return (
    <article
      data-kit={kit.kitId}
      className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
    >
      <div className="flex flex-wrap items-start gap-4">
        <span
          className="grid size-14 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.75)] bg-brand-200/25 text-brand-600"
          aria-hidden="true"
        >
          <RobotIcon size={30} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-semibold">{kit.name}</h2>
          <p className="mt-0.5 text-sm text-ink-500">{gradeLabel(kit.grade)}</p>

          {kit.robotPlatforms.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {kit.robotPlatforms.map((platform) => (
                <li
                  key={platform}
                  className="rounded-full bg-state-warn-bg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-state-warn-fg"
                >
                  {platform}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <a href={`/${portal}/biblioteca?kit=${encodeURIComponent(kit.kitId)}`} className="btn btn-secondary">
          Ver la biblioteca
        </a>
      </div>

      {courses.length > 0 ? (
        <ul className="mt-5 grid gap-3 border-t border-line-200 pt-5">
          {courses.map((course) => (
            <CourseRow key={course.courseId} course={course} />
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-t border-line-200 pt-5 text-sm text-ink-500">
          {progressFailed
            ? 'No pudimos leer tu avance en este kit ahora mismo. El contenido sigue disponible.'
            : 'Todavía no has abierto ninguna lección de este kit. Empieza por la biblioteca.'}
        </p>
      )}
    </article>
  );
}

function CourseRow({ course }: { course: CourseProgress }) {
  const percent =
    course.lessonCount === 0
      ? 0
      : Math.round((course.lessonsCompleted / course.lessonCount) * 100);
  const done = course.lessonCount > 0 && course.lessonsCompleted >= course.lessonCount;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2" data-course={course.courseId}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{course.title}</span>
          {/* La etiqueta lleva su texto y no solo un color: el par verde/ambar
              es indistinguible con protanopia. */}
          <StatePill state={done ? 'done' : course.lessonsStarted > 0 ? 'doing' : 'idle'}>
            {done ? 'Completado' : course.lessonsStarted > 0 ? 'En progreso' : 'No iniciado'}
          </StatePill>
        </div>

        <ProgressBar
          percent={percent}
          label={`Avance de ${course.title}`}
          className="mt-2 max-w-md"
        />
      </div>

      {/* El par y no solo el porcentaje: "3 de 12" dice cuantas lecciones
          quedan, que es lo accionable; "25 %" hay que traducirlo mentalmente. */}
      <span className="shrink-0 text-sm tabular-nums text-ink-500">
        {course.lessonsCompleted} de {course.lessonCount} lecciones
      </span>
    </li>
  );
}
