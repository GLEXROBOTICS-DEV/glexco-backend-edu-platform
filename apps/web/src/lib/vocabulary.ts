/**
 * Vocabulario visible: las etiquetas que traducen una clave del backend.
 *
 * Vive aparte de `catalog.ts` porque ese modulo es `server-only` -habla con la
 * API con la cookie de sesion- y estas funciones son **puras**: reciben la `t`
 * que ya tiene quien llama y devuelven texto. Al quedarse alli, el formulario de
 * alta de salon -que es de cliente- no podia usarlas y acabo con su propia tabla
 * de los trece grados escrita a mano, que se quedo atras en cuanto el contrato
 * cambio.
 *
 * `catalog.ts` las reexporta, asi que las pantallas de servidor que ya las
 * importaban de alli siguen funcionando igual.
 */

/**
 * Traduce una clave de vocabulario sin reventar si no existe.
 *
 * `t()` de next-intl LANZA cuando la clave falta, asi que un tipo de contenido
 * nuevo en el backend tumbaria la pantalla entera de la biblioteca en vez de
 * mostrar una etiqueta fea. Aqui se prefiere la etiqueta fea: el alumno ve su
 * material y quien mantenga esto ve la clave sin traducir.
 */
export function safeLabel(t: (key: string) => string, space: string, key: string): string {
  if (!key) return '';
  try {
    return t(space + '.' + key);
  } catch {
    return key;
  }
}

/**
 * Grado en texto legible.
 *
 * El backend guarda la clave estable (`primary_3`) y la pantalla la traduce, por
 * lo mismo que los tipos de contenido: son vocabulario visible y cambian con el
 * idioma del usuario, no con el del dominio.
 */
export function gradeLabel(t: (key: string) => string, grade: string): string {
  return safeLabel(t, 'grados', grade);
}

/**
 * Tipo de contenido en texto legible.
 *
 * El vocabulario vive en `messages/*.json` bajo `tiposContenido`, con la MISMA
 * clave que guarda el backend. Si llega un tipo nuevo que nadie ha traducido, se
 * devuelve la clave cruda -"code_sample"- y eso se ve; con un `??` a un mapa en
 * espanol no se veria nada raro y se quedaria asi para siempre.
 */
export function contentTypeLabel(t: (key: string) => string, type: string): string {
  return safeLabel(t, 'tiposContenido', type);
}

/** Duracion en minutos y segundos. `null` cuando el recurso no dura nada -un
 *  PDF-, que no es lo mismo que durar cero. */
export function durationLabel(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Tamano legible. Se usa base 1024 porque es lo que informa el sistema
 *  operativo al descargar, y una cifra distinta genera dudas. */
export function sizeLabel(bytes: number | null): string | null {
  if (bytes === null || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
