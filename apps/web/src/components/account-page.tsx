import { Suspense } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { requireSession } from '../lib/session';
import { fetchSessions } from '../lib/profile';
import { PageHeader } from './page-header';
import { LanguageChoice, PasswordForm, SessionList } from './account';
import { ThemeToggle } from './theme-toggle';
import { logout } from '../lib/auth.actions';

/**
 * "Mi cuenta", compartida por los cuatro portales.
 *
 * Es la misma pantalla para un alumno de ocho anos y para el equipo de GLEXCO
 * porque hace lo mismo. Duplicarla por portal solo garantizaria que una de las
 * copias se quedara sin el siguiente arreglo.
 *
 * **Estructurada en tarjetas y a dos columnas.** Antes era una columna de
 * formularios sueltos sobre el fondo, con el titulo de cada bloque al mismo
 * peso que las etiquetas de los campos: no se distinguia donde acababa una cosa
 * y empezaba la otra, y la lista de sesiones -que puede tener quince filas-
 * empujaba todo lo demas fuera de la pantalla.
 *
 * Lo que se hace UNA vez -idioma, contrasena- va a la izquierda y en tarjetas
 * pequenas; lo que se CONSULTA -las sesiones- ocupa su propia columna, que es la
 * que crece.
 */
export async function AccountPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const t = await getTranslations('cuenta');

  return (
    <>
      <PageHeader
        title={t('titulo')}
        subtitle={`${session.firstName} ${session.lastName} · ${session.email}`.trim()}
      />

      <div className="grid gap-[var(--portal-gap)] lg:grid-cols-5 lg:items-start">
        <div className="grid gap-[var(--portal-gap)] lg:col-span-2">
          <Panel title={t('idioma')} hint={t('idiomaPista')}>
            <LanguageChoice current={locale === 'en' ? 'en' : 'es'} />
          </Panel>

          {/* El tema va con el idioma: son las dos cosas que cambian COMO se
              ve la plataforma, y estaban en la barra lateral compitiendo con los
              destinos de la navegacion. */}
          <Panel title={t('tema')} hint={t('temaPista')}>
            <ThemeToggle />
          </Panel>

          <Panel title={t('contrasena')} hint={t('contrasenaPista')}>
            <PasswordForm />
          </Panel>
        </div>

        <div className="lg:col-span-3">
          <Panel title={t('sesiones')} hint={t('sesionesPista')}>
            <Suspense
              fallback={<p className="text-sm text-ink-500">{t('cargandoSesiones')}</p>}
            >
              <Sessions />
            </Suspense>
          </Panel>

          {/* Salir, al final y en su propia tarjeta.

              Debajo de las sesiones a proposito: quien viene a cerrar sesion
              suele venir porque vio un dispositivo que no reconoce, y ese
              listado esta justo encima. Estaba en la barra lateral, donde se
              pulsa por error al buscar el perfil. */}
          <Panel title={t('salir')} hint={t('salirPista')}>
            <form action={logout}>
              <button type="submit" className="btn btn-secondary">
                {t('salir')}
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Una tarjeta de la pantalla.
 *
 * El titulo va DENTRO de la tarjeta y no flotando encima: sobre el fondo, un
 * titulo de seccion y la etiqueta de un campo pesan casi lo mismo y no se ve
 * donde empieza cada bloque. La pista va bajo el titulo y no al lado del campo,
 * porque explica el bloque entero.
 */
function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--portal-radius)] border border-line-200 bg-white p-[var(--portal-card-padding)]">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-ink-500">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

async function Sessions() {
  const { items, failed } = await fetchSessions();
  const t = await getTranslations('cuenta');

  if (failed) {
    return <p className="text-sm text-ink-500">{t('sesionesFallo')}</p>;
  }

  return <SessionList sessions={items} />;
}
