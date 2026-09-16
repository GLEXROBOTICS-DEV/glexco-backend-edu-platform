#!/usr/bin/env node
/**
 * Estado de la traduccion del portal.
 *
 * Nace de una equivocacion concreta: se dio por terminada la i18n despues de
 * traducir cinco formularios, y quedaban mas de doscientos textos a la vista en
 * setenta ficheros. No se sabia porque **nadie lo estaba contando**: la unica
 * comprobacion que existia miraba que los espacios de cliente viajaran al
 * navegador, no que las pantallas estuvieran traducidas.
 *
 * Comprueba tres cosas distintas y solo las dos primeras rompen la build:
 *
 *  1. **Paridad.** Las mismas claves en `es` y en `en`, ninguna vacia y ninguna
 *     identica en los dos idiomas si es una frase -eso es una traduccion que se
 *     olvido, no una coincidencia-.
 *  2. **Claves muertas.** Una clave que ya no usa nadie es una frase que alguien
 *     mantendra y traducira para siempre sin que se vea en ninguna pantalla.
 *  3. **Texto sin traducir**, contra un TECHO. No falla por lo que ya hay -son
 *     cientos y arreglarlos de golpe no es realista-, falla si el numero SUBE:
 *     lo que se protege es que no entre texto nuevo en espanol.
 *
 * Uso:  node infra/scripts/i18n-check.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = 'apps/web/src';
const MENSAJES = join(WEB, 'messages');

/**
 * Techo de textos sin traducir.
 *
 * Es una deuda reconocida, no un objetivo: baja cada vez que se traduce una
 * pantalla y **nunca se sube**. Si esta comprobacion se pone roja porque el
 * numero crecio, lo que hay que hacer es traducir el texto nuevo, no tocar este
 * numero. Bajarlo al traducir es obligatorio: si no, el techo deja de proteger.
 */
const TECHO = 203;

const colors = {
  ok: '\x1b[32m',
  fail: '\x1b[31m',
  warn: '\x1b[33m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

let fallos = 0;

function report(nombre, ok, detalle = '') {
  console.log(
    `  ${ok ? colors.ok + 'PASA' : colors.fail + 'FALLA'}${colors.reset}  ${nombre}`,
  );
  if (!ok) {
    fallos += 1;
    if (detalle) console.log(`        ${colors.dim}${detalle}${colors.reset}`);
  }
}

function aplanar(nodo, prefijo = '') {
  const salida = {};
  for (const [clave, valor] of Object.entries(nodo)) {
    if (valor && typeof valor === 'object') Object.assign(salida, aplanar(valor, `${prefijo}${clave}.`));
    else salida[`${prefijo}${clave}`] = valor;
  }
  return salida;
}

function ficherosDe(raiz, extensiones) {
  const salida = [];
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) {
        if (entrada !== 'messages') recorrer(ruta);
      } else if (extensiones.some((ext) => ruta.endsWith(ext))) {
        salida.push(ruta);
      }
    }
  };
  recorrer(raiz);
  return salida;
}

/** El fichero sin sus comentarios: de bloque, de linea y de JSX. */
function sinComentarios(texto) {
  return texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const ACENTO = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
const PALABRA = /[A-Za-záéíóúñÁÉÍÓÚÑ]{3,}/g;
/** Siglas y nombres propios que son iguales en los dos idiomas. */
const INVARIANTE = /^(GLEXCO|XP|STEM|PDF|CSV|QR|SVG|HTML|Discover|Academy|Kit)[\s·]*$/;

/** Atributos cuyo valor LO VE alguien, o lo lee un lector de pantalla. */
const ATRIBUTOS = [
  'title',
  'label',
  'aria-label',
  'placeholder',
  'alt',
  'toneLabel',
  'emptyMessage',
  'description',
  'hint',
  'subtitle',
  'pendingLabel',
  'caption',
];

/**
 * Si esto es una frase para una persona, y no codigo.
 *
 * Pide dos palabras de tres letras, o una sola con acento. Sin ese minimo
 * entran los nombres de clase de Tailwind, los identificadores y los simbolos.
 */
function esProsa(valor) {
  const v = valor.trim();
  if (!v || INVARIANTE.test(v)) return false;
  if (/^(https?:|\/|#|var\(|--|\$\{)/.test(v)) return false;
  const palabras = v.match(PALABRA) ?? [];
  return palabras.length >= 2 || (palabras.length === 1 && ACENTO.test(v));
}

function main() {
  console.log(`${colors.bold}Estado de la traduccion del portal${colors.reset}`);

  // ------------------------------------------------------------------
  console.log(`\n${colors.bold}1. Paridad entre es y en${colors.reset}`);
  // ------------------------------------------------------------------
  const es = aplanar(JSON.parse(readFileSync(join(MENSAJES, 'es.json'), 'utf8')));
  const en = aplanar(JSON.parse(readFileSync(join(MENSAJES, 'en.json'), 'utf8')));

  const soloEs = Object.keys(es).filter((k) => !(k in en));
  const soloEn = Object.keys(en).filter((k) => !(k in es));
  report(
    `Las mismas claves en los dos idiomas (${Object.keys(es).length})`,
    soloEs.length === 0 && soloEn.length === 0,
    [...soloEs.map((k) => `falta en en: ${k}`), ...soloEn.map((k) => `falta en es: ${k}`)]
      .slice(0, 10)
      .join(', '),
  );

  const vacias = [...Object.entries(es), ...Object.entries(en)]
    .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    .map(([k]) => k);
  report('Ninguna clave vacia', vacias.length === 0, vacias.slice(0, 10).join(', '));

  // Una frase larga identica en los dos idiomas es una traduccion pendiente.
  // Se pide longitud para no marcar "Kit", "Discover" o un numero.
  const sinTraducir = Object.keys(es).filter(
    (k) => k in en && es[k] === en[k] && typeof es[k] === 'string' && es[k].length > 18,
  );
  report(
    'Ninguna frase larga quedo identica en los dos idiomas',
    sinTraducir.length === 0,
    sinTraducir.slice(0, 10).join(', '),
  );

  // ------------------------------------------------------------------
  console.log(`\n${colors.bold}2. Claves que ya no usa nadie${colors.reset}`);
  // ------------------------------------------------------------------
  const codigo = ficherosDe(WEB, ['.ts', '.tsx'])
    .map((ruta) => readFileSync(ruta, 'utf8'))
    .join('\n');

  // Hay claves que se leen CALCULADAS y de las que no existe ningun literal que
  // buscar. Son tres formas, y hay que reconocer las tres o esta comprobacion
  // pide borrar los trece grados, los cinco niveles y los quince pasos de la
  // visita guiada, que es justo lo contrario de lo que habria que hacer:
  //
  //   safeLabel(vocab, 'grados', kit.grade)   -> todo el espacio `grados`
  //   t('niveles.' + level)  |  t(`objetivo.${kind}`)  -> prefijo
  //   t(`${spec.key}.cuerpo`)                          -> sufijo
  const espaciosDinamicos = new Set(
    [...codigo.matchAll(/safeLabel\(\s*\w+\s*,\s*'([a-zA-Z]+)'/g)].map((m) => m[1]),
  );
  const prefijos = [
    ...codigo.matchAll(/\bt\(\s*'([a-zA-Z.]+)\.'\s*\+/g),
    ...codigo.matchAll(/\bt\(\s*`([a-zA-Z.]+)\.\$\{/g),
  ].map((m) => m[1]);
  const sufijos = [...codigo.matchAll(/\bt\(\s*`\$\{[^`]*?\}\.([a-zA-Z]+)`/g)].map((m) => m[1]);

  const seLeeCalculada = (clave) =>
    prefijos.some((p) => clave === p || clave.includes(`${p}.`)) ||
    sufijos.some((s) => clave.endsWith(`.${s}`));

  // Se busca la ULTIMA parte de la clave entrecomillada: `t('miClave')` dentro
  // de un espacio, y tambien `'espacio.miClave'` para una lectura directa.
  const muertas = Object.keys(es).filter((clave) => {
    const corte = clave.lastIndexOf('.');
    const espacio = corte < 0 ? '' : clave.slice(0, corte);
    if (espaciosDinamicos.has(espacio) || seLeeCalculada(clave)) return false;
    const hoja = clave.slice(corte + 1);
    return !codigo.includes(`'${hoja}'`) && !codigo.includes(`'${clave}'`);
  });
  report(
    `Toda clave del catalogo se usa en alguna pantalla`,
    muertas.length === 0,
    muertas.length === 0 ? '' : `${muertas.length} sin usar: ${muertas.slice(0, 12).join(', ')}`,
  );

  // ------------------------------------------------------------------
  console.log(`\n${colors.bold}3. Texto a la vista todavia sin traducir${colors.reset}`);
  // ------------------------------------------------------------------
  const porFichero = new Map();

  for (const ruta of ficherosDe(WEB, ['.tsx'])) {
    const texto = sinComentarios(readFileSync(ruta, 'utf8'));
    const hallados = [];

    // Texto suelto entre etiquetas.
    for (const m of texto.matchAll(/>([^<>{}]+)</g)) {
      const v = m[1].split(/\s+/).join(' ').trim();
      if (esProsa(v)) hallados.push(v);
    }
    // Atributos que se ven.
    for (const atributo of ATRIBUTOS) {
      for (const m of texto.matchAll(new RegExp(`${atributo}="([^"]+)"`, 'g'))) {
        if (esProsa(m[1])) hallados.push(`${atributo}="${m[1]}"`);
      }
    }
    // Literales dentro de un ternario del JSX: `cond ? 'Texto' : 'Otro'`.
    for (const m of texto.matchAll(/[?:]\s*'([^']{8,})'/g)) {
      if (esProsa(m[1])) hallados.push(m[1]);
    }

    if (hallados.length > 0) porFichero.set(ruta, hallados);
  }

  const total = [...porFichero.values()].reduce((suma, lista) => suma + lista.length, 0);

  const peores = [...porFichero.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  for (const [ruta, lista] of peores) {
    console.log(`  ${colors.dim}${String(lista.length).padStart(3)}  ${ruta}${colors.reset}`);
  }

  console.log(
    `\n  ${total} textos en ${porFichero.size} ficheros ${colors.dim}(techo: ${TECHO})${colors.reset}`,
  );
  report(
    `No entro texto nuevo sin traducir`,
    total <= TECHO,
    `subio de ${TECHO} a ${total}: traduce el texto nuevo, no subas el techo`,
  );

  if (total < TECHO) {
    console.log(
      `  ${colors.warn}El techo se puede bajar a ${total} en infra/scripts/i18n-check.mjs${colors.reset}`,
    );
  }

  // ------------------------------------------------------------------
  console.log(
    `\n${colors.bold}Resultado:${colors.reset} ${
      fallos === 0 ? `${colors.ok}todo en orden${colors.reset}` : `${colors.fail}${fallos} fallan${colors.reset}`
    }`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main();
