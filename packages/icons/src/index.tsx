import type { SVGProps } from 'react';

/**
 * Iconografia propia de GLEXCO.
 *
 * Existe por peticion expresa del cliente: los sets genericos hacen que una
 * plataforma de robotica se parezca a cualquier otro producto. Aqui solo viven
 * los iconos que son *del dominio* -robots, insignias, niveles, kits-. El cromo
 * de interfaz (flechas, cerrar, buscar) sigue viniendo de Lucide, porque
 * redibujar una lupa no aporta nada y si resta consistencia.
 *
 * Reglas comunes a todos:
 *
 * - Lienzo de 24x24 y `stroke` de 1.75, para que casen visualmente con Lucide
 *   cuando aparecen en la misma barra.
 * - `currentColor` siempre: el color lo decide el contexto, nunca el icono. Un
 *   icono con color fijo se ve mal en modo oscuro y obliga a duplicarlo.
 * - `aria-hidden` por defecto. Un icono decorativo junto a su etiqueta leido en
 *   voz alta duplica la informacion; cuando el icono es la unica etiqueta, quien
 *   lo usa pasa `title` y deja de estar oculto.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Tamano en pixeles. Por defecto 24, que es el lienzo nativo. */
  size?: number;
  /** Texto accesible. Si se indica, el icono deja de ser decorativo. */
  title?: string;
}

function Icon({ size = 24, title, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/** Robot de kit: la unidad que el alumno construye. */
export function RobotIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3" r="1.25" />
      <circle cx="9" cy="13" r="1.15" />
      <circle cx="15" cy="13" r="1.15" />
      <path d="M9.5 17h5" />
      <path d="M1.5 12v4M22.5 12v4" />
    </Icon>
  );
}

/** Kit: la caja que se compra, un libro y su robot. */
export function KitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z" />
      <path d="M3 8.5 12 13l9-4.5" />
      <path d="M12 13v7" />
      <path d="M7.5 6.2 16.5 10.8" />
    </Icon>
  );
}

/** Insignia de logro. */
export function BadgeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="9.5" r="5.5" />
      <path d="m8.5 14.2-1.4 6.3 4.9-2.6 4.9 2.6-1.4-6.3" />
      <path d="m12 7 1.1 2.2 2.4.35-1.75 1.7.41 2.4L12 12.5l-2.16 1.15.41-2.4-1.75-1.7 2.4-.35z" />
    </Icon>
  );
}

/** Nivel del Explorador: progreso por escalones. */
export function LevelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V14h4.5v6" />
      <path d="M9.75 20V9.5h4.5V20" />
      <path d="M15.5 20V5h4.5v15" />
      <path d="M3 20h18" />
    </Icon>
  );
}

/** Reto o desafio de construccion. */
export function ChallengeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 14.6 9l6 .9-4.35 4.2 1.03 5.9L12 17.2 6.72 20l1.03-5.9L3.4 9.9l6-.9z" />
    </Icon>
  );
}

/** Codigo de activacion del libro. */
export function ActivationCodeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10v4M9 10v4M12.5 10v4M16 10v4M19 10v4" />
    </Icon>
  );
}

/** Salon de clase. */
export function ClassroomIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
      <path d="M7 12v4.5c0 1.4 2.24 2.5 5 2.5s5-1.1 5-2.5V12" />
      <path d="M21 9.5V15" />
    </Icon>
  );
}

/** Certificado emitido. */
export function CertificateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 8h10M7 11.5h5" />
      <circle cx="16.5" cy="17.5" r="2.5" />
      <path d="m14.9 19.6-.9 2.4 2.5-1.1 2.5 1.1-.9-2.4" />
    </Icon>
  );
}

/** Biblioteca multimedia del kit. */
export function LibraryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5v14M8 5v14" />
      <rect x="11.5" y="5" width="4" height="14" rx="1" />
      <path d="m17.8 6.2 3.2 12.1-1.9.5-3.2-12.1z" />
    </Icon>
  );
}
