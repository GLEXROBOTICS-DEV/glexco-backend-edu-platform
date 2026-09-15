'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { registerStudent, type RegistrationState } from '../../lib/registration.actions';
import type { SelectableClassroom } from '../../lib/registration';

/**
 * Segundo paso del alta: datos personales, salon y codigo del libro.
 *
 * Es el unico componente de cliente de la pantalla, y funciona **sin
 * JavaScript**: `useActionState` sobre `<form action>` degrada a un envio normal
 * del navegador. Importa mas aqui que en ninguna otra pantalla, porque esta es
 * la primera que abre un alumno y todavia no sabe si la plataforma le funciona.
 *
 * Todo lo que se valida aqui se vuelve a validar en el servidor. La validacion
 * de este lado existe para que el alumno no descubra un error despues de esperar
 * una peticion, no para decidir nada.
 */
export function RegistrationForm({
  accountType,
  grade,
  institutionId,
  classrooms,
}: {
  accountType: 'institutional' | 'independent';
  grade: string;
  institutionId: string;
  classrooms: SelectableClassroom[];
}) {
  const [state, formAction] = useActionState<RegistrationState, FormData>(registerStudent, {});
  const values = state.values ?? {};
  const t = useTranslations('registro');

  const withCapacity = classrooms.filter((classroom) => classroom.hasCapacity);
  const noClassrooms = accountType === 'institutional' && classrooms.length === 0;
  const allFull = accountType === 'institutional' && classrooms.length > 0 && withCapacity.length === 0;

  if (noClassrooms || allFull) {
    return (
      <div
        role="alert"
        data-classrooms="none"
        className="rounded-lg border border-achievement/40 bg-achievement/5 px-4 py-4 text-sm"
      >
        <p className="font-semibold text-ink-900">
          {noClassrooms ? t('sinSalones') : t('salonesLlenos')}
        </p>
        <p className="mt-1 text-ink-700">
          {noClassrooms ? t('sinSalonesAyuda') : t('salonesLlenosAyuda')}
        </p>
        {/* Sin salida, esta pantalla es un callejon: la cuenta independiente es
            un camino real y no un premio de consolacion, asi que se ofrece. */}
        <a
          href="/registro?tipo=independiente"
          className="mt-3 inline-block font-medium text-brand-600 hover:underline"
        >
          {t('crearIndependiente')}
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="accountType" value={accountType} />
      <input type="hidden" name="grade" value={grade} />
      {accountType === 'institutional' ? (
        <input type="hidden" name="institutionId" value={institutionId} />
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {accountType === 'institutional' ? (
        <Salones
          classrooms={withCapacity}
          selected={values['classroomId'] ?? ''}
          errors={state.fieldErrors?.['classroomId']}
          legend={t('enQueSalon')}
        />
      ) : null}

      <Field
        label={t('codigoLibro')}
        name="activationCode"
        autoComplete="off"
        defaultValue={values['activationCode'] ?? ''}
        errors={state.fieldErrors?.['activationCode']}
        hint={t('codigoLibroAyuda')}
        className="uppercase tracking-wider"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('nombres')}
          name="firstName"
          autoComplete="given-name"
          defaultValue={values['firstName'] ?? ''}
          errors={state.fieldErrors?.['firstName']}
        />
        <Field
          label={t('apellidos')}
          name="lastName"
          autoComplete="family-name"
          defaultValue={values['lastName'] ?? ''}
          errors={state.fieldErrors?.['lastName']}
        />
      </div>

      <Field
        label={t('fechaNacimiento')}
        name="birthDate"
        type="date"
        autoComplete="bday"
        defaultValue={values['birthDate'] ?? ''}
        errors={state.fieldErrors?.['birthDate']}
      />

      <Field
        label={t('tuCorreo')}
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={values['email'] ?? ''}
        errors={state.fieldErrors?.['email']}
      />

      {/* Siempre visible, nunca condicionado a la fecha ya escrita. Mostrarlo
          solo para menores de catorce obligaria a JavaScript para una regla
          legal, y sin JavaScript el campo obligatorio no aparecería: el alumno
          enviaria el formulario y recibiria un error por un campo que no ve. */}
      <Field
        label={t('correoApoderado')}
        name="guardianEmail"
        type="email"
        autoComplete="off"
        defaultValue={values['guardianEmail'] ?? ''}
        errors={state.fieldErrors?.['guardianEmail']}
        hint={t('correoApoderadoAyuda')}
        optional
        optionalLabel={t('segunTuEdad')}
      />

      <Field
        label={t('contrasena')}
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.['password']}
        hint={t('contrasenaAyuda')}
      />

      <Field
        label={t('repiteContrasena')}
        name="passwordConfirm"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.['passwordConfirm']}
      />

      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox"
            name="acceptedTerms"
            className="mt-0.5 size-4 shrink-0 rounded border-line-300 text-brand-600"
            aria-describedby={state.fieldErrors?.['acceptedTerms'] ? 'terms-error' : undefined}
          />
          {/* La frase entera es UNA clave con sus enlaces dentro, y no tres
              trozos concatenados: en ingles el orden de "los terminos" y "la
              politica" no tiene por que ser el mismo, y partirla obliga al
              traductor a encajar las piezas en un orden que no eligio. */}
          <span>
            {t.rich('aceptoTerminos', {
              terminos: (texto) => (
                <a href="/terminos" className="font-medium text-brand-600 hover:underline">
                  {texto}
                </a>
              ),
              privacidad: (texto) => (
                <a href="/privacidad" className="font-medium text-brand-600 hover:underline">
                  {texto}
                </a>
              ),
            })}
          </span>
        </label>
        {state.fieldErrors?.['acceptedTerms']?.length ? (
          <p id="terms-error" className="mt-1.5 text-sm text-danger">
            {state.fieldErrors['acceptedTerms'][0]}
          </p>
        ) : null}
      </div>

      <SubmitButton />

      <p className="text-center text-sm text-ink-500">
        {t('yaTienesCuenta')}{' '}
        <a href="/ingresar" className="font-medium text-brand-600 hover:underline">
          {t('ingresaAqui')}
        </a>
      </p>
    </form>
  );
}

/**
 * Eleccion de salon.
 *
 * `fieldset` + `legend` con radios NATIVOS: traen gratis el agrupado por
 * `name`, la navegacion con las flechas del teclado y el anuncio correcto en un
 * lector de pantalla ("salón 2 de 4"). Una lista de `div` con `onClick` tendria
 * que reimplementar las tres cosas y normalmente reimplementa mal las tres.
 *
 * Solo llegan aqui los salones con cupo: mostrar los llenos deshabilitados
 * anade ruido en la pantalla mas larga del alta sin ofrecer ninguna accion.
 */
function Salones({
  classrooms,
  selected,
  errors,
  legend,
}: {
  classrooms: SelectableClassroom[];
  selected: string;
  errors?: string[];
  legend: string;
}) {
  return (
    <fieldset data-classrooms={classrooms.length}>
      <legend className="text-sm font-medium text-ink-700">{legend}</legend>
      <div className="mt-2 space-y-2">
        {classrooms.map((classroom, index) => (
          <label
            key={classroom.id}
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-300 bg-white px-4 py-3 transition hover:border-brand-400 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600/5"
          >
            <input
              type="radio"
              name="classroomId"
              value={classroom.id}
              // Con un solo salon no hay eleccion que hacer: dejarlo sin marcar
              // solo consigue que alguien envie el formulario sin salon y tenga
              // que volver. Con varios no se presume ninguno.
              defaultChecked={selected ? selected === classroom.id : classrooms.length === 1 && index === 0}
              required
              className="size-4 shrink-0 border-line-300 text-brand-600"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-900">{classroom.name}</span>
              {classroom.teacherName ? (
                <span className="block truncate text-sm text-ink-500">{classroom.teacherName}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {errors?.length ? (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {errors[0]}
        </p>
      ) : null}
    </fieldset>
  );
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  defaultValue,
  errors,
  hint,
  optional,
  optionalLabel,
  className,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  defaultValue?: string;
  errors?: string[];
  hint?: string;
  optional?: boolean;
  optionalLabel?: string;
  className?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const described = [errors?.length ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-ink-700">
        {label}
        {optional && optionalLabel ? (
          <span className="ml-1 font-normal text-ink-400">{optionalLabel}</span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-1 text-sm text-ink-500">
          {hint}
        </p>
      ) : null}
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={!optional}
        aria-describedby={described || undefined}
        aria-invalid={errors?.length ? true : undefined}
        className={`field mt-1.5 ${className ?? ''}`}
      />
      {errors?.length ? (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useTranslations('registro');

  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary btn-block"
    >
      {/* Cambia el texto y no solo un icono: un lector de pantalla anuncia el
          cambio de texto, y un spinner girando no dice nada. */}
      {pending ? t('creandoCuenta') : t('crearCuenta')}
    </button>
  );
}
