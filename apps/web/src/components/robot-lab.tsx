import { robotLabel, type RobotPlatform } from '@glexco/contracts';
import { KitIcon, RobotIcon } from '@glexco/icons';
import { fetchMyKits, gradeLabel } from '../lib/catalog';
import { EmptyState } from './ui';

/**
 * Laboratorio de robots.
 *
 * Los robots a los que el alumno tiene acceso, agrupados por robot y no por kit:
 * un mismo robot puede aparecer en varios grados, y lo que el alumno tiene
 * delante es UN robot, no tres libros.
 *
 * **Solo salen los suyos.** No es un escaparate del catalogo de UBTECH: ensenar
 * los doce robots a un nino que tiene uno convierte la pantalla en una lista de
 * cosas que no puede tocar.
 *
 * Cada ficha enlaza a la pagina oficial del fabricante. Es informacion real y
 * mantenida por quien fabrica el robot; escribir aqui una descripcion propia
 * seria inventar contenido pedagogico que nadie ha revisado, y ademas quedaria
 * desactualizada en la primera revision de producto.
 */

/**
 * Pagina oficial de cada robot.
 *
 * Comprobadas contra el sitio de UBTECH. Solo estan las que existen: las que
 * faltan caen al indice de educacion, que es preferible a un 404 con el nombre
 * del robot en la URL.
 */
const OFFICIAL_PAGES: Partial<Record<RobotPlatform, string>> = {
  ukit_ai: 'https://www.ubtrobot.com/en/ai-education/products/ukit-ai',
  ukit_explore: 'https://www.ubtrobot.com/en/ai-education/products/ukit-explore',
  ugot: 'https://www.ubtrobot.com/en/ai-education/products/ugot',
  yanshee: 'https://www.ubtrobot.com/en/ai-education/products/yanshee',
};

const CATALOGUE = 'https://www.ubtrobot.com/en/ai-education';

export async function RobotLab({ portal }: { portal: 'discover' | 'academy' }) {
  const { kits, failed } = await fetchMyKits();

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus robots"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  // Agrupado por robot: la clave es el robot y el valor, los kits donde sale.
  const byRobot = new Map<string, { kitId: string; name: string; grade: string }[]>();
  for (const kit of kits) {
    for (const platform of kit.robotPlatforms) {
      byRobot.set(platform, [
        ...(byRobot.get(platform) ?? []),
        { kitId: kit.kitId, name: kit.name, grade: kit.grade },
      ]);
    }
  }

  if (byRobot.size === 0) {
    return (
      <EmptyState
        icon={<KitIcon size={32} />}
        title="Todavía no tienes ningún robot"
        description="Activa el código que viene dentro de tu libro y aquí aparecerá el robot de tu kit."
        action={{ href: `/${portal}/activar`, label: 'Activar mi código' }}
      />
    );
  }

  return (
    <ul className="grid gap-[var(--portal-gap)] sm:grid-cols-2">
      {[...byRobot.entries()].map(([platform, usedIn]) => (
        <li
          key={platform}
          data-robot={platform}
          className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
        >
          <div className="flex items-start gap-4">
            <span
              className="grid size-14 shrink-0 place-items-center rounded-[calc(var(--portal-radius)*0.75)] bg-brand-200/25 text-brand-600"
              aria-hidden="true"
            >
              <RobotIcon size={30} />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold">{robotLabel(platform)}</h2>

              <ul className="mt-2 grid gap-1">
                {usedIn.map((kit) => (
                  <li key={kit.kitId} className="text-sm text-ink-500">
                    {kit.name} · {gradeLabel(kit.grade)}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/${portal}/biblioteca?kit=${encodeURIComponent(usedIn[0]!.kitId)}`}
              className="btn btn-primary"
            >
              Ver su contenido
            </a>
            {/* Sale del sitio, asi que se dice ANTES de pulsarlo. Un enlace que
                abre otra web sin avisar desconcierta, y mas a un nino. */}
            <a
              href={OFFICIAL_PAGES[platform as RobotPlatform] ?? CATALOGUE}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-secondary"
            >
              Ficha del fabricante
              <span className="sr-only"> (se abre en otra pestaña)</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
