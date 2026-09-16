'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { EDUCATION_LEVELS } from '@glexco/contracts';
import { safeLabel } from '../lib/vocabulary';
import {
  changeContentStatus,
  createInstitution,
  createStaff,
  generateCodeBatch,
  grantLicense,
  type AdminState,
} from '../lib/admin.actions';

/**
 * Los formularios del Portal Admin.
 *
 * Cliente por el mensaje en línea, no por la lógica: son `<form action>`
 * normales y **funcionan sin JavaScript**, como el resto del portal. Sin él se
 * pierde el aviso en línea, no la capacidad de dar de alta un colegio.
 *
 * Todos comparten una regla: **la validación de verdad está en el servicio.** Lo
 * que se comprueba aquí es lo que el backend no puede ver —dos campos que tienen
 * que coincidir, un periodo al revés— y se hace para ahorrar un viaje, nunca
 * como control.
 */

function Aviso({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
      >
        {state.error}
      </p>
    );
  }

  if (state.ok) {
    return (
      <p
        role="status"
        className="rounded-lg border border-state-done-fg/25 bg-state-done-bg px-4 py-3 text-sm text-state-done-fg"
      >
        {state.ok}
      </p>
    );
  }

  return null;
}

function Enviar({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className="btn btn-primary justify-self-start">
      {/* Texto que cambia y no un icono girando: el cambio lo anuncia el lector
          de pantalla, el icono no. */}
      {pending ? pendingLabel : label}
    </button>
  );
}

/** Alta de colegio. */
export function InstitutionForm() {
  const t = useTranslations('admin');
  const vocab = useTranslations();
  const [state, formAction] = useActionState<AdminState, FormData>(createInstitution, {});

  return (
    <form action={formAction} className="grid gap-4">
      <Aviso state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('nombreDelColegio')}</span>
          <input type="text" name="name" required minLength={3} className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('codigoDeRegistro')}</span>
          <input
            type="text"
            name="code"
            required
            placeholder="SJB2026"
            className="field uppercase"
          />
          {/* Se dice ANTES de escribirlo, no después en un error: este código es
              lo que los alumnos teclean al registrarse y va impreso en los
              libros que el colegio ya compró. Se guarda sin guiones, y quien
              escriba "SJB-2026" y luego lo busque tal cual no lo encontrará. */}
          <span className="text-xs text-ink-400">{t('codigoDeRegistroAyuda')}</span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('nombreCorto')}</span>
          <input type="text" name="shortName" className="field" />
          <span className="text-xs text-ink-400">{t('nombreCortoAyuda')}</span>
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('ciudad')}</span>
          <input type="text" name="city" required minLength={2} className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('personaResponsable')}</span>
          <input type="text" name="responsibleName" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('correoDeContacto')}</span>
          <input type="email" name="contactEmail" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('telefono')}</span>
          <input type="tel" name="phone" className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('direccion')}</span>
          <input type="text" name="address" className="field" />
        </label>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-ink-700">{t('nivelesQueAtiende')}</legend>
        {/* El nivel decide qué grados se pueden crear: sin ninguno, el colegio
            queda dado de alta y sin poder abrir un solo salón. */}
        <p className="text-xs text-ink-400">{t('nivelesAyuda')}</p>
        <div className="flex flex-wrap gap-4">
          {Object.values(EDUCATION_LEVELS).map((level) => (
            <label key={level} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="educationLevels"
                value={level}
                className="size-4 border-line-300 text-brand-600"
              />
              {safeLabel(vocab, 'nivelesEducativos', level)}
            </label>
          ))}
        </div>
      </fieldset>

      <Enviar label={t('darDeAltaElColegio')} pendingLabel={t('creando')} />
    </form>
  );
}

/** Licencia de un colegio: plazas y periodo. */
export function LicenseForm({
  institutionId,
  institutionName,
}: {
  institutionId: string;
  institutionName: string;
}) {
  const t = useTranslations('admin');
  const [state, formAction] = useActionState<AdminState, FormData>(grantLicense, {});
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="institutionId" value={institutionId} />
      <Aviso state={state} />

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('plazas')}</span>
          {/* No es una sugerencia: el canje de un código las comprueba, así que
              este número es el tope real de alumnos que podrán activar. */}
          <input type="number" name="seats" min={1} required defaultValue={30} className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('desde')}</span>
          <input type="date" name="startsAt" required defaultValue={hoy} className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('hasta')}</span>
          <input type="date" name="expiresAt" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('referencia')}</span>
          <input type="text" name="reference" placeholder={t('ejemploReferencia')} className="field" />
        </label>
      </div>

      <Enviar
        label={t('concederLicenciaA', { colegio: institutionName })}
        pendingLabel={t('concediendo')}
      />
    </form>
  );
}

/** Alta de personal. */
export function StaffForm({
  roles,
  institutions,
}: {
  roles: { value: string; label: string }[];
  institutions: { id: string; name: string }[];
}) {
  const t = useTranslations('admin');
  const [state, formAction] = useActionState<AdminState, FormData>(createStaff, {});

  return (
    <form action={formAction} className="grid gap-4">
      <Aviso state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('nombre')}</span>
          <input type="text" name="firstName" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('apellidos')}</span>
          <input type="text" name="lastName" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('correo')}</span>
          <input type="email" name="email" required className="field" />
        </label>

        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-700">{t('rol')}</span>
          <select name="role" required className="field">
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        {institutions.length > 0 ? (
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-ink-700">{t('colegio')}</span>
            <select name="institutionId" className="field">
              <option value="">{t('sinColegioEquipoGlexco')}</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {/* Se dice qué va a pasar, y lo que pasa es que la contraseña la entrega
          QUIEN CREA LA CUENTA. No se manda ningún correo: decir que llega uno
          dejaría a la persona esperando algo que no existe y al operador sin
          saber que la contraseña la tiene él. */}
      <p className="rounded-lg border border-line-200 bg-surface-100 px-4 py-3 text-sm text-ink-700">
        {t('comoSeEntregaLaClave')}
      </p>

      <Enviar label={t('crearCuenta')} pendingLabel={t('creando')} />

      {state.temporaryPassword ? (
        <div
          className="rounded-[var(--portal-radius)] border border-state-warn-fg/30 bg-state-warn-bg p-4"
          data-temporary-password="1"
        >
          <p className="text-sm font-medium text-state-warn-fg">{t('claveTemporal')}</p>
          <p className="mt-2 font-mono text-lg tracking-wide">{state.temporaryPassword}</p>
          <p className="mt-2 text-xs text-state-warn-fg">{t('entregalaEnPersona')}</p>
        </div>
      ) : null}
    </form>
  );
}

/** Lote de códigos de imprenta. */
export function CodeBatchForm({
  kits,
  institutions,
}: {
  kits: { kitId: string; name: string; grade: string }[];
  institutions: { id: string; name: string }[];
}) {
  const t = useTranslations('admin');
  const [state, formAction] = useActionState<AdminState, FormData>(generateCodeBatch, {});

  return (
    <>
      <form action={formAction} className="grid gap-4">
        <Aviso state={state} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-700">{t('kit')}</span>
            <select name="kitId" required className="field">
              {kits.map((kit) => (
                <option key={kit.kitId} value={kit.kitId}>
                  {kit.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-700">{t('cuantosCodigos')}</span>
            <input type="number" name="size" min={1} required defaultValue={30} className="field" />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-700">{t('paraQueColegio')}</span>
            <select name="distributedTo" className="field">
              <option value="">{t('stockGeneralDeImprenta')}</option>
              {institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name}
                </option>
              ))}
            </select>
            {/* Sin colegio, el evento del lote sale sin institución y el panel no
                puede atribuir esos códigos a nadie: es el fallo que dejó el
                recuento en «10 de 0 emitidos» durante semanas. */}
            <span className="text-xs text-ink-400">{t('paraQueColegioAyuda')}</span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-700">{t('referencia')}</span>
            <input type="text" name="reference" placeholder={t('ejemploReferencia')} className="field" />
          </label>

          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-ink-700">{t('caducanEl')}</span>
            <input type="date" name="expiresAt" className="field" />
            <span className="text-xs text-ink-400">{t('caducanElAyuda')}</span>
          </label>
        </div>

        <Enviar label={t('generarElLote')} pendingLabel={t('generando')} />
      </form>

      {state.codes && state.codes.length > 0 ? (
        <GeneratedCodes codes={state.codes} batchId={state.batchId ?? ''} />
      ) : null}
    </>
  );
}

/**
 * Los códigos recién generados.
 *
 * **Se enseñan aquí porque no hay otra ocasión.** En la base solo queda su hash,
 * así que no existe endpoint para volver a descargarlos: es deliberado —un
 * volcado de la tabla no debe convertirse en miles de accesos vendibles— y
 * obliga a que esta pantalla los ponga delante y lo diga con claridad.
 *
 * La descarga se arma en el NAVEGADOR con lo que ya está en la página: no hay
 * segunda petición, así que no hay una segunda ocasión de que estos códigos
 * salgan del servidor. Sin JavaScript el botón no aparece y los códigos siguen
 * ahí para copiarlos, que es lo que importa.
 */
function GeneratedCodes({ codes, batchId }: { codes: string[]; batchId: string }) {
  const t = useTranslations('admin');

  function descargar(): void {
    // BOM al principio: sin él, Excel abre el CSV en Latin-1 y los acentos de la
    // cabecera salen roto. Es una línea y ahorra la pregunta de siempre.
    const csv = `﻿${t('cabeceraCsvCodigo')}\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));

    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `glexco-lote-${batchId.slice(0, 8)}.csv`;
    enlace.click();

    URL.revokeObjectURL(url);
  }

  return (
    <section
      aria-labelledby="codigos-generados"
      className="mt-6 rounded-[var(--portal-radius)] border border-state-warn-fg/30 bg-state-warn-bg p-[var(--portal-card-padding)]"
      data-generated-codes={codes.length}
    >
      <h3 id="codigos-generados" className="font-display text-base font-semibold">
        {t('codigosGenerados', { cuantos: codes.length })}
      </h3>
      <p className="mt-1 text-sm text-state-warn-fg">{t('guardalosAhora')}</p>

      <button type="button" onClick={descargar} className="btn btn-primary btn-sm mt-4">
        {t('descargarEnCsv')}
      </button>

      <ul className="mt-4 grid gap-1 font-mono text-xs sm:grid-cols-3 lg:grid-cols-4">
        {codes.map((code) => (
          <li key={code} className="rounded bg-white/70 px-2 py-1">
            {code}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cambio de estado de publicación de un contenido. */
export function ContentStatusForm({
  id,
  target,
  status,
}: {
  id: string;
  target: 'kit' | 'course' | 'asset';
  status: string;
}) {
  const vocab = useTranslations();
  const [state, formAction] = useActionState<AdminState, FormData>(changeContentStatus, {});

  // Las transiciones permitidas las decide el backend; aquí solo se ofrecen las
  // que van a pasar. Ofrecer el salto de borrador a publicado produciría un
  // rechazo del servidor que el usuario leería como un fallo de la aplicación.
  const siguientes = TRANSITIONS[status] ?? [];

  if (siguientes.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="target" value={target} />

      {siguientes.map((next) => (
        <button
          key={next}
          type="submit"
          name="status"
          value={next}
          className="btn btn-sm btn-secondary"
        >
          {safeLabel(vocab, 'estadoAccion', next)}
        </button>
      ))}

      {state.error ? (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Las transiciones, copiadas del backend.
 *
 * Es una copia y se sabe: la tabla de verdad vive en `PublishContentUseCase`. Se
 * duplica para no ofrecer botones que van a fallar, y lo que impide de verdad el
 * salto de borrador a publicado sigue estando allí. Si las dos se desviaran, el
 * servidor rechaza y la pantalla lo dice; nunca al contrario.
 */
const TRANSITIONS: Record<string, string[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['published', 'draft', 'archived'],
  published: ['archived', 'in_review'],
  archived: ['draft'],
};
