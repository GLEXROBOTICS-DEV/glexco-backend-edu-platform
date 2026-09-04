import { getTranslations } from 'next-intl/server';
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

/**
 * Los dos entornos oficiales donde se programa el robot.
 *
 * Son de UBTECH y son los mismos que se usan en clase: `ucode4` para bloques y
 * `py` para Python. Se enlazan y NO se incrustan en un `iframe`, por tres
 * razones que van en este orden:
 *
 * 1. Son aplicaciones que hablan con el robot por Bluetooth o por red local.
 *    Dentro de un iframe de otro dominio, el navegador les niega esos permisos
 *    y el alumno veria el editor cargado y el robot inalcanzable, que es peor
 *    que no tenerlo.
 * 2. Su sesion es suya. Incrustarlas dejaria las cookies de UBTECH en un
 *    contexto de terceros, que Safari y Firefox bloquean por defecto: el alumno
 *    entraria y perderia el acceso al recargar.
 * 3. No son nuestro contenido. Presentarlas dentro de nuestro marco sugiere que
 *    respondemos de ellas, y si UBTECH cambia el editor manana la pantalla se
 *    rompe por dentro sin que nada nos avise.
 *
 * El orden cambia con el portal -bloques primero en Discover, Python primero en
 * Academy-, pero **los dos aparecen en los dos**. Esconder Python en primaria
 * daria por sentado a que puede llegar un nino de doce anos, y esconder los
 * bloques en secundaria dejaria sin punto de entrada a quien empieza tarde.
 */
const ENVIRONMENTS = [
  {
    key: 'bloques',
    href: 'https://ucode4.ubtrobot.com/gl/',
    /** Los kits de bloques van con el nivel de Discover. */
    firstIn: 'discover' as const,
  },
  {
    key: 'python',
    href: 'https://py.ubtrobot.com/gl/#/',
    firstIn: 'academy' as const,
  },
];

/**
 * Banda de "programa tu robot".
 *
 * Va DENTRO de `RobotLab` y solo cuando el alumno tiene al menos un robot. Es la
 * misma regla que el resto de la pantalla: ofrecer un editor de robots a quien
 * no tiene ninguno es el escaparate que esta pantalla evita a proposito.
 */
async function ProgrammingEnvironments({ portal }: { portal: 'discover' | 'academy' }) {
  const t = await getTranslations('laboratorio');
  const comun = await getTranslations('comun');

  const ordered = [...ENVIRONMENTS].sort((a, b) =>
    a.firstIn === portal ? -1 : b.firstIn === portal ? 1 : 0,
  );

  return (
    <section
      aria-labelledby="programar"
      className="mb-[var(--portal-gap)] rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]"
      data-environments={ordered.length}
    >
      <h2 id="programar" className="font-display text-lg font-semibold">
        {t('programaTitulo')}
      </h2>
      <p className="mt-1 text-sm text-ink-500">{t('programaDescripcion')}</p>

      <ul className="mt-4 grid items-stretch gap-3 sm:grid-cols-2">
        {ordered.map((environment) => (
          <li key={environment.key} className="h-full">
            <a
              href={environment.href}
              target="_blank"
              rel="noreferrer noopener"
              data-environment={environment.key}
              className="flex h-full flex-col rounded-[calc(var(--portal-radius)*0.75)] border border-line-200 bg-surface-100 p-4 transition hover:border-brand-400 hover:bg-white"
            >
              <span className="flex items-center gap-2 font-medium text-ink-900">
                <span className="text-brand-600" aria-hidden="true">
                  <CodeIcon size={18} />
                </span>
                {t(environment.key + 'Titulo')}
                <span aria-hidden="true" className="ml-auto text-ink-400">
                  &#8599;
                </span>
              </span>
              <span className="mt-1.5 text-sm text-ink-500">
                {t(environment.key + 'Descripcion')}
              </span>
              {/* Sale del sitio, asi que se dice ANTES de pulsarlo, y en el
                  nombre accesible: un lector de pantalla no ve la flecha. */}
              <span className="sr-only">
                {t('abrir')} {comun('seAbreEnOtraPestana')}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Corchetes de codigo. Propio y no de una libreria: son doce lineas de SVG. */
function CodeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 6-5 6 5 6" />
      <path d="m16 6 5 6-5 6" />
    </svg>
  );
}

export async function RobotLab({ portal }: { portal: 'discover' | 'academy' }) {
  const vocab = await getTranslations();
  const t = await getTranslations('laboratorio');
  const { kits, failed } = await fetchMyKits();

  if (failed) {
    return (
      <EmptyState title={t('falloTitulo')} description={t('falloDescripcion')} />
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

  // Los entornos se muestran a quien tiene KIT, no a quien tiene una plataforma
  // fichada. Son dos condiciones distintas y la segunda depende de que el
  // catalogo tenga completo el campo `robotPlatforms`: un alumno con su kit
  // activado y ese campo vacio -que es el caso de la mitad de los kits
  // sembrados- se quedaba sin ver donde programar, teniendo el robot en la mesa.
  const environments = kits.length > 0 ? <ProgrammingEnvironments portal={portal} /> : null;

  if (byRobot.size === 0) {
    return (
      <>
        {environments}
        <EmptyState
          icon={<KitIcon size={32} />}
          title={t('sinRobotTitulo')}
          description={t('sinRobotDescripcion')}
          action={{ href: `/${portal}/activar`, label: vocab('sinKit.accion') }}
        />
      </>
    );
  }

  return (
    <>
      {/* Arriba, y no al final: el alumno entra al laboratorio a programar, y
          las fichas de robot le dicen con QUE. */}
      {environments}

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
                    {kit.name} · {gradeLabel(vocab, kit.grade)}
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
              {t('verContenido')}
            </a>
            {/* Sale del sitio, asi que se dice ANTES de pulsarlo. Un enlace que
                abre otra web sin avisar desconcierta, y mas a un nino. */}
            <a
              href={OFFICIAL_PAGES[platform as RobotPlatform] ?? CATALOGUE}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-secondary"
            >
              {t('fichaFabricante')}
              <span className="sr-only"> {vocab('comun.seAbreEnOtraPestana')}</span>
              <span aria-hidden="true">&#8599;</span>
            </a>
          </div>
        </li>
        ))}
      </ul>
    </>
  );
}
