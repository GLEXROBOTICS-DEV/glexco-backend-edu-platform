/**
 * Marco de las pantallas de registro.
 *
 * Reproduce el panel de marca de `/ingresar` para que registrarse e ingresar se
 * reconozcan como la misma puerta. Se oculta en movil por lo mismo que alli: en
 * una pantalla pequena, media altura de decoracion empuja el formulario fuera de
 * la vista.
 */
export function RegistrationShell({
  step,
  children,
}: {
  /** `0` en las pantallas que no son parte del asistente. */
  step: 0 | 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <main id="contenido" className="flex min-h-dvh flex-col lg:flex-row">
      <section
        className="hidden bg-gradient-to-br from-brand-900 via-brand-600 to-brand-400 p-12 lg:flex lg:w-[45%] lg:flex-col lg:justify-between"
        aria-hidden="true"
      >
        <div className="font-display text-3xl font-bold text-white">GLEXCO</div>
        <div>
          <p className="font-display text-4xl font-semibold leading-tight text-white">
            Tu libro abre tu kit.
          </p>
          <p className="mt-4 max-w-md text-lg text-brand-200">
            Crea tu cuenta con el código que viene dentro y empieza a construir.
          </p>
        </div>
        <div className="text-sm text-brand-200">Robótica educativa · UBTECH</div>
      </section>

      <section className="flex flex-1 items-center justify-center bg-surface-50 px-6 py-12">
        <div className="w-full max-w-md">
          {step === 1 || step === 2 ? <Pasos current={step} /> : null}
          {children}
        </div>
      </section>
    </main>
  );
}

/**
 * Indicador de progreso del asistente.
 *
 * Existe porque el primer paso pide dos datos sueltos y, sin decir que viene
 * despues, parece el formulario entero: quien no ve un segundo paso asume que ha
 * terminado y se sorprende al encontrarse otra pantalla.
 *
 * El estado va tambien en texto (`Paso 1 de 2`) y no solo en el color de los
 * puntos, que es lo unico que un lector de pantalla puede anunciar.
 */
function Pasos({ current }: { current: 1 | 2 }) {
  return (
    <div className="mb-6" data-step={current}>
      <p className="text-sm font-medium text-ink-500">Paso {current} de 2</p>
      <h1 className="mt-1 font-display text-2xl font-semibold">
        {current === 1 ? 'Crea tu cuenta' : 'Tus datos y tu código'}
      </h1>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        <span className="h-1 flex-1 rounded-full bg-brand-600" />
        <span className={`h-1 flex-1 rounded-full ${current === 2 ? 'bg-brand-600' : 'bg-surface-200'}`} />
      </div>
    </div>
  );
}
