/**
 * Plantillas de los correos de cuenta.
 *
 * **Cada correo lleva SIEMPRE su version en texto plano.** No es un extra de
 * cortesia: hay filtros de correo de colegio que eliminan el HTML, y un mensaje
 * que en ellos llega en blanco equivale a no haberlo enviado. Es exactamente el
 * caso de uso de esta plataforma.
 *
 * El HTML es deliberadamente pobre —tablas no, imagenes no, tipografias remotas
 * no—. Un cliente de correo no es un navegador: lo que se ve bien en el
 * previsualizador se descuadra en Outlook 2016, que es lo que hay instalado en
 * la sala de profesores. Un mensaje sobrio se ve igual en todos.
 *
 * Y no se incrusta ningun logo remoto: la mayoria de clientes bloquean las
 * imagenes externas por defecto, asi que la marca no se veria, y cargarlas
 * delata al remitente cuando y donde se abrio el mensaje.
 */

export interface EmailTemplateInput {
  firstName: string;
  url: string;
  ttlSeconds: number;
  portalUrl: string;
}

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

export function verificationEmail(input: EmailTemplateInput): EmailMessage {
  const vigencia = describeTtl(input.ttlSeconds);

  const text = [
    `Hola ${input.firstName},`,
    '',
    'Tu cuenta de GLEXCO ya esta creada. Confirma tu correo abriendo este enlace:',
    '',
    input.url,
    '',
    `El enlace vale ${vigencia}. Si caduca, puedes pedir otro desde la pantalla de ingreso.`,
    '',
    'Si no creaste esta cuenta, ignora este mensaje: sin abrir el enlace no se confirma nada.',
    '',
    'GLEXCO · Robotica educativa',
  ].join('\n');

  return {
    subject: 'Confirma tu cuenta de GLEXCO',
    text,
    html: layout({
      heading: `Hola ${escapeHtml(input.firstName)}`,
      lead: 'Tu cuenta de GLEXCO ya está creada. Solo falta confirmar tu correo.',
      cta: { label: 'Confirmar mi correo', url: input.url },
      note: `El enlace vale ${vigencia}. Si caduca, puedes pedir otro desde la pantalla de ingreso.`,
      footer:
        'Si no creaste esta cuenta, ignora este mensaje: sin abrir el enlace no se confirma nada.',
    }),
  };
}

export function passwordResetEmail(input: EmailTemplateInput): EmailMessage {
  const vigencia = describeTtl(input.ttlSeconds);

  const text = [
    `Hola ${input.firstName},`,
    '',
    'Pediste cambiar tu contrasena de GLEXCO. Abre este enlace para elegir una nueva:',
    '',
    input.url,
    '',
    `El enlace vale ${vigencia} y solo sirve una vez.`,
    '',
    'Si no lo pediste tu, NO abras el enlace: tu contrasena actual sigue funcionando y',
    'nadie puede cambiarla sin este mensaje. Avisa a tu docente o a soporte.',
    '',
    'GLEXCO · Robotica educativa',
  ].join('\n');

  return {
    subject: 'Cambia tu contraseña de GLEXCO',
    text,
    html: layout({
      heading: `Hola ${escapeHtml(input.firstName)}`,
      lead: 'Pediste cambiar tu contraseña. Elige una nueva desde aquí.',
      cta: { label: 'Elegir una contraseña nueva', url: input.url },
      note: `El enlace vale ${vigencia} y solo sirve una vez.`,
      // El aviso de "no fuiste tu" es la parte MAS importante de este correo, no
      // el pie: es la unica senal que recibe la victima de un intento de robo de
      // cuenta, y tiene que decir claramente que no hay que hacer nada.
      footer:
        'Si no lo pediste tú, no abras el enlace: tu contraseña actual sigue funcionando y nadie puede cambiarla sin este mensaje. Avisa a tu docente o a soporte.',
    }),
  };
}

function describeTtl(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.round(seconds / 86_400);
    return days === 1 ? 'un día' : `${days} días`;
  }
  const hours = Math.max(1, Math.round(seconds / 3600));
  return hours === 1 ? 'una hora' : `${hours} horas`;
}

function layout(input: {
  heading: string;
  lead: string;
  cta: { label: string; url: string };
  note: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f7f9fb;font-family:'Segoe UI',system-ui,sans-serif;color:#1b2a38">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4eaf0;border-radius:12px;padding:28px">
    <p style="margin:0 0 20px;font-size:20px;font-weight:700;color:#2c53a0">GLEXCO</p>
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:600">${input.heading}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">${input.lead}</p>
    <p style="margin:0 0 20px">
      <a href="${input.cta.url}" style="display:inline-block;background:#2c53a0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:15px">${input.cta.label}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#5a6b7c">${input.note}</p>
    <!-- El enlace tambien en texto: hay clientes que no muestran el boton, y
         entonces esta linea es la unica forma de completar el proceso. -->
    <p style="margin:0 0 20px;font-size:12px;color:#5a6b7c;word-break:break-all">${input.cta.url}</p>
    <hr style="border:0;border-top:1px solid #e4eaf0;margin:20px 0">
    <p style="margin:0;font-size:13px;line-height:1.5;color:#5a6b7c">${input.footer}</p>
  </div>
</body>
</html>`;
}

/**
 * Escapa el nombre antes de meterlo en el HTML.
 *
 * El nombre lo escribe el propio usuario en el formulario de alta. Sin escapar,
 * un nombre con `<` rompe la maquetacion del mensaje —y en un cliente de correo
 * permisivo, algo peor—. El esquema de nombres ya rechaza los simbolos raros,
 * pero esa validacion vive en otro servicio y podria relajarse sin que nadie se
 * acuerde de este archivo.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
