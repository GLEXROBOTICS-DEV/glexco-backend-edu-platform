import type { Metadata } from 'next';
import { KitIcon, RobotIcon } from '@glexco/icons';
import { requireSession } from '../../../lib/session';
import { portalPath } from '../../../lib/portal';
import { fetchMyKits, gradeLabel } from '../../../lib/catalog';
import { RegistrationShell } from '../shell';

export const metadata: Metadata = { title: 'Tu cuenta está lista' };

/**
 * Confirmacion del alta.
 *
 * Existe por una razon concreta y no por cortesia: **el canje del codigo es
 * asincrono**. Identidad crea la cuenta y encola el evento; catalogo lo canjea
 * al consumirlo, normalmente en menos de un segundo. Si al alumno se le mandara
 * directo a su portal, en ese hueco veria el estado vacio -"todavia no tienes
 * ningun kit, activa el codigo de tu libro"-, que es exactamente lo que acaba de
 * hacer. Es la peor frase posible en el momento en que un producto de pago tiene
 * que demostrar que sirvio.
 *
 * Asi que esta pantalla lee los kits de verdad y dice la verdad en los dos
 * casos: si ya llego, ensena cual; y si no, dice que se esta activando y ofrece
 * volver a mirar. Nunca afirma que el kit esta listo sin haberlo comprobado.
 */
export default async function RegistroListoPage() {
  const session = await requireSession();
  const { kits } = await fetchMyKits();
  const destino = portalPath(session.portal);

  return (
    <RegistrationShell step={0}>
      <div className="text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-600/10 text-brand-600">
          <RobotIcon size={30} />
        </span>
        <h1 className="mt-4 font-display text-2xl font-semibold">
          Listo, {session.firstName}
        </h1>
        <p className="mt-2 text-sm text-ink-500">Tu cuenta ya está creada.</p>
      </div>

      {kits.length > 0 ? (
        <div
          data-activation="done"
          className="mt-6 rounded-lg border border-line-200 bg-white px-4 py-4"
        >
          <p className="text-sm font-medium text-ink-500">Tu código activó</p>
          <div className="mt-2 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600/10 text-brand-600">
              <KitIcon size={22} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-semibold">{kits[0]!.name}</p>
              <p className="mt-0.5 text-sm text-ink-500">{gradeLabel(kits[0]!.grade)}</p>
            </div>
          </div>
        </div>
      ) : (
        <div
          data-activation="pending"
          className="mt-6 rounded-lg border border-line-200 bg-white px-4 py-4 text-sm"
        >
          <p className="font-medium text-ink-900">Estamos activando tu libro</p>
          <p className="mt-1 text-ink-500">
            Tarda unos segundos. Puedes entrar ya: tu kit aparecerá en cuanto termine.
          </p>
          {/* Un enlace a esta misma pagina y no un temporizador: sin JavaScript
              un temporizador no existe, y con el, una pantalla que se recarga
              sola le quita al alumno el control de cuando mirar. */}
          <a href="/registro/listo" className="mt-2 inline-block font-medium text-brand-600 hover:underline">
            Volver a comprobar
          </a>
        </div>
      )}

      <a
        href={destino}
        className="btn btn-primary btn-block mt-6"
      >
        Entrar a mi portal
      </a>

      {/* NO se anuncia ningun correo de confirmacion: identidad emite el token
          de verificacion, pero hoy nadie consume ese evento, asi que el correo
          no sale. Decir "te enviamos un correo" dejaria a media clase esperando
          un mensaje que no existe y llamando a soporte. Cuando engagement lo
          envie de verdad, este es el sitio donde anunciarlo. */}
      <p className="mt-4 text-center text-sm text-ink-500">
        Entrarás como <strong className="font-medium text-ink-700">{session.email}</strong>.
      </p>
    </RegistrationShell>
  );
}
