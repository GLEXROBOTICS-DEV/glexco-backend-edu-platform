#!/usr/bin/env node
/**
 * Auditoria de accesibilidad sobre el HTML QUE SIRVE EL SERVIDOR.
 *
 * No es un analizador de codigo: pide las paginas al portal en marcha y revisa
 * lo que llega al navegador. La diferencia importa, porque los fallos de
 * accesibilidad casi nunca estan en el JSX que se lee -ahi todo parece
 * correcto-, sino en lo que sale despues: un icono sin texto que solo se nota
 * cuando el nombre viene vacio, una etiqueta que era un `placeholder`, una
 * tabla sin `<th>` porque se genera en un bucle.
 *
 * Lo que comprueba son las reglas de WCAG 2.1 AA que se pueden verificar sin
 * mirar la pantalla. Lo que NO puede comprobar -y hay que mirar a mano- es el
 * contraste real, el orden de tabulacion y si el texto tiene sentido. Eso queda
 * dicho aqui para que nadie lea "0 hallazgos" como "es accesible".
 *
 *   node infra/scripts/a11y-check.mjs            # contra localhost:3010
 *   WEB_URL=... GLEXCO_TOKEN=... node infra/scripts/a11y-check.mjs
 */

const WEB = process.env.WEB_URL ?? 'http://localhost:3010';
const TOKEN = process.env.GLEXCO_TOKEN ?? '';

/** Publicas primero: son las unicas que se pueden comprobar sin sesion. */
const PUBLICAS = ['/ingresar', '/registro', '/recuperar'];
const PRIVADAS = [
  '/discover',
  '/discover/kits',
  '/discover/logros',
  '/discover/progreso',
  '/discover/biblioteca',
  '/discover/evaluaciones',
  '/discover/muro',
  '/discover/anuncios',
  '/discover/cuenta',
  '/discover/laboratorio',
];

const hallazgos = [];
const anota = (regla, pagina, detalle = '') => hallazgos.push({ regla, pagina, detalle });

const sinScripts = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '');

function revisar(pagina, bruto) {
  const html = sinScripts(bruto);

  // 1.3.1 Info y relaciones: un solo `h1`, sin saltos de nivel.
  const h1 = html.match(/<h1\b/g) ?? [];
  if (h1.length === 0) anota('sin h1', pagina);
  if (h1.length > 1) anota('mas de un h1', pagina, String(h1.length));

  const niveles = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  for (let i = 1; i < niveles.length; i += 1) {
    if (niveles[i] > niveles[i - 1] + 1) {
      anota('salto de nivel de encabezado', pagina, `h${niveles[i - 1]} -> h${niveles[i]}`);
      break;
    }
  }

  // 1.1.1 Contenido no textual.
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
    if (!img.includes('alt=')) anota('img sin alt', pagina, img.slice(0, 70));
  }

  // 2.4.4 y 4.1.2: todo control con nombre accesible.
  for (const etiqueta of ['button', 'a']) {
    const re = new RegExp(`<${etiqueta}\b([^>]*)>([\s\S]*?)</${etiqueta}>`, 'g');
    for (const m of html.matchAll(re)) {
      const [, atributos, dentro] = m;
      if (etiqueta === 'a' && !atributos.includes('href')) continue;
      if (dentro.replace(/<[^>]+>/g, '').trim()) continue;
      if (/aria-label(ledby)?=/.test(atributos)) continue;
      if (dentro.includes('sr-only')) continue;
      anota(`<${etiqueta}> sin nombre accesible`, pagina, (atributos || dentro).slice(0, 60).trim());
    }
  }

  // 3.3.2 Etiquetas: un `placeholder` NO es una etiqueta.
  for (const campo of html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []) {
    if (/type="(hidden|submit|button)"/.test(campo)) continue;
    if (/aria-label(ledby)?=|\sid=/.test(campo)) continue;
    const antes = html.slice(Math.max(0, html.indexOf(campo) - 400), html.indexOf(campo));
    if (!antes.includes('<label')) anota('campo sin etiqueta', pagina, campo.slice(0, 70));
  }

  // 1.3.1 en tablas.
  for (const tabla of html.match(/<table\b[\s\S]*?<\/table>/g) ?? []) {
    if (!tabla.includes('<th')) anota('tabla sin <th>', pagina);
    if (!tabla.includes('<caption')) anota('tabla sin <caption>', pagina);
  }

  // 3.1.1 Idioma de la pagina.
  if (!/<html[^>]*\slang="[a-z]{2}"/.test(bruto)) anota('sin lang en <html>', pagina);

  // 2.4.1 Saltar bloques: landmark principal.
  if (!html.includes('<main') && !html.includes('role="main"')) anota('sin <main>', pagina);
}

async function pedir(ruta, conSesion) {
  const respuesta = await fetch(`${WEB}${ruta}`, {
    headers: conSesion && TOKEN ? { cookie: `glexco_at=${TOKEN}` } : {},
    redirect: 'manual',
  });

  // Una redireccion no es un fallo de accesibilidad: es que no hay sesion. Se
  // dice, en vez de auditar una pagina de error y reportar diez hallazgos que no
  // existen -que es lo que pasaba al auditar con el token caducado-.
  if (respuesta.status >= 300 && respuesta.status < 400) return null;
  return respuesta.text();
}

const rutas = [
  ...PUBLICAS.map((r) => [r, false]),
  ...(TOKEN ? PRIVADAS.map((r) => [r, true]) : []),
];

let revisadas = 0;
for (const [ruta, conSesion] of rutas) {
  const html = await pedir(ruta, conSesion);
  if (html === null) {
    console.log(`  omitida (redirige)  ${ruta}`);
    continue;
  }
  revisar(ruta, html);
  revisadas += 1;
}

console.log(`\nAccesibilidad: ${revisadas} pantallas revisadas`);

if (!TOKEN) {
  console.log('  (sin GLEXCO_TOKEN solo se revisan las publicas)');
}

if (hallazgos.length === 0) {
  console.log('  Sin hallazgos automaticos.');
  console.log('  Queda por revisar A MANO: contraste real, orden de tabulacion');
  console.log('  y si los textos alternativos dicen algo util.');
  process.exit(0);
}

const porRegla = new Map();
for (const h of hallazgos) porRegla.set(h.regla, [...(porRegla.get(h.regla) ?? []), h]);

for (const [regla, casos] of [...porRegla].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  [${casos.length}] ${regla}`);
  for (const caso of casos.slice(0, 5)) {
    console.log(`     ${caso.pagina}${caso.detalle ? `  ->  ${caso.detalle}` : ''}`);
  }
  if (casos.length > 5) console.log(`     ... y ${casos.length - 5} mas`);
}

process.exit(1);
