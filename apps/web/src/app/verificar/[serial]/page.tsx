import type { Metadata } from 'next';
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
        <Card tone="neutral" title="No pudimos comprobarlo ahora mismo">
          <p className="text-sm text-ink-500">
            Vuelve a intentarlo en unos minutos. Que no podamos comprobarlo ahora no significa que
            el certificado no sea válido.
          </p>
        </Card>
      ) : result.valid && result.certificate ? (
        <Card tone="good" title="Certificado auténtico">
          <dl className="grid gap-3 text-sm">
            <Field label="Otorgado a" value={result.certificate.studentName} />
            <Field label="Por completar" value={result.certificate.courseTitle} />
            {result.certificate.institutionName ? (
              <Field label="En" value={result.certificate.institutionName} />
            ) : null}
            <Field label="Fecha de emisión" value={formatDate(result.certificate.issuedAt)} />
            <Field label="Serie" value={result.certificate.serial} mono />
          </dl>

          {/* Se explica QUÉ se ha comprobado. "Válido" a secas no dice si alguien
              miró una base de datos o verificó una firma, y son cosas muy
              distintas para quien tiene que fiarse. */}
          <p className="mt-5 border-t border-line-200 pt-4 text-xs leading-relaxed text-ink-500">
            Hemos comprobado la firma digital del documento, no solo que exista en nuestros
            registros: si alguien hubiera cambiado un nombre o una fecha, esta página lo diría.
            Firmado con la clave <span className="font-mono">{result.certificate.keyFingerprint}</span>,
            que puedes descargar para comprobarlo por tu cuenta.
          </p>
        </Card>
      ) : result.reason === 'revoked' && result.certificate ? (
        <Card tone="warn" title="Este certificado fue anulado">
          <p className="text-sm text-ink-500">
            Existió y lo emitimos nosotros, pero el colegio lo anuló después. Si necesitas saber por
            qué, pregúntale a quien te lo entregó.
          </p>
          <dl className="mt-4 grid gap-3 text-sm">
            <Field label="Otorgado a" value={result.certificate.studentName} />
            <Field label="Por completar" value={result.certificate.courseTitle} />
            <Field label="Serie" value={result.certificate.serial} mono />
          </dl>
        </Card>
      ) : result.reason === 'tampered' ? (
        // Se distingue de "no existe" y NO se dice qué cambió: decirlo sería
        // enseñarle al falsificador exactamente qué le falta por ajustar.
        <Card tone="bad" title="Este documento ha sido alterado">
          <p className="text-sm text-ink-500">
            La serie existe en nuestros registros, pero los datos no coinciden con lo que firmamos.
            No lo aceptes.
          </p>
        </Card>
      ) : (
        <Card tone="bad" title="No encontramos este certificado">
          <p className="text-sm text-ink-500">
            No hemos emitido ningún certificado con la serie{' '}
            <span className="font-mono">{serial}</span>. Comprueba que la hayas copiado bien: se
            escribe en cuatro bloques separados por guiones.
          </p>
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-ink-400">
        GLEXCO · Robótica educativa
      </p>
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
