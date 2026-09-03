/**
 * Puertos de engagement.
 *
 * El dominio y los casos de uso dependen de estas interfaces y nunca de
 * nodemailer, de pg ni de fetch. Cambiar de proveedor de correo —de SMTP a un
 * servicio transaccional— es escribir otro adaptador, no tocar una regla.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Cuerpo en texto plano. Obligatorio, no opcional: hay clientes de correo
   *  escolares que bloquean el HTML, y un mensaje que en ellos llega en blanco
   *  equivale a no haberlo enviado. */
  text: string;
  html: string;
}

export interface MailSender {
  /** Devuelve la referencia del proveedor cuando la hay, para poder rastrear un
   *  envio concreto en su panel al investigar una queja. */
  send(email: OutgoingEmail): Promise<{ ref: string | null }>;
}

/**
 * Acuna el enlace de un solo uso contra identidad, justo antes de enviar.
 *
 * **Es el motivo por el que el token no viaja en el evento.** Un evento vive
 * dias en la outbox y en el stream; un token de recuperacion escrito ahi
 * convierte el acceso de lectura a una tabla —o a una copia de seguridad— en el
 * control de cualquier cuenta. Aqui el secreto cruza la red una vez, entre dos
 * servicios internos, y no queda escrito en ningun registro duradero.
 */
export interface OneTimeTokenIssuer {
  issue(input: {
    userId: string;
    purpose: 'email_verification' | 'password_reset';
  }): Promise<{ token: string; ttlSeconds: number } | null>;
}

export interface EmailDeliveryLog {
  record(entry: {
    id: string;
    userId: string;
    kind: string;
    recipient: string;
    locale: string;
    status: 'sent' | 'failed';
    failureReason?: string | null;
    providerRef?: string | null;
  }): Promise<void>;
}
