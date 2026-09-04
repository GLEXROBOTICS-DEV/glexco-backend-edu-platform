import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GRADES } from '@glexco/contracts';
import { getSession } from '../../lib/session';
import { portalPath } from '../../lib/portal';
import { gradeLabel } from '../../lib/catalog';
import { fetchSelectableClassrooms, lookupInstitution } from '../../lib/registration';
import { RegistrationForm } from './registration-form';
import { RegistrationShell } from './shell';

export const metadata: Metadata = { title: 'Crear mi cuenta' };

/**
 * Alta de alumno.
 *
 * **El asistente guarda su estado en la URL, no en el cliente.** Los dos pasos
 * son formularios `GET` normales, asi que funcionan sin una linea de JavaScript,
 * se puede volver atras con el boton del navegador sin perder lo elegido y un
 * docente puede pasarle a su clase un enlace con el colegio y el grado ya
 * puestos. Guardarlo en estado de React habria costado lo mismo y habria roto
 * las tres cosas.
 *
 * El grado y el codigo del colegio se piden JUNTOS en el primer paso. Podrian
 * ser dos pasos -primero el colegio, luego el grado-, pero el alumno sabe las
 * dos cosas desde el principio y cada pantalla intermedia es gente que abandona.
 */

const ORDERED_GRADES: readonly string[] = [
  GRADES.PRIMARY_1,
  GRADES.PRIMARY_2,
  GRADES.PRIMARY_3,
  GRADES.PRIMARY_4,
  GRADES.PRIMARY_5,
  GRADES.PRIMARY_6,
  GRADES.SECONDARY_1,
  GRADES.SECONDARY_2,
  GRADES.SECONDARY_3,
  GRADES.SECONDARY_4,
  GRADES.SECONDARY_5,
  GRADES.TECHNICAL_PROGRAM,
  GRADES.HIGHER_PROGRAM,
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RegistroPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (session) redirect(portalPath(session.portal));

  const params = await searchParams;
  const accountType = single(params['tipo']) === 'independiente' ? 'independent' : 'institutional';
  const institutionCode = single(params['colegio']).trim().toUpperCase();
  const grade = ORDERED_GRADES.includes(single(params['grado'])) ? single(params['grado']) : '';

  // Solo se busca el colegio cuando hace falta. Un alta independiente no toca
  // el servicio de instituciones en ningun momento: no tiene colegio, y pedirle
  // uno "por si acaso" es como se cuelan requisitos que nadie pidio.
  const institution =
    accountType === 'institutional' && institutionCode
      ? await lookupInstitution(institutionCode)
      : null;

  const ready = grade !== '' && (accountType === 'independent' || institution !== null);
  const vocab = await getTranslations();

  if (!ready) {
    return (
      <RegistrationShell step={1}>
        <PrimerPaso
          accountType={accountType}
          institutionCode={institutionCode}
          grade={grade}
          notFound={accountType === 'institutional' && institutionCode !== '' && !institution}
        />
      </RegistrationShell>
    );
  }

  const classrooms =
    accountType === 'institutional' && institution
      ? await fetchSelectableClassrooms(institution.institutionId, grade)
      : [];

  return (
    <RegistrationShell step={2}>
      <div className="mb-6 rounded-lg border border-line-200 bg-white px-4 py-3 text-sm">
        <p className="font-medium text-ink-900">
          {institution ? institution.name : 'Cuenta independiente'}
        </p>
        <p className="mt-0.5 text-ink-500">
          {gradeLabel(vocab, grade)}
          {institution ? ` · ${institution.city}` : ' · sin colegio'}
        </p>
        {/* Un enlace y no un boton "atras": conserva la URL del paso 1 con lo
            ya tecleado, asi que corregir el grado no obliga a escribir de nuevo
            el codigo del colegio. */}
        <a
          href={`/registro?tipo=${accountType === 'independent' ? 'independiente' : 'institucional'}${
            institutionCode ? `&colegio=${encodeURIComponent(institutionCode)}` : ''
          }`}
          className="mt-2 inline-block font-medium text-brand-600 hover:underline"
        >
          Cambiar colegio o grado
        </a>
      </div>

      <RegistrationForm
        accountType={accountType}
        grade={grade}
        institutionId={institution?.institutionId ?? ''}
        classrooms={classrooms}
      />
    </RegistrationShell>
  );
}

/**
 * Primer paso: quien eres y de donde vienes.
 *
 * El tipo de cuenta va con `institucional` marcado por defecto porque es el
 * caso mayoritario -el colegio compra los kits-, pero el camino independiente
 * tiene su propio enlace igual de visible: hay familias que compran el libro por
 * su cuenta y son la mitad del modelo de negocio, no una excepcion a tolerar.
 */
async function PrimerPaso({
  accountType,
  institutionCode,
  grade,
  notFound,
}: {
  accountType: 'institutional' | 'independent';
  institutionCode: string;
  grade: string;
  notFound: boolean;
}) {
  const isInstitutional = accountType === 'institutional';
  const vocab = await getTranslations();

  return (
    <>
      <div
        role="group"
        aria-label="Tipo de cuenta"
        className="mb-6 grid gap-2 sm:grid-cols-2"
        data-step="tipo"
      >
        <TipoOpcion
          href="/registro?tipo=institucional"
          selected={isInstitutional}
          title="Estudio en un colegio"
          description="Tu colegio te dio un código."
        />
        <TipoOpcion
          href="/registro?tipo=independiente"
          selected={!isInstitutional}
          title="Compré el libro por mi cuenta"
          description="Sin colegio, solo con tu código."
        />
      </div>

      {/* `method="get"` a proposito: el paso siguiente es una LECTURA (buscar el
          colegio y sus salones) y no cambia nada en el servidor. Con GET, el
          resultado tiene URL propia, se puede recargar sin el aviso de reenvio
          de formulario y el boton atras del navegador hace lo que se espera. */}
      <form method="get" action="/registro" className="space-y-5">
        <input
          type="hidden"
          name="tipo"
          value={isInstitutional ? 'institucional' : 'independiente'}
        />

        {isInstitutional ? (
          <div>
            <label htmlFor="colegio" className="block text-sm font-medium text-ink-700">
              Código de tu colegio
            </label>
            <p id="colegio-ayuda" className="mt-1 text-sm text-ink-500">
              Te lo da tu docente o la coordinación de tu colegio.
            </p>
            <input
              id="colegio"
              name="colegio"
              defaultValue={institutionCode}
              required
              autoComplete="off"
              // En mayusculas desde el teclado: el codigo es en mayusculas y
              // asi el alumno ve lo mismo que va a enviarse.
              className="field mt-1.5 uppercase"
              aria-describedby={notFound ? 'colegio-error' : 'colegio-ayuda'}
              aria-invalid={notFound ? true : undefined}
            />
            {notFound ? (
              <p id="colegio-error" role="alert" className="mt-1.5 text-sm text-danger">
                No encontramos ningún colegio con ese código. Revísalo con tu docente.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label htmlFor="grado" className="block text-sm font-medium text-ink-700">
            ¿En qué grado estás?
          </label>
          <select
            id="grado"
            name="grado"
            defaultValue={grade}
            required
            className="field mt-1.5"
          >
            <option value="">Elige tu grado…</option>
            {ORDERED_GRADES.map((value) => (
              <option key={value} value={value}>
                {gradeLabel(vocab, value)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block"
        >
          Continuar
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-500">
        ¿Ya tienes cuenta?{' '}
        <a href="/ingresar" className="font-medium text-brand-600 hover:underline">
          Ingresa aquí
        </a>
      </p>
    </>
  );
}

/**
 * Opcion del tipo de cuenta.
 *
 * Es un enlace y no un `radio` porque cambiar de tipo cambia los campos que se
 * piden, y eso exige ir al servidor. Un radio que no hace nada hasta que pulsas
 * otro boton es la forma habitual de que la gente elija una cosa y envie otra.
 * `aria-current` comunica cual esta activa sin depender del color de fondo.
 */
function TipoOpcion({
  href,
  selected,
  title,
  description,
}: {
  href: string;
  selected: boolean;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      className={`block rounded-lg border px-4 py-3 text-left transition ${
        selected
          ? 'border-brand-600 bg-brand-600/5 ring-1 ring-brand-600'
          : 'border-line-300 bg-white hover:border-brand-400'
      }`}
    >
      <span className="block text-sm font-semibold text-ink-900">
        {title}
        {/* El estado no se comunica solo con color ni solo con un borde: para
            quien no distingue el uno del otro, esta palabra es la unica senal. */}
        {selected ? <span className="sr-only"> (seleccionado)</span> : null}
      </span>
      <span className="mt-0.5 block text-sm text-ink-500">{description}</span>
    </a>
  );
}

function single(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
