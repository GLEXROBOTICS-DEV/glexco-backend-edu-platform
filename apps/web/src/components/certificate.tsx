import QRCode from 'qrcode';
import { CertificateIcon } from '@glexco/icons';
import { fetchMyCertificates, type MyCertificate } from '../lib/certificates';
import { EmptyState } from './ui';

/**
 * El QR, generado en el SERVIDOR.
 *
 * La libreria pesa unos 50 kB y aqui no llega ni un byte al navegador: se
 * devuelve un SVG ya dibujado. Generarlo en el cliente cargaria esa libreria en
 * una pantalla que ademas se imprime, donde el JavaScript no ha corrido
 * necesariamente.
 */
async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    // Correccion media: un certificado se imprime, se doble y se fotocopia, y
    // con el nivel bajo un pliegue en mitad del codigo lo deja ilegible.
    errorCorrectionLevel: 'M',
    color: { dark: '#1B2A38', light: '#FFFFFF' },
  });
}

const VERIFY_BASE =
  process.env['NEXT_PUBLIC_VERIFY_URL'] ?? 'https://glexcoweb-production.up.railway.app/verificar';

export async function MyCertificates({ portal }: { portal: 'discover' | 'academy' }) {
  const { items, failed, disabled } = await fetchMyCertificates();

  if (disabled) {
    return (
      <EmptyState
        title="Los certificados aún no están activos"
        description="Esta plataforma todavía no tiene configurada la firma de certificados. Habla con tu colegio."
      />
    );
  }

  if (failed) {
    return (
      <EmptyState
        title="No pudimos cargar tus certificados"
        description="Vuelve a intentarlo en un momento. Si sigue pasando, avisa a tu docente."
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CertificateIcon size={32} />}
        title="Todavía no tienes ningún certificado"
        description="Se emite al terminar todas las lecciones de un curso. Te queda poco."
        action={{ href: `/${portal}/cursos`, label: 'Ver mis cursos' }}
      />
    );
  }

  return (
    <div className="grid gap-[var(--portal-gap)]" data-certificates={items.length}>
      {items.map((certificate) => (
        <Certificate key={certificate.id} certificate={certificate} />
      ))}
    </div>
  );
}

/**
 * El certificado, tal y como se imprime.
 *
 * Lleva TODO lo que hace falta para comprobarlo sin nosotros: la serie, el QR
 * con la direccion de verificacion, y la huella de la clave con la que se firmo.
 * Un certificado que solo vale mientras nuestro servidor este encendido no es un
 * certificado, es una pantalla.
 */
async function Certificate({ certificate }: { certificate: MyCertificate }) {
  const url = `${VERIFY_BASE}/${certificate.serial}`;
  const svg = await qrSvg(url);
  const revoked = Boolean(certificate.revokedAt);

  return (
    <article
      data-certificate={certificate.serial}
      className={`overflow-hidden rounded-[var(--portal-radius)] border bg-white ${
        revoked ? 'border-danger/40' : 'border-line-200'
      }`}
    >
      <div className="flex flex-wrap items-start gap-6 p-[var(--portal-card-padding)]">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-2">Certificado de finalización</p>
          <h2 className="font-display text-xl font-semibold">{certificate.courseTitle}</h2>
          <p className="mt-1 text-sm text-ink-500">{certificate.studentName}</p>
          {certificate.institutionName ? (
            <p className="text-sm text-ink-500">{certificate.institutionName}</p>
          ) : null}

          <dl className="mt-4 grid gap-1 text-xs text-ink-500">
            <div className="flex gap-2">
              <dt>Emitido el</dt>
              <dd className="font-medium text-ink-700">{formatDate(certificate.issuedAt)}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Serie</dt>
              {/* Tabular y separada: es lo que alguien dicta por telefono o
                  teclea cuando el QR no se deja escanear. */}
              <dd className="font-mono tabular-nums text-ink-700">{certificate.serial}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Huella de la clave</dt>
              <dd className="font-mono text-ink-700">{certificate.keyFingerprint}</dd>
            </div>
          </dl>

          {revoked ? (
            <p className="mt-4 rounded-[calc(var(--portal-radius)*0.75)] bg-state-late-bg px-3 py-2 text-sm font-medium text-state-late-fg">
              Anulado{certificate.revokedReason ? `: ${certificate.revokedReason}` : ''}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <a href={url} target="_blank" rel="noreferrer noopener" className="btn btn-secondary">
              Ver la verificación
              <span className="sr-only"> (se abre en otra pestaña)</span>
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="shrink-0 text-center">
          {/* El SVG viene del servidor y no lleva nada del usuario dentro: es un
              codigo de barras de una URL nuestra. */}
          <div
            className="size-[7.5rem] [&>svg]:size-full"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="mt-2 max-w-[7.5rem] text-[11px] leading-tight text-ink-500">
            Escanea para comprobar que es auténtico
          </p>
        </div>
      </div>
    </article>
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
