import type { LoggerPort, SecureRandom } from '@glexco/kernel';
import type { EmailDeliveryLog, MailSender, OneTimeTokenIssuer } from './ports';
import { passwordResetEmail, verificationEmail, type EmailTemplateInput } from './email-templates';

export type AccountEmailKind = 'email_verification' | 'password_reset';

export interface SendAccountEmailInput {
  kind: AccountEmailKind;
  userId: string;
  email: string;
  firstName: string;
  locale: 'es' | 'en';
  /** Solo en el alta de un menor de 14. El aviso de creacion de cuenta va
   *  tambien a un adulto: es un requisito legal, no una cortesia. */
  guardianEmail?: string | null;
}

/**
 * Envia un correo de cuenta con su enlace de un solo uso.
 *
 * **El token se pide a identidad AQUI, no llega en el evento.** Un evento vive
 * dias en la outbox y en el stream de JetStream; un token de recuperacion
 * escrito ahi convierte el acceso de lectura a una tabla —o a una copia de
 * seguridad vieja— en el control de cualquier cuenta de la plataforma. Es el
 * mismo criterio por el que el codigo de activacion viaja como id de fila.
 *
 * Ademas, la hora de vida del enlace empieza cuando el correo sale. Con el token
 * embebido en el evento, un relevo de outbox retrasado entregaria enlaces ya
 * medio caducados, que es la clase de fallo que solo aparece bajo carga y se
 * diagnostica fatal.
 */
export class SendAccountEmailUseCase {
  constructor(
    private readonly tokens: OneTimeTokenIssuer,
    private readonly mail: MailSender,
    private readonly log: EmailDeliveryLog,
    private readonly ids: SecureRandom,
    private readonly portalUrl: string,
    private readonly logger: LoggerPort,
  ) {}

  async execute(input: SendAccountEmailInput): Promise<void> {
    const issued = await this.tokens.issue({ userId: input.userId, purpose: input.kind });

    // `null` significa que la cuenta ya no existe: la outbox retiene eventos
    // durante dias y una baja puede haber ocurrido en medio. Se abandona SIN
    // lanzar, para que el consumidor confirme el evento. Reintentar un correo a
    // un usuario borrado no lo va a arreglar nunca y atasca la cola detras.
    //
    // Cualquier otro fallo -identidad caida, tiempo agotado- si lanza desde el
    // emisor, y entonces el evento se reentrega, que es lo correcto.
    if (!issued) {
      this.logger.warn('Se descarta el correo: el usuario ya no existe', {
        userId: input.userId,
        kind: input.kind,
      });
      return;
    }

    const template: EmailTemplateInput = {
      firstName: input.firstName,
      url: this.linkFor(input.kind, issued.token),
      ttlSeconds: issued.ttlSeconds,
      portalUrl: this.portalUrl,
    };

    const message =
      input.kind === 'password_reset' ? passwordResetEmail(template) : verificationEmail(template);

    // Los destinatarios, en envios SEPARADOS y no en copia. Poner al apoderado
    // en copia le revelaria a cada alumno el correo del apoderado del otro en
    // cuanto alguien reenvie el mensaje, y son datos de menores.
    const recipients = [input.email];
    if (input.kind === 'email_verification' && input.guardianEmail) {
      recipients.push(input.guardianEmail);
    }

    for (const recipient of recipients) {
      await this.deliver(input, recipient, { ...message, to: recipient });
    }
  }

  private async deliver(
    input: SendAccountEmailInput,
    recipient: string,
    email: { to: string; subject: string; text: string; html: string },
  ): Promise<void> {
    try {
      const { ref } = await this.mail.send(email);

      await this.log.record({
        id: this.ids.uuid(),
        userId: input.userId,
        kind: input.kind,
        recipient,
        locale: input.locale,
        status: 'sent',
        providerRef: ref,
      });

      // El destinatario NO se escribe en el log de la aplicacion: es un dato
      // personal de un menor y estos registros se exportan a un agregador. Queda
      // en la tabla de envios, que es donde soporte puede consultarlo con la
      // autorizacion correspondiente.
      this.logger.info('Correo de cuenta enviado', { userId: input.userId, kind: input.kind });
    } catch (error) {
      await this.log
        .record({
          id: this.ids.uuid(),
          userId: input.userId,
          kind: input.kind,
          recipient,
          locale: input.locale,
          status: 'failed',
          failureReason: error instanceof Error ? error.message.slice(0, 300) : 'desconocido',
        })
        .catch(() => undefined);

      // Se relanza: el consumidor no confirmara el evento y JetStream lo
      // reentregara. Un correo de verificacion que se pierde porque el servidor
      // SMTP estaba reiniciandose deja una cuenta que nadie puede activar.
      throw error;
    }
  }

  /**
   * El enlace apunta al PORTAL y no a la API.
   *
   * Quien abre el correo es una persona, no un cliente HTTP: tiene que aterrizar
   * en una pantalla que le explique que ha pasado y que hacer si el enlace ya
   * caduco. Un enlace directo al endpoint devuelve un JSON en el navegador de un
   * nino de nueve anos.
   */
  private linkFor(kind: AccountEmailKind, token: string): string {
    const path = kind === 'password_reset' ? '/recuperar/nueva' : '/verificar';
    return `${this.portalUrl}${path}?token=${encodeURIComponent(token)}`;
  }
}
