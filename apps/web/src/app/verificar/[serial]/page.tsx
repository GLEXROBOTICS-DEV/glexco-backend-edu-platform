import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { verifyCertificate } from '../../../lib/certificates';

export const metadata: Metadata = {
  title: 'Verificar certificado',
  // Esta SÍ se indexa, al revés que el resto del portal: es una página pública
  // pensada para que alguien de fuera llegue a ella, y esconderla de los
  // buscadores solo dificultaría comprobar un documento auténtico.
  robots: { index: true, follow: true },
};

/**
 * Verificación pública de un certificado.
 *
 * **Sin sesión, a propósito.** Quien recibe un certificado —una universidad, una
 * empresa, otro colegio— no tiene cuenta aquí, y exigirle una convierte la
 * verificación en algo que nadie hace: el documento pasaría a valer lo que valga
 * la palabra de quien lo enseña.
 *
 * Solo se muestra lo que **ya está impreso en el papel** que esa persona tiene
 * delante: nombre, curso, colegio y fecha. Nada más del alumno. Si mostrara su
 * identificador, su correo o su progreso, esta ruta sería una fuga de datos de
 * menores a la que se llega probando series.
 */
export default async function VerificarCertificado({
  params,
}: {
  params: Promise<{ serial: string }>;
}) {
  const { serial } = await params;
  const t = await getTranslations('certificado');
  const result = await verifyCertificate(serial);

  return (
    <main id="contenido" className="mx-auto grid min-h-dvh max-w-xl content-center px-6 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/glexco-marca.svg"
        data-brand-mark=""
        alt="GLEXCO"
        width={150}
        height={30}
        className="mb-8 block w-[9.375rem]"
      />

      {result === null ? (
        <Card tone="neutral" title={t('noPudimosComprobarlo')}>
          <p className="text-sm text-ink-500">{t('noPudimosComprobarloAyuda')}</p>
        </Card>
      ) : result.valid && result.certificate ? (
        <Card tone="good" title={t('certificadoAutentico')}>
          <dl className="grid gap-3 text-sm">
            <Field label={t('otorgadoA')} value={result.certificate.studentName} />
            <Field label={t('porCompletar')} value={result.certificate.courseTitle} />
            {result.certificate.institutionName ? (
              <Field label={t('en')} value={result.certificate.institutionName} />
            ) : null}
            <Field label={t('fechaDeEmision')} value={formatDate(result.certificate.issuedAt)} />
            <Field label={t('serie')} value={result.certificate.serial} mono />
          </dl>

          {/* Se explica QUÉ se ha comprobado. "Válido" a secas no dice si alguien
              miró una base de datos o verificó una firma, y son cosas muy
              distintas para quien tiene que fiarse. */}
          <p className="mt-5 border-t border-line-200 pt-4 text-xs leading-relaxed text-ink-500">
            {t('queSeHaComprobado', { huella: result.certificate.keyFingerprint })}
          </p>
        </Card>
      ) : result.reason === 'revoked' && result.certificate ? (
        <Card tone="warn" title={t('fueAnulado')}>
          <p className="text-sm text-ink-500">{t('fueAnuladoAyuda')}</p>
          <dl className="mt-4 grid gap-3 text-sm">
            <Field label={t('otorgadoA')} value={result.certificate.studentName} />
            <Field label={t('porCompletar')} value={result.certificate.courseTitle} />
            <Field label={t('serie')} value={result.certificate.serial} mono />
          </dl>
        </Card>
      ) : result.reason === 'tampered' ? (
        // Se distingue de "no existe" y NO se dice qué cambió: decirlo sería
        // enseñarle al falsificador exactamente qué le falta por ajustar.
        <Card tone="bad" title={t('haSidoAlterado')}>
          <p className="text-sm text-ink-500">{t('haSidoAlteradoAyuda')}</p>
        </Card>
      ) : (
        <Card tone="bad" title={t('noLoEncontramos')}>
          <p className="text-sm text-ink-500">{t('noLoEncontramosAyuda', { serie: serial })}</p>
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-ink-400">{t('pieDeMarca')}</p>
    </main>
  );
}

function Card({
  tone,
  title,
  children,
}: {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  title: string;
  children: React.ReactNode;
}) {
  const stripe = {
    good: 'bg-success',
    warn: 'bg-achievement',
    bad: 'bg-danger',
    neutral: 'bg-line-300',
  }[tone];

  return (
    <section className="overflow-hidden rounded-[var(--portal-radius)] border border-line-200 bg-white">
      {/* La franja de color NUNCA va sola: el titulo dice lo mismo en palabras.
          Verde y ambar quedan indistinguibles con protanopia. */}
      <div className={`h-1.5 ${stripe}`} aria-hidden="true" />
      <div className="p-6">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-3">
      <dt className="w-32 shrink-0 text-ink-500">{label}</dt>
      <dd className={`min-w-0 flex-1 font-medium text-ink-900 ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima',
  }).format(date);
}
