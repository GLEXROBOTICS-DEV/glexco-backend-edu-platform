/**
 * Convierte duraciones legibles ("15m", "30d") a milisegundos.
 *
 * Se implementa aqui en vez de traer la dependencia `ms` porque son quince
 * lineas, evita una dependencia transitiva mas en cada servicio y nos permite
 * fallar con un error explicito en vez de devolver `undefined` silenciosamente.
 */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function durationToMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) throw new TypeError(`Duracion invalida: "${input}". Ejemplos validos: 900s, 15m, 30d`);
  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof UNIT_MS;
  return amount * UNIT_MS[unit]!;
}

export const durationToSeconds = (input: string): number => Math.floor(durationToMs(input) / 1000);
