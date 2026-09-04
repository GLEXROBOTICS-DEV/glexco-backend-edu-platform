import { BrandPanel } from '../../components/brand-panel';

/**
 * Marco de las pantallas de registro.
 *
 * Reutiliza el MISMO panel de marca de `/ingresar` -el componente, no una copia
 * de su maquetacion- para que registrarse e ingresar se reconozcan como la misma
 * puerta. Cuando eran dos bloques calcados, cualquier retoque en uno dejaba al
 * otro atras y las dos mitades de la misma puerta acababan sin parecerse.
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
      <BrandPanel
        headline="Tu libro abre tu kit"
        description="Crea tu cuenta con el código que viene dentro y empieza a construir con uKit, uGoT, Yanshee y toda la línea GLEXCO – UBTECH."
      />

      <section className="flex flex-1 items-center justify-center bg-surface-50 px-6 py-12">
        <div className="w-full max-w-[26.5rem]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/glexco-marca.svg"
            data-brand-mark=""
            alt="GLEXCO"
            width={168}
            height={34}
            className="mb-8 block w-[10.5rem] lg:hidden"
          />
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
