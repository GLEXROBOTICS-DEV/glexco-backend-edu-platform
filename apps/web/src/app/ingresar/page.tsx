import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/session';
import { portalPath } from '../../lib/portal';
import { getTranslations } from 'next-intl/server';
import { BrandPanel } from '../../components/brand-panel';
import { LocaleSwitch } from '../../components/locale-switch';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Ingresar' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IngresarPage({ searchParams }: PageProps) {
  // Quien ya tiene sesion no ve el formulario: verlo invita a iniciar sesion
  // otra vez y crear una segunda sesion sin necesidad.
  const session = await getSession();
  if (session) redirect(portalPath(session.portal));

  // Se llega con esta marca cuando el alta salio bien pero el inicio de sesion
  // automatico no. Sin decirlo, el alumno cree que el registro fallo, lo
  // reintenta y choca con "ese correo ya esta registrado".
  const params = await searchParams;
  const justRegistered = params['registrado'] === '1';
  // Se llega asi tras cambiar la contrasena. NO se inicia sesion automatica: el
  // restablecimiento suele hacerse porque alguien pudo tomar la cuenta, y la
  // contrasena nueva es lo unico que demuestra quien es.
  const justReset = params['restablecida'] === '1';

  const t = await getTranslations('ingreso');

  return (
    <main id="contenido" className="flex min-h-dvh flex-col lg:flex-row">
      <BrandPanel headline={t('titularMarca')} description={t('descripcionMarca')} />

      <section className="flex flex-1 flex-col bg-surface-50 px-6 py-8">
        {/* El selector va arriba a la derecha, como en el canvas. Solo aparece
            sin sesion: con sesion manda el idioma del perfil, que es el mismo
            que usan los correos. */}
        <div className="flex justify-end">
          <LocaleSwitch />
        </div>

        <div className="mx-auto flex w-full max-w-[26.5rem] flex-1 flex-col justify-center py-8">
          {/* La marca tambien en movil, donde el panel no se ve: sin ella la
              primera pantalla de la plataforma no dice de quien es. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/glexco-marca.svg"
            data-brand-mark=""
            alt="GLEXCO"
            width={168}
            height={34}
            className="mb-8 block w-[10.5rem] lg:hidden"
          />

          <h1 className="font-display text-[1.875rem] font-semibold">{t('titulo')}</h1>
          <p className="mt-2 text-[15px] text-ink-500">{t('subtitulo')}</p>

          {justReset ? (
            <p
              role="status"
              data-reset="1"
              className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
            >
              {t('yaCambiada')}
            </p>
          ) : null}

          {justRegistered ? (
            <p
              role="status"
              data-registered="1"
              className="mt-4 rounded-lg border border-success/25 bg-success/5 px-4 py-3 text-sm text-ink-700"
            >
              {t('yaCreada')}
            </p>
          ) : null}

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
