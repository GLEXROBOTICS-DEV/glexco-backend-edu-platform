import nodemailer, { type Transporter } from 'nodemailer';
import { ServiceUnavailableError } from '@glexco/kernel';
import type { MailSender, OutgoingEmail } from '../../application/ports';

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
}

/**
 * Envio por SMTP.
 *
 * En desarrollo apunta a Mailpit, que acepta cualquier cosa y muestra los
 * mensajes en su interfaz sin enviarlos a nadie: es lo que permite comprobar el
 * correo de verificacion de punta a punta sin escribirle a una direccion real
 * -que ademas serian datos de un menor-.
 *
 * En produccion vale igual contra un relevo transaccional. Si se cambia de
 * proveedor a una API HTTP, lo que hay que escribir es otro `MailSender`, no
 * tocar los casos de uso: ese es el motivo de que el puerto exista.
 *
 * **El pool esta activado a proposito.** Sin el, cada correo abre una conexion
 * SMTP nueva con su saludo y su negociacion TLS. En el arranque de un curso, con
 * un colegio entero registrandose la misma manana, eso es un handshake por
 * alumno y el proveedor empieza a limitar por tasa.
 */
export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user
        ? { auth: { user: options.user, pass: options.password ?? '' } }
        : {}),
      pool: true,
      maxConnections: 5,
      // Un SMTP que no responde en diez segundos no va a responder: mantener la
      // peticion viva solo consume una conexion del pool y retrasa el reintento,
      // que es lo que de verdad va a entregar el mensaje.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutgoingEmail): Promise<{ ref: string | null }> {
    try {
      const info = await this.transporter.sendMail({
        from: this.options.from,
        to: email.to,
        subject: email.subject,
        // Los dos cuerpos SIEMPRE. Hay filtros de correo de colegio que
        // eliminan el HTML, y un mensaje que en ellos llega en blanco equivale a
        // no haberlo enviado.
        text: email.text,
        html: email.html,
      });

      return { ref: info.messageId ?? null };
    } catch (error) {
      // El destinatario NO va en el error: se registra en logs que se exportan a
      // un agregador, y es un dato personal de un menor.
      throw new ServiceUnavailableError(
        'MAIL_DELIVERY_FAILED',
        'No se pudo entregar el correo al servidor de salida.',
        { reason: error instanceof Error ? error.message.slice(0, 200) : 'desconocido' },
      );
    }
  }
}
