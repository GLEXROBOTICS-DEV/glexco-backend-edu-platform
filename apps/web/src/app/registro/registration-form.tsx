'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
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
          {noClassrooms ? 'Todavía no hay salones para tu grado' : 'Los salones de tu grado están llenos'}
        </p>
        <p className="mt-1 text-ink-700">
          {noClassrooms
            ? 'Tu colegio aún no ha creado los salones de este grado. Avisa a tu docente para que los abra.'
            : 'Tu docente puede ampliar el cupo o abrir otro salón. Avísale y vuelve a intentarlo.'}
        </p>
        {/* Sin salida, esta pantalla es un callejon: la cuenta independiente es
            un camino real y no un premio de consolacion, asi que se ofrece. */}
        <a
          href="/registro?tipo=independiente"
          className="mt-3 inline-block font-medium text-brand-600 hover:underline"
        >
          Crear una cuenta independiente con mi código
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
        />
      ) : null}

      <Field
        label="Código de tu libro"
        name="activationCode"
        autoComplete="off"
        defaultValue={values['activationCode'] ?? ''}
        errors={state.fieldErrors?.['activationCode']}
        hint="Está impreso dentro de tu libro y empieza por GLX. Puedes escribirlo con o sin guiones."
        className="uppercase tracking-wider"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Nombres"
          name="firstName"
          autoComplete="given-name"
          defaultValue={values['firstName'] ?? ''}
          errors={state.fieldErrors?.['firstName']}
        />
        <Field
          label="Apellidos"
          name="lastName"
          autoComplete="family-name"
          defaultValue={values['lastName'] ?? ''}
          errors={state.fieldErrors?.['lastName']}
        />
      </div>

      <Field
        label="Fecha de nacimiento"
        name="birthDate"
        type="date"
        autoComplete="bday"
        defaultValue={values['birthDate'] ?? ''}
        errors={state.fieldErrors?.['birthDate']}
      />

      <Field
        label="Tu correo"
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
        label="Correo de tu papá, mamá o apoderado"
        name="guardianEmail"
        type="email"
        autoComplete="off"
        defaultValue={values['guardianEmail'] ?? ''}
        errors={state.fieldErrors?.['guardianEmail']}
        hint="Obligatorio si tienes menos de 14 años. Le avisaremos de que creaste tu cuenta."
        optional
      />

      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        errors={state.fieldErrors?.['password']}
        hint="Al menos 8 caracteres. Elige algo que recuerdes y que nadie más sepa."
      />

      <Field
        label="Repite la contraseña"
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
          <span>
            Acepto los <a href="/terminos" className="font-medium text-brand-600 hover:underline">términos</a>{' '}
            y la{' '}
            <a href="/privacidad" className="font-medium text-brand-600 hover:underline">
              política de privacidad
            </a>
            .
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
        ¿Ya tienes cuenta?{' '}
        <a href="/ingresar" className="font-medium text-brand-600 hover:underline">
          Ingresa aquí
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
}: {
  classrooms: SelectableClassroom[];
  selected: string;
  errors?: string[];
}) {
  return (
    <fieldset data-classrooms={classrooms.length}>
      <legend className="text-sm font-medium text-ink-700">¿En qué salón estás?</legend>
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
        {optional ? <span className="ml-1 font-normal text-ink-400">(según tu edad)</span> : null}
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
        className={`mt-1.5 w-full rounded-lg border border-line-300 bg-white px-3 py-2.5 text-ink-900 outline-none transition focus:border-brand-400 ${className ?? ''}`}
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

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
    >
      {/* Cambia el texto y no solo un icono: un lector de pantalla anuncia el
          cambio de texto, y un spinner girando no dice nada. */}
      {pending ? 'Creando tu cuenta…' : 'Crear mi cuenta y activar el código'}
    </button>
  );
}
