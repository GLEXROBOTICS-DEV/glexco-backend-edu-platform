# Bitácora de trabajo

Registro por sesión: **qué se hizo**, **por qué**, **qué falta**. Es el documento
que debe leer primero cualquier instancia de Claude que retome el proyecto.

Entradas en orden cronológico inverso (lo más reciente arriba).

---

## Sesión 14 — 2026-09-04 — Certificados, y lo que el backend hacía sin que nadie llegara

El patrón de la sesión, y conviene leerlo antes de seguir: **casi todo lo que
faltaba estaba construido en el backend y no tenía pantalla delante.** Endpoints
terminados hace fases enteras a los que no llegaba ningún sitio del portal.

### 1. Lo que ya existía y no se podía usar

- **Crear un salón.** El estado vacío enlazaba a `/docentes/salones/nuevo` desde
  el principio y esa ruta daba 404: ni dirección ni docentes podían crear
  ninguno, los salones solo entraban por el sembrador. El permiso y el endpoint
  estaban desde la Fase 2.
- **La lista de alumnos de un salón y la ficha individual de cada alumno.**
  `GET /analytics/classrooms/{c}/students/{s}` llevaba fases construido, con su
  doble comprobación de alcance, sin que nada lo llamara. La lista va **antes**
  de las cifras: la pregunta que se hace un docente tras ver que la mitad va mal
  es siempre «¿quién?».
- **Mi cuenta**: `/account/password` y `/account/sessions`, meses construidos y
  sin pantalla.
- **`listByStudent` de entregas** y **`listByInstitution` del directorio de
  docentes**, implementados y sin llamar.

### 2. Certificados (cierra lo grande de la Fase 6)

**Firma Ed25519, no un HMAC.** Con un HMAC, comprobar un certificado exige
conocer el secreto: el único que puede validarlo somos nosotros, y el documento
vale lo que valga nuestro servidor encendido. Con firma asimétrica cualquiera lo
verifica con la clave pública. Para un título que el alumno enseña fuera, esa
diferencia es el producto.

Se firma un **texto canónico**, nunca `JSON.stringify` del objeto: el orden de
las claves depende de cómo se construyó, y dos ejecuciones producirían dos
cadenas distintas del mismo certificado. La verificación **recomprueba la firma**
y no que la fila exista: si alguien con acceso a la base cambia un nombre, la
fila sigue ahí y sin eso la página diría que el documento es bueno.

La ruta de verificación es **pública**, y tiene que serlo: quien recibe un
certificado no tiene cuenta aquí. Devuelve solo lo que ya está impreso en el
papel que esa persona tiene delante.

### 3. Errores reales encontrados

1. **Entrar a una evaluación gastaba un intento.** El resultado solo vivía en el
   estado del formulario que lo acababa de calcular, así que recargar o volver
   abría otro intento. A los tres, la única respuesta era «ya agotaste tus
   intentos» sin haber respondido nada más. Ahora `/evaluaciones/{id}` es la
   pantalla de resultado, de lectura, y responder vive en `/responder`.
2. **La columna «kit» de la lista de clase decía «sin activar» para todos,
   siempre.** Nadie escuchaba `catalog.entitlement.granted` y el kit solo se
   anotaba al matricular, que ocurre antes del canje. Es la señal más útil que
   tiene un docente en las primeras semanas.
3. **El primer certificado emitido en producción salió a nombre de nadie.** El
   repositorio tenía escrito el comentario «sin nombre no se emite nada» y justo
   debajo un `?? ''`. Un comentario que describe una regla que el código no
   aplica es peor que no tenerlo.
4. **La serie del certificado, copiada sin guiones, no se encontraba.** El
   comentario decía que la serie «se teclea a mano cuando el QR no se deja
   escanear» y la comparación solo cubría la mitad de ese caso.
5. **En modo oscuro no se veía lo que escribías.** `.field` tenía el fondo
   `#ffffff` a mano y el texto en un token: campo blanco con letra clara encima.
   Se notó en el ingreso, el peor sitio posible.
6. **Añadí una tabla a una migración ya aplicada.** El ejecutor las marca por
   nombre de archivo, así que no se ejecutó nunca y el despliegue dijo que había
   ido bien. Anotado en CLAUDE.md §5.
7. El evento del lote de códigos se publicaba con `metadata` vacío, y el
   consumidor **enruta por `metadata.eventName`**: llegaba y se descartaba sin
   manejador y sin un solo error.

### 4. Diseño

**El modo oscuro no estaba hecho**, pese a tener un artboard entero en el canvas.
Ahora sí, con sus tres reglas: nunca negro puro, jerarquía por elevación y no por
borde, y los colores de marca aclarados. Y **visita guiada** que no arranca sola:
se abre desde la barra lateral y se puede reabrir siempre.

La interfaz **escala con la pantalla** a partir de 1600 px: el canvas se dibujó a
1440 y con la raíz clavada en 16 px un monitor de 27 pulgadas no enseñaba más
cosas, enseñaba las mismas en una columna estrecha en medio.

### 5. Evaluaciones: cierre y cronómetro

La **fecha límite se guardaba desde el principio y no la comprobaba nadie**, ni
había forma de ponerla: ninguna evaluación cerraba nunca. Ahora se configura al
crearla y el servidor la hace cumplir. Corta **abrir** un intento nuevo, no
terminar el que ya estaba abierto: cerrarle la puerta a quien está escribiendo,
por haber empezado tres minutos antes del cierre, sería castigarle por algo que
el propio sistema le dejó empezar.

**Y ahora hay cronómetro.** Había un comentario diciendo que no lo había a
propósito, para no meterle prisa a un niño con un número rojo bajando. El
argumento no era malo, pero dejaba el peor final posible: el alumno seguía
escribiendo tan tranquilo y lo perdía **todo** con un error al pulsar entregar.
Cuenta contra un instante absoluto que da el servidor —contando desde que carga
la página, recargar regalaría el tiempo entero, y es lo primero que prueba
cualquiera— y **entrega sola** al llegar a cero.

`datetime-local` da una hora SIN zona: se interpreta en la del navegador y se
manda en UTC. Sin eso, «cierra a las 23:59» se aplicaría a las 23:59 UTC, que en
Lima son las 18:59 del mismo día.

### 6. El fallo de rutas entre portales

El cliente acabó en rutas de Discover con una cuenta de Academy, y desde ahí todo
rompía. Dos capas:

- El enlace concreto: certificados enviaba a `/{portal}/cursos`, y en Discover se
  llama «mis kits» → 404.
- **Y lo de fondo: nada impedía estar en el portal ajeno.** El layout común solo
  comprobaba que hubiera sesión, no que el segmento de la URL fuera el suyo.
  Ahora cada segmento lo comprueba y **redirige**, que no da error: quien llega
  ahí no ha hecho nada mal, ha pulsado un enlace que le dimos nosotros.

### 7. El muro del salón

El cliente precisó qué quería al hablar de «mensajería»: **no son mensajes
privados**, es un tablón donde el alumno también pregunta y lo ven todos.

Además de ser mejor pedagógicamente, **es la opción más segura**: no se abre
ningún canal privado entre un adulto y un menor, y todo queda a la vista del
docente. Se levanta sobre los anuncios que ya existían, porque es lo mismo con
distinto autor.

Reglas que sostienen el modelo: **una pregunta no se puede fijar** —si no, el
muro sería una carrera por quedarse arriba—, **responde cualquiera del salón**
—que un compañero conteste también enseña, y al que contesta el que más—, y
preguntar exige estar **matriculado**, no solo tener el permiso.

Después se separó del muro de los anuncios en dos pantallas: un aviso hay que
verlo hoy y una conversación se sigue a lo largo de la semana; mezclados, el
aviso importante quedaba enterrado.

### 8. i18n, modo oscuro y visita guiada

**i18n montado sin enrutado por idioma.** El montaje por defecto de next-intl
antepone `/es/` y `/en/`; aquí el idioma ya era un atributo del usuario en
identidad —viaja con su perfil y lo usan los correos—, así que sacarlo también de
la URL daría dos fuentes para el mismo dato. Con sesión manda el perfil; sin
ella, la cookie del selector. Se añadió `POST /account/locale`: el agregado ya
sabía cambiarlo y no había forma de pedírselo.

**El modo oscuro no estaba hecho**, pese al artboard del canvas. Sus tres reglas:
nunca negro puro, jerarquía por elevación y no por borde, y la marca aclarada.
**Visita guiada** que no arranca sola.

### 9. La auditoría de accesibilidad (`pnpm a11y`)

Audita **el HTML que sirve el servidor**, no el código. La diferencia importa:
los fallos casi nunca están en el JSX que se lee. Destapó dos reales:

1. **El muro pedía los nombres a un endpoint de DOCENTES**, así que cualquier
   alumno veía el muro entero firmado por «un compañero» —lo contrario de lo que
   busca esa pantalla—. Ahora engagement devuelve el nombre en la misma consulta.
2. **El enlace a la cuenta se quedaba sin nombre accesible** cuando el nombre
   venía vacío, que pasa cuando identidad no responde y la sesión sigue con lo
   que da el token. **Los estados degradados son donde se rompe la
   accesibilidad**, y no se ven revisando la pantalla feliz.

El guion distingue una redirección de un fallo —auditar con un token caducado
producía diez hallazgos falsos— y dice en voz alta lo que NO puede comprobar
(contraste real, orden de tabulación, si el texto alternativo dice algo útil).

### 10. La señal que se repitió tres veces

Hizo falta un **directorio de nombres** en instituciones, en aprendizaje y en
engagement, y las tres veces hubo que rellenarlo a mano desde el sembrador porque
JetStream no reproduce hacia atrás. Con una vez es una chapuza puntual; con tres
es la prueba de que **falta el comando de reconstrucción de proyecciones**, y de
que va a costar otra chapuza por cada consumidor nuevo.

### Estado al cerrar

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 15/15 |
| `pnpm test` | **187** |
| `pnpm typecheck` | 21/21 |
| `pnpm a11y` | 13 pantallas, sin hallazgos |

**Fase 4 cerrada** salvo traducir el cuerpo de las pantallas, que es continuación
mecánica sobre la infraestructura de i18n ya montada.

### Qué falta

Ver la sección 5 de [TRASPASO.md](TRASPASO.md), que se actualizó con esto.

---

## Sesión 13 — 2026-09-03 — El portal adopta el canvas

El cliente abrió la plataforma desplegada y dijo, con razón, que **no seguía el
diseño**. Tenía razón: del canvas aprobado se había adoptado la paleta y las
fuentes, y nada más.

### Qué había pasado

El canvas (`design/canvas/`, diez artboards) se aprobó en la sesión 3. Sus
colores y tipografías entraron en `globals.css` esa misma sesión. **La
estructura no entró nunca.** Cada sesión posterior perseguía una capacidad
—registro, biblioteca, dashboards, despliegue— y ninguna tenía como objetivo
«que el marco sea el del canvas», así que las pantallas se montaron desde las
rutas hacia fuera con lo primero que funcionaba: barra superior blanca y una
columna centrada. El diseño quedó reducido a una lista de colores.

Nada avisaba de la deriva. Los artboards no se volvieron a abrir después de la
sesión que los creó; `design/` está además en `.dockerignore`, así que ni
siquiera viaja con la imagen.

**La señal más clara: el SVG del logotipo no estaba en `apps/web`.** La
plataforma escribía «GLEXCO» con la fuente de titulares porque la marca no
existía dentro del proyecto web —vivía solo en `design/`—. Un producto de marca
que no tiene su marca dentro es la prueba de que el diseño se trató como un
documento y no como la fuente que es.

### Qué se construyó

- **`app-shell.tsx`** — el marco de los cuatro portales: barra lateral de marca
  a la izquierda, contenido a la derecha. No es preferencia estética: con la
  navegación arriba, los destinos compiten por el ancho y hay que esconderlos en
  un menú en cuanto pasan de cinco; en vertical caben los ocho del panel de
  administración sin abreviar ninguno. El azul ocupando una columna hace además
  un trabajo que el texto no puede: quien tiene varios accesos sabe por el color
  del lateral si mira su colegio o toda la plataforma.
- **`sidebar-nav.tsx`** — único componente de cliente del marco, y solo porque
  marcar la sección activa necesita la ruta. Se renderiza en el servidor: sin
  JavaScript se pierde el resaltado, no la navegación.
- **`brand-panel.tsx`** — la mitad izquierda de las pantallas de acceso, con la
  retícula de circuito. Sustituye a un degradado de tres paradas que no salía
  del logo —el logo tiene dos— y competía con la marca en vez de sostenerla.
- **`portal-hero.tsx`** y **`continue-learning.tsx`** — la banda de bienvenida
  de Discover y la tarjeta de «continuar», que ocupa dos tercios porque es lo
  que el alumno viene a hacer nueve de cada diez veces.
- **Tokens completos** en `globals.css`: acento por portal, radios del canvas
  (6 px; 16 px en Discover), anchos y colores de la barra, y los cinco pares
  fondo/texto de estado.
- **`.btn` y `.field`** — había **doce** variantes del mismo botón primario, dos
  de ellas en la misma pantalla. Ahora hay un control: 46 px en formularios,
  36 px en barras de herramientas. 56 sustituciones sin tocar un solo elemento.

**Academy no lleva banda de bienvenida a propósito**, y esto viene del canvas: a
un estudiante de diecisiete años, una cabecera que le saluda por su nombre de
pila le habla como a un niño. Sus tres cifras eran tres guiones fijos —que se
leen como «no tienes ninguno», no como «esto no está hecho»— y ahora salen del
progreso real. Lo mismo en el panel del docente, que abría con la lista de
salones y ahora abre con las tres cifras con las que entra a trabajar.

### Errores encontrados

1. **Pasar los iconos como FUNCIÓN a un componente de cliente compila, pasa el
   typecheck y revienta en ejecución**, dejando la pantalla entera en blanco
   («Functions cannot be passed directly to Client Components»). Por esa
   frontera pasan datos y elementos, no funciones. Lo detectó renderizar la
   página de verdad, no compilarla: `pnpm build` daba éxito.
2. **`.field` con `height` fija aplastaba los `textarea`** a una línea. Es el
   riesgo de una clase de control compartida, y se resuelve con `min-height`.
3. **Cuatro destinos de la barra llevan a un 404** desde que existe la
   navegación: `/discover/kits`, `/discover/logros`, `/academy/cursos` y
   `/academy/certificaciones`. Se dejan porque quitarlos sería quitar
   funcionalidad prometida; hay que construir las pantallas.
4. Dos hallazgos de datos, no de diseño: el panel de plataforma muestra
   **«10 de 0 emitidos»** en códigos activados —la proyección cuenta canjes pero
   no emisiones—, y el sembrador dejó **salones y anuncios duplicados**.

### Qué falta del canvas

- **Modo oscuro.** Hay un artboard entero (`ModoOscuro.dc.html`) y no está
  implementado. Sus tres reglas no son «invertir los colores»: nunca negro puro
  (#12181F), la jerarquía por elevación en vez de por borde, y los colores de
  marca aclarados (#2C53A0 sobre el fondo oscuro da 1,8:1).
- Las composiciones de detalle: el escalonado de la ruta tecnológica en Academy,
  «Próximos retos» y «Logros recientes» en Discover —que dependen de pantallas
  que aún no existen— y el selector de idioma, que espera a la i18n.

---

## Sesión 12 — 2026-09-04 — Desplegado en Railway, con un colegio dentro

La plataforma dejó de ser algo que corre en una máquina. **Los quince servicios
están en línea en Railway con un colegio de demostración funcionando de punta a
punta**: se puede entrar por el navegador, ver un kit, responder una evaluación y
mirar el dashboard.

Direcciones y cuentas: **[ENTORNO-DEMO.md](ENTORNO-DEMO.md)**.
Cómo desplegar y qué trampas tiene Railway: **[DESPLIEGUE.md](DESPLIEGUE.md)**.

### 1. El empaquetado

**Un solo `Dockerfile` para los diez desplegables**, con `SERVICE` como
argumento. Diez ficheros casi idénticos serían diez sitios donde arreglar la
misma vulnerabilidad de la imagen base, y nueve se quedarían atrás.

**Docker y no el constructor de Railway**, porque el plan es Railway primero y
AWS o Huawei después: Nixpacks solo existe en Railway, y migrar significaría
reconstruir el empaquetado entero justo cuando hay tráfico real.

`pnpm deploy` en vez de `pnpm prune` —que no admite espacios de trabajo— bajó la
imagen de **1,05 GB a 392 MB**, y de paso quitó la comprobación de dependencias
de pnpm en ejecución, que intentaba escribir en `/app` y moría con `EACCES`.

### 2. Seis trampas de Railway, todas encontradas desplegando

Están documentadas en la sección 7 de DESPLIEGUE.md. Las dos peores:

- **Railway genera un `startCommand` al detectar el monorepo** que **anula el
  `ENTRYPOINT` de la imagen** y arranca pnpm en producción. Ponerlo a `null` no
  lo borra: se vuelve a derivar en el siguiente despliegue. Hay que fijarlo
  explícitamente.
- **Las watch paths que crea solas se saltan las construcciones en silencio**,
  con un `no changes detected` que parece un éxito. Un cambio en el `Dockerfile`
  o en `packages/` no disparaba nada.

Y una que no es de Railway sino de Windows: **git registra el punto de entrada
como `100644`**, así que en el contenedor llega sin permiso de ejecución. El
síntoma es el peor posible —«Starting Container» seguido de «Stopping Container»
**sin una sola línea de registro**—, porque falla antes de que haya nada que
escribir.

### 3. Lo que no se hace solo

**La base de datos no se prepara sola.** En local, `infra/docker/postgres/init/`
lo ejecuta el contenedor; en Railway ese directorio no existe. `bootstrap-db.mjs`
hace lo mismo contra cualquier Postgres gestionado, y corre **dentro** de la red
privada: exponer PostgreSQL a internet para lanzarlo una vez es un precio que no
hay que pagar.

**Las migraciones no estaban en la imagen.** Una imagen desde la que no se puede
migrar no sirve para desplegar.

### 4. El colegio de demostración

`seed-demo.mjs` crea un colegio entero: doce alumnos con contraseña real, tres
docentes, dirección, personal de GLEXCO, tres kits con sus cursos y lecciones,
noventa códigos, tres evaluaciones, doce entregas corregidas, progreso repartido
y anuncios.

**Personas y catálogo se escriben en la base; todo lo demás pasa por la API
real.** Darlos de alta por HTTP chocaría con los límites de fuerza bruta, que son
correctos. Pero matrículas, canjes, evaluaciones y progreso van por la API para
que los eventos se publiquen y las proyecciones se alimenten solas: sembrar esas
tablas a mano produciría dashboards que se ven bien y no se corresponden con
nada.

**La institución y los salones se crean por la API a propósito**, aunque el resto
de su bloque no. Es la única forma de que se publiquen `institution.created` y
`classroom.created`, y de esos eventos cuelgan cuatro directorios. Escribiendo la
fila a mano, el salón existe y a la vez no existe para media plataforma.

### Errores reales encontrados y corregidos

1. **Nadie emitía `course.published` ni `lesson.published`.** Estaban en el
   catálogo de eventos desde el principio y ningún servicio los publicaba, así
   que el directorio de `learning` no podía llenarse nunca: `locateLesson` no
   encontraba ninguna lección y **el progreso por contenido —con su XP, sus
   niveles y sus insignias— estaba muerto sin dar un solo error**. Se veía como
   «el alumno no ha completado nada». Ahora publicar un curso emite su evento
   **con las lecciones dentro**: trocearlo en un evento por lección dejaría al
   consumidor sin saber cuándo terminó la tanda, y el total —que es lo que
   permite decir «3 de 12»— estaría mal hasta que llegara el último.

2. **Canjear un segundo código del MISMO kit quemaba el código y después moría
   con un 500** contra `entitlements_student_kit_uq`. El alumno perdía un código
   —que vale dinero— a cambio de un error sin explicación. Y pasa más de lo que
   parece: el colegio reparte un código de repuesto, o la familia compra el libro
   sin saber que el centro ya lo dio. Ahora se comprueba **antes** de canjear y
   se responde con un conflicto claro, sin tocar el código. Comprobado que el
   código rechazado sigue sirviendo para otro alumno.

3. **`ALTER ROLE` no admite parámetros.** Es una sentencia de utilidad, no una
   consulta: falla con `syntax error at or near "$1"` justo después de crear los
   schemas, dejando la base a medias.

4. **`next.config.ts` obliga a Next a tener TypeScript en ejecución**, que en la
   imagen de producción no está: al arrancar se ponía a instalarlo con yarn
   dentro del contenedor.

5. **`NODE_ENV=staging` no existe** en el esquema —la guía que yo mismo había
   escrito estaba mal—. Para levantar sin proveedor de vídeo se añadió
   `ALLOW_BUCKET_VIDEO`, una válvula que permite **exactamente una cosa** y lo
   dice en su nombre; bajar el entorno relajaría además la comprobación de
   cookies seguras, en silencio.

6. Cuatro del sembrador, todos por el mismo motivo de fondo —**suponer en vez de
   leer**—: identificadores al azar que rompían la resiembra, la búsqueda del
   curso existente **después** del insert (un duplicado por ejecución), operar
   sobre un **usuario fantasma** cuando el correo ya existía, y no esperar a que
   la proyección asíncrona llegara. Y uno de usabilidad: con `DO NOTHING`
   imprimía unas credenciales y la base guardaba otras — **una herramienta cuyo
   único producto útil son esas credenciales las reportaba mal**.

### Estado al cerrar

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 15/15 |
| `pnpm test` | 176 |
| `pnpm smoke` | 95 |
| `pnpm concurrency` | 14 |
| `pnpm smoke:web` | **177** |

### Qué falta

**Lo primero es de producto, no de código: contratar el proveedor de vídeo y un
SMTP real.** Sin el segundo, nadie recibe el correo de verificación ni el de
recuperación — hoy van a Mailpit, que acepta todo y no entrega nada.

El resto, en la sección 5 de [TRASPASO.md](TRASPASO.md).

---

## Sesión 11 — 2026-09-03 — Los nueve servicios en pie

Sesión larga y de mucho terreno: se cerraron los dos servicios que quedaban
vacíos —`engagement` y `learning`— y se cubrieron tres pantallas que existían
solo como enlace muerto. **Ya no queda ningún servicio sin escribir.**

### 1. Biblioteca del kit

Es lo que el alumno abre cada día, y `/discover/biblioteca` era un enlace muerto
desde su propia portada.

**El adaptador S3 se movió de `media` a `@glexco/nest-platform`.** El puerto
`ObjectStorage` ya vivía en el kernel; lo que faltaba era que el adaptador
estuviera donde lo pueden usar dos servicios. Media firma las **subidas** y
catálogo firma la **descarga** del material del kit: duplicarlo habría dejado dos
sitios donde arreglar una firma mal formada, y uno de los dos se queda atrás.

El endpoint nuevo vive en catálogo porque catálogo posee las dos mitades: la fila
del recurso y la regla del derecho. Y comprueba el derecho **sobre el kit al que
pertenece el recurso**, no sobre uno que venga en la petición: aceptarlo
permitiría pedir material de un kit ajeno diciendo tener derecho sobre el propio.

**La diferencia entre `stream` y `embed` la decide el backend.** Un proveedor de
vídeo no sirve un MP4: sirve su propio reproductor con la restricción de dominio
aplicada, y meterlo en un `<video>` no muestra nada. Que lo adivine el cliente es
como se consigue que la pantalla se rompa el día que se contrate el proveedor,
sin que nadie haya tocado el frontend.

El reproductor es el `<video>` nativo, sin librería: entre 50 y 150 kB de más en
la primera carga, en pantallas que abre un aula entera desde la misma línea.

### 2. Panel de GLEXCO

**`/admin` existía como destino y no como pantalla.** `portalPath` manda ahí a
los directores y al personal de GLEXCO desde que hay ingreso, así que aterrizaban
en un 404 nada más entrar. No se había visto porque las comprobaciones del portal
arman la cookie a mano y van directas a `/docentes/institucion`.

La vista de plataforma listaba la cartera de clientes **por UUID**, que no es un
informe. Analítica gana su propio `institution_directory`, alimentado por evento:
la alternativa —un JOIN contra el schema de instituciones— es justo lo que este
servicio no puede hacer, y además el rol `glexco_analytics` no tiene permiso
sobre ese schema.

Y la consulta parte ahora de **las dos fuentes**, no solo de los resúmenes de
actividad. Partiendo solo de la actividad, un colegio recién firmado que todavía
no ha activado ningún código no aparecía —y ese es precisamente el que hay que
ver: libros comprados que nadie activa son dinero pagado y sin usar, y la señal
más temprana de que un centro no va a renovar—.

### 3. `engagement-service`: el correo sale de verdad

Era el hueco más urgente: identidad emitía el token de verificación y **nadie lo
consumía**, así que un alumno que olvidara su contraseña no tenía forma de
recuperarla.

**La decisión que define este servicio: el token NO viaja en el evento.** Un
evento vive días en la outbox y en el stream de JetStream; un token de
recuperación escrito ahí convierte el acceso de lectura a una tabla —o a una
copia de seguridad vieja— en el control de cualquier cuenta de la plataforma. Es
el mismo criterio por el que el código de activación viaja como id de fila.

Lo que viaja es **a quién** hay que escribir y **por qué**. Engagement pide el
token a identidad por la API interna en el momento de enviar, así que el secreto
cruza la red una sola vez y no queda escrito en ningún registro duradero. De
regalo, la hora de vida del enlace empieza cuando el correo sale: con la outbox
retrasada, un token embebido llegaría al buzón ya medio caducado.

La tabla de envíos guarda **qué** se envió y nunca **qué decía**, por lo mismo.
Está comprobado que no tiene ninguna columna donde quepa el enlace.

Otras decisiones que no son evidentes:

- **Cada correo lleva siempre versión en texto plano.** Hay filtros de correo de
  colegio que eliminan el HTML, y un mensaje que en ellos llega en blanco
  equivale a no haberlo enviado.
- **El aviso al apoderado va en un envío separado y no en copia**: ponerlo en
  copia le revelaría a cada familia el correo de la otra en cuanto alguien
  reenvíe el mensaje, y son datos de menores.
- El envío no puede ser transaccional —un SMTP no participa en una transacción de
  PostgreSQL—, así que se elige a conciencia el lado seguro: **es preferible un
  correo duplicado a uno que no llega**. Cada enlace nuevo invalida el anterior,
  así que el segundo es el que funciona y el duplicado tampoco confunde.
- Tras cambiar la contraseña **no se inicia sesión automática**, al contrario que
  en el registro: un restablecimiento suele hacerse porque alguien pudo tomar la
  cuenta, el backend acaba de revocar todas las sesiones, y entrar sin
  credenciales contradiría esa decisión.

Identidad estrena además su primera API interna **como servidor** —hasta ahora
solo era cliente de las de otros—, con su guard y su token compartido.

### 4. `learning-service`: la señal temprana

El progreso que mide aprendizaje se mide con evaluaciones, y de eso ya se ocupa
`analytics`. Lo que faltaba es la señal **temprana**: quién se descolgó antes del
primer examen. Un alumno que lleva dos semanas sin terminar una lección se
detecta aquí; en analytics no aparece hasta que suspende, que es cuando ya es
tarde para ayudarle.

- **La garantía de la gamificación es que el XP no se puede inflar.** El índice
  único `(alumno, motivo, referencia)` vive en la base, no en el código: dos
  peticiones simultáneas no pueden pagar dos veces, mientras que comprobar antes
  y escribir después deja la carrera abierta. Un contador que se puede inflar
  deja de significar nada para quien se lo ganó.
- **El resumen se recalcula entero desde los hechos**, nunca sumando
  incrementos. Misma decisión que en analytics, y por lo mismo.
- El XP de una evaluación se referencia por la **evaluación** y no por la
  entrega: con la entrega, el camino más rápido para subir de nivel sería
  reenviar el mismo examen, que no enseña nada.
- **Aprobar vale cuatro veces más que abrir una lección.** Si abrir contenido
  diera tanto XP como demostrar que se aprendió, el sistema premiaría pasar
  páginas.
- **Lo marca el alumno, no lo deduce el sistema.** Se pensó en dar la lección por
  completada al abrir el recurso y se descartó: abrir un PDF no es haberlo leído,
  y un progreso que se rellena solo deja de significar nada —ni para el alumno,
  que ve barras llenas sin haber hecho nada, ni para el docente, que pierde la
  única señal de quién se descolgó—.
- **La lista del docente parte de las matrículas y no del progreso**: un alumno
  que nunca abrió nada no tiene fila de progreso, y es justo el que hay que ver.
  Partiendo del progreso, el que peor va es el único que no aparece.
- **No hay ranking, y es una decisión de producto.** El alumno solo se compara
  consigo mismo. La propuesta lo pide para el ranking —*celebra logros, no señala
  rezagos*— y entre menores vale igual: a un niño de ocho años, «eres el 24 de
  30» no le enseña nada. Está comprobado que la pantalla no contiene ni posición
  ni ranking.
- Las insignias **no se retiran nunca**. Una que aparece y desaparece —porque el
  alumno bajó de una media— convierte un reconocimiento en un castigo.

### 5. El gateway aplica `publicPaths`

La tabla de rutas declaraba qué rutas son públicas desde el primer día, **y el
proxy no consultaba ese campo**. Un campo que se lee como un control de seguridad
y no hace nada es peor que no tenerlo: el siguiente que lo vea creerá que añadir
una línea ahí expone o cierra algo.

Comprueba **presencia** de credencial, no validez, y es a propósito: el gateway
no tiene el secreto de firma y no debe tenerlo. Lo que aporta es la protección
que queda cuando la del servicio falla —si alguien marca un controlador
`@Public()` por error, esta tabla sigue sin exponerlo—. Sin `publicPaths`
declarado, un prefijo entero exige credencial: exponer algo tiene que costar
añadir una línea, no olvidarse de añadirla.

### Errores reales encontrados y corregidos

1. **Añadir un asunto a un consumidor duradero de NATS lo rompía entero.**
   `consumers.add` sobre un duradero que ya existe con otra configuración falla
   con «consumer already exists», y ese fallo tumbaba el arranque del consumidor
   completo. Lo dispara el caso más normal del mundo: alguien añade un asunto y
   despliega. Y era especialmente traicionero: el servicio arrancaba, el health
   check pasaba, y el aviso decía que los dashboards seguirían sirviendo lo ya
   proyectado «hasta que el bus vuelva» —pero el bus estaba perfectamente—. La
   proyección quedaba muerta hasta que alguien se fijara. Ahora se actualiza en
   su lugar, lo que conserva la posición del consumidor.

2. **`/admin` era un 404 al que el ingreso mandaba a directores y personal de
   GLEXCO.** Ver el punto 2.

3. **El panel de plataforma ocultaba justo al cliente que no arranca.** Ver el
   punto 2.

4. **El backend no devolvía `lessonId` al abrir un recurso**, y TypeScript no lo
   detectó porque el tipo del cliente lo heredaba de `LibraryItem`. El botón de
   «ya lo vi» no aparecía nunca. Es un recordatorio de que un tipo compartido
   entre cliente y servidor solo garantiza la forma que **ambos** declaran, no la
   que uno rellena.

5. **Completar una lección nunca abierta se comportaba como «ya estaba hecha»**,
   y le negaba su XP para siempre. Pasa cuando el registro de apertura falla —no
   puede impedir ver el contenido, así que se ignora— y el alumno pulsa el botón
   igualmente. Ahora se abre y se completa de una vez.

6. **El curso y el kit venían del cliente al abrir una lección**, contradiciendo
   el comentario que yo mismo había escrito al lado. Los resuelve ahora el propio
   servicio desde su directorio: aceptarlos permitiría a un alumno atribuirse
   progreso en un curso que no es el suyo, y con él, los 150 puntos de
   completarlo.

7. **Dos comprobaciones de humo contaban recursos con una cifra fija**, así que
   mejorar el sembrador —añadir un vídeo y un enlace externo para cubrir los tres
   caminos de entrega— las rompía. Reescritas para afirmar lo que de verdad
   quieren decir: que el borrador no está, y que publicar añade exactamente uno.

8. El tropiezo del **JSX interpolado**, otras dos veces. Resuelto como siempre,
   con anclas `data-*` estables y no relajando la comprobación.

### Estado al cerrar

| Comprobación | Antes | Ahora |
|---|---|---|
| `pnpm build` | 13/13 | **15/15** |
| `pnpm test` | 155 | **176** |
| `pnpm smoke` | 95 | 95 |
| `pnpm concurrency` | 14 | 14 |
| `pnpm smoke:web` | 99 | **175** |

**Los nueve servicios escritos.** Fases 0–3 cerradas; 4, 5, 6 y 7 en curso; 8 sin
empezar.

### Qué falta

1. **Certificados** (Fase 6): plantilla, firma digital, QR y verificación pública
   sin iniciar sesión. Es lo único grande que le queda a la fase.
2. **Rúbricas de corrección** (Fase 5), y los tipos de pregunta `ordering` y
   `matching`: están en el vocabulario pero su corrección automática no está
   escrita, así que hoy se tratan como manuales.
3. **i18n es/en con next-intl** (Fase 4). Hoy los textos están en español en el
   código, y el vocabulario ya contempla los dos idiomas.
4. **Las pantallas que faltan de los portales** (Fase 4): laboratorio de robots,
   retos y logros en Discover; proyectos, certificaciones y portafolio en
   Academy.
5. **Portal Admin completo** (Fase 7): instituciones, usuarios, gestión académica
   y de contenidos, comercial.
6. **Exportación a PDF, Excel y CSV** de los dashboards.
7. **Auditoría WCAG 2.1 AA** pantalla a pantalla.
8. **Fase 8 entera**: pruebas de carga, revisión de seguridad, CI/CD y
   despliegue. Queda para más adelante por decisión del cliente.

Sigue pendiente la pregunta abierta del **límite de altas por IP**: diez por hora
es correcto contra un abuso desde internet, pero una clase de treinta alumnos
detrás del NAT del colegio lo agota en el minuto tres. Es una decisión del
cliente, no técnica.

---

## Sesión 10 — 2026-09-03 — Un colegio ya puede empezar solo

Hasta esta sesión faltaba lo único que impedía que una institución usara la
plataforma sin que nadie de GLEXCO interviniera: **no había forma de darse de
alta desde el portal**. El backend sabía registrar alumnos y canjear códigos
desde la fase 1, pero el alta se hacía por API, así que cada colegio nuevo era
una tarea manual. Esta sesión cierra ese hueco.

### 1. El registro, en dos pasos y con el estado en la URL

`/registro` es un asistente de dos pasos, y los dos son **formularios `GET`
normales**. Es la decisión de diseño de la que cuelga todo lo demás:

- Funciona **sin una línea de JavaScript**. Importa más aquí que en ninguna otra
  pantalla, porque es la primera que abre un alumno y todavía no sabe si la
  plataforma le funciona.
- El botón «atrás» del navegador hace lo que se espera, y recargar no saca el
  aviso de reenvío de formulario.
- Un docente puede pasarle a su clase **un enlace con el colegio y el grado ya
  puestos** (`/registro?colegio=XXX&grado=primary_4`). Con el estado en React eso
  no existiría.

El primer paso pide **el código del colegio y el grado juntos**. Podrían ser dos
pantallas, pero el alumno sabe las dos cosas desde el principio y cada pantalla
intermedia es gente que abandona. El segundo paso ya conoce el colegio, así que
puede listar sus salones reales con el nombre del docente.

**El registro independiente no es un caso degradado.** Tiene su propia opción,
igual de visible, y no toca el servicio de instituciones en ningún momento: hay
familias que compran el libro por su cuenta y son la mitad del modelo de negocio.

Detalles que no son evidentes:

- **El correo del apoderado se pide siempre**, no solo cuando la fecha de
  nacimiento ya escrita indica menos de 14 años. Condicionarlo exigiría
  JavaScript para hacer cumplir una regla legal, y sin JavaScript el campo
  obligatorio no aparecería: el alumno enviaría el formulario y recibiría un
  error por un campo que no ve.
- **No hay cronómetro ni pasos ocultos**: el indicador dice «Paso 1 de 2» en
  texto, y no solo con el color de dos puntos, que es lo único que un lector de
  pantalla no puede anunciar.
- Los salones son **radios nativos dentro de un `fieldset`**, por lo mismo que el
  cuestionario de la sesión 9: traen gratis el agrupado, el teclado y el anuncio
  correcto. Con un solo salón viene marcado; con varios, ninguno.
- Cuando el grado del colegio **no tiene salones o están todos llenos**, la
  pantalla lo dice, explica quién puede arreglarlo y ofrece la salida (cuenta
  independiente). Un callejón sin salida en el alta es un cliente perdido.

### 2. Termina con la sesión iniciada, a propósito

La Server Action registra y, acto seguido, **inicia sesión con las mismas
credenciales**. El alumno acaba de teclear su contraseña, así que pedírsela otra
vez no comprueba nada nuevo, y dejarlo en la pantalla de ingreso justo después de
registrarse contradice el objetivo de la sesión.

Si el inicio automático falla, **el alta ya está hecha** y no se repinta el
formulario: se manda a `/ingresar?registrado=1`, que lo explica. Repintar el
formulario haría que el alumno reintentase y chocara con «ese correo ya está
registrado», creyendo que el registro no funcionó.

### 3. `/registro/listo`: la pantalla que tapa un hueco asíncrono real

**El canje del código no es síncrono.** Identidad crea la cuenta y encola el
evento; catálogo lo canjea al consumirlo. Si al alumno se le mandara directo a su
portal, en ese hueco vería el estado vacío —«todavía no tienes ningún kit, activa
el código de tu libro»—, que es exactamente lo que acaba de hacer. Es la peor
frase posible en el instante en que un producto de pago tiene que demostrar que
sirvió.

Así que la confirmación **lee los kits de verdad** y dice la verdad en los dos
casos: si ya llegó, enseña cuál; y si no, dice que se está activando y ofrece
volver a mirar. Nunca afirma que el kit está listo sin haberlo comprobado.

**No anuncia ningún correo de verificación**, y está comprobado que no lo haga.
Identidad emite el token, pero hoy nadie consume ese evento: decir «te enviamos
un correo» dejaría a media clase esperando un mensaje que no existe.

### 4. Activar un código con la cuenta ya creada

`/discover/activar` y `/academy/activar` eran enlaces muertos desde la fase 4: el
estado vacío de la portada apuntaba a una ruta que no existía. Ahora existen, y
cubren el caso real del modelo de negocio: **un libro por grado** significa un
canje nuevo cada curso, sin cuenta nueva.

El aviso de que el código es de un solo uso va **antes** del botón. Un código es
irreversible, y una advertencia bajo el botón se lee cuando ya se ha pulsado.

### Errores reales encontrados y corregidos

1. **Reenviar el mismo código devolvía un 500.** El agregado `ActivationCode`
   declara el canje idempotente para el mismo alumno —y lo cumple: sale sin
   cambios y sin eventos—, pero el caso de uso creaba de todas formas un
   `Entitlement` nuevo, que chocaba contra `entitlements_student_kit_uq`. El
   camino afectado es de lo más común: un reintento de red, o el alumno que
   reenvía el formulario de activación. No se había visto antes porque el canje
   por evento se protege con `processed_events` y nunca llega dos veces al caso
   de uso; solo la vía HTTP lo destapa. Además, volver a emitir
   `entitlement.granted` habría sido una concesión duplicada para todo el que
   consuma el evento.

2. **El grado declarado no se contrastaba con el del salón.** El formulario solo
   ofrece salones del grado elegido, pero eso es comodidad del cliente. Sin
   revalidarlo en el servidor, una petición forjada matriculaba a un alumno de
   sexto en el salón de primero del mismo colegio, y ni el docente ni el alumno
   lo notarían hasta ver la lista de clase. El aislamiento **entre** colegios sí
   estaba comprobado; lo que faltaba era el de dentro. `PrecheckClassroomOutput`
   devuelve ahora el grado y `RegisterStudentUseCase` lo compara, con el campo
   señalado para que el formulario pinte el error donde toca.

3. **La contraseña se recortaba en el alta y no en el ingreso.** El ayudante que
   normaliza los campos del formulario quita los espacios de los extremos, y
   aplicarlo a la contraseña la altera en silencio: se guardaría `abc` cuando el
   alumno escribió `␣abc␣`, y al ingresar —donde no se recorta nada— no
   coincidiría nunca. Un usuario encerrado fuera de su cuenta el primer día, sin
   ningún mensaje que lo explicara. Error introducido y corregido en esta misma
   sesión; queda comprobado que una contraseña con espacios en los extremos
   sobrevive el viaje de ida y vuelta.

4. **Una comprobación buscaba el texto de un botón JSX interpolado.** El mismo
   tropiezo documentado en la sesión 9: React parte ese texto con separadores de
   comentario en el HTML servido. Se resolvió como entonces, con un ancla
   estable (`data-submit`), no relajando la comprobación.

### Dos cosas que quedan anotadas, no arregladas

- **`publicPaths` del gateway no lo usa nadie.** La tabla de rutas de
  `services/api-gateway/src/config.ts` declara qué rutas son públicas, pero el
  proxy no lee ese campo: cada servicio decide con su propio `@Public()`. Hoy no
  hay agujero —los servicios sí comprueban—, pero un campo que se lee como un
  control de seguridad y no hace nada es una trampa: alguien añadirá una ruta ahí
  creyendo que la ha expuesto, o la quitará creyendo que la ha cerrado. O se
  implementa o se borra.
- **El límite de altas es por IP, y un laboratorio escolar comparte una.** Diez
  registros por IP y hora es correcto contra un abuso desde internet, pero una
  clase de treinta alumnos registrándose a la vez detrás del NAT del colegio
  agota el límite en el minuto tres. Es una pregunta para el cliente, no una
  decisión nuestra: lo razonable sería una excepción para las IP declaradas de
  una institución con licencia vigente.

### Estado al cerrar

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 13/13 |
| `pnpm test` | 155 |
| `pnpm smoke` | 95 |
| `pnpm concurrency` | 14 |
| `pnpm smoke:web` | **99** (eran 70; +29 del registro y la activación) |

### Qué falta

Por orden de valor, y sin cambios respecto a lo previsto salvo que el punto 1 ya
está hecho:

1. **Biblioteca del kit** con reproductor y descargas por URL prefirmada. Es lo
   que el alumno abre cada día, y hoy `/discover/biblioteca?kit=…` sigue siendo
   un enlace muerto desde la propia portada. `media-service` está terminado.
2. **Panel de GLEXCO en el portal.** El endpoint por institución existe; la
   pantalla no.
3. **`learning-service` (Fase 6)**: progreso por lección, retos, XP, medallas,
   certificados.
4. **`engagement-service` (Fase 7)**: anuncios de salón y **correo real**. Sube de
   prioridad después de esta sesión: ahora que los alumnos se registran solos,
   nadie recibe el correo de verificación ni el de recuperación de contraseña, y
   un alumno que olvide su contraseña no tiene forma de recuperarla.
5. Las dos cosas anotadas arriba: `publicPaths` y el límite por IP del colegio.

---

## Sesión 9 — 2026-09-03 — Los cinco dashboards, y el ciclo completo de evaluación

Sesión larga, con un hilo único: **cerrar el ciclo por el que un alumno responde,
alguien corrige y todo el mundo lo ve en su dashboard.** Antes de esta sesión el
backend sabía evaluar pero nadie podía usarlo desde una pantalla, y no existía
ningún sitio donde se viera el progreso.

### 1. Requisito nuevo del cliente: los dashboards

El cliente lo planteó así: el progreso se verifica con **nuestras** evaluaciones
predeterminadas, el colegio puede añadir las suyas, y todo se ve en dashboards
profesionales, con un alcance por rol:

| Quién | Qué ve |
|---|---|
| Alumno | El suyo. |
| Docente | Uno general de su salón, y uno por alumno. |
| Admin de institución | Los anteriores, más **qué docentes tienen alumnos que aprenden más**. |
| GLEXCO | Uno por colegio, y la vista de plataforma. |

No estaba planteado así en la documentación, así que se añadió la **sección 6.bis
de [DOMINIO.md](DOMINIO.md)** con las reglas, y las secciones 9 a 11 de
[ARQUITECTURA.md](ARQUITECTURA.md) con el cómo.

**La decisión que más discusión merecía: cómo medir la eficacia docente.** Se
mide por **PROGRESO y no por nota**, y las razones son de fondo:

- Una nota media premia al docente que tiene el grupo con mejor punto de partida.
  Con eso, un ranking de docentes mide sobre todo el barrio del colegio.
- El progreso —cuánto ha subido cada alumno desde su primer intento— es lo único
  que se puede atribuir razonablemente a la enseñanza.
- Solo cuentan las evaluaciones de **GLEXCO**: son las mismas para todos, así que
  son comparables. Si contaran las del docente, cualquiera podría subir su
  métrica poniendo exámenes fáciles.
- Cada fila lleva **el tamaño de su muestra**, y por debajo de 15 alumnos medidos
  se marca como no concluyente. El aviso viaja **con los datos**, en la misma
  respuesta de la API, no como un pie de página de la pantalla: un pie se pierde
  al copiar la tabla a una reunión, y ahí es donde el número hace daño.
- La pantalla **no lo presenta como un ranking**. Es una tabla ordenable con el
  aviso arriba, y eso está comprobado en las pruebas del portal.

### 2. `analytics-service`: proyección de lectura, no consultas cruzadas

Servicio nuevo. Se alimenta **solo de eventos** y no consulta ningún otro schema.
La alternativa —un servicio de informes que hace JOIN sobre evaluación, catálogo
e instituciones— es la que se ve en todas partes y es exactamente la que impide
que esos tres servicios cambien su esquema sin romper los informes.

Para que eso sea posible, `submission.graded.v1` viaja **con más de lo mínimo**:
`kitId`, `origin`, `institutionId` y los fallos por pregunta. Sin esos campos la
analítica tendría que llamar de vuelta a evaluación por cada entrega, y una
proyección asíncrona se convertiría en una dependencia sincrona.

Tablas: `student_assessment_facts`, `question_miss_facts`, `classroom_rollups`,
`institution_rollups`, `projection_state`. Los resúmenes se **recalculan enteros
desde los hechos** en vez de sumar incrementos: un evento entregado dos veces
—que JetStream garantiza *al menos* una vez— no puede inflar una media.

Seis endpoints, cada uno con doble comprobación: el guard dice qué clase de
operación puede hacer el actor, y el caso de uso comprueba **sobre qué recurso**.
El ámbito se resuelve con las propias proyecciones de la analítica y no llamando
a instituciones: esa comprobación corre en cada apertura de dashboard.

### 3. Las pantallas

**Del alumno** (`/discover/progreso`, `/academy/progreso`): medias separadas de
GLEXCO y del docente, cuánto ha mejorado, y la evolución en el tiempo.

**Del docente** (`/docentes`, `/docentes/salones/[id]`): media **y dispersión
juntas**. Una media de 70 con todos en 70 y una media de 70 con media clase en
100 y media en 40 son dos clases distintas que piden dos cosas distintas;
mostrar solo la media las presenta como iguales, y ese es el error más común de
un panel de aula. Y las preguntas que más falla el salón, que es el dato más
accionable que existe: no dice "tu clase va mal", dice qué volver a explicar.

**De institución** (`/docentes/institucion`): lo anterior más la eficacia docente
y la activación de códigos, que es la métrica comercial.

Los gráficos son **SVG propio, sin librería**: +2 kB sobre la carga base frente a
los 40-100 kB de una librería de gráficos, en equipos de laboratorio escolar. La
paleta se validó con el script de la propia habilidad de visualización en vez de
a ojo, y el resultado fue útil: dos azules de marca que parecían distintos están
a ΔE 4.8 —indistinguibles para un daltónico—, así que **todos los gráficos usan
un solo tono** y las diferencias se marcan con posición y etiqueta. Los colores
de estado siempre llevan texto al lado, nunca color a secas.

### 4. El cuestionario en el portal

Sin esto el alumno no puede generar el dato que alimenta su propio dashboard.

`<fieldset>` + `<legend>` con radio y casillas **nativos**: traen gratis la
navegación por teclado, el anuncio correcto en un lector de pantalla y el
agrupado por `name`. Un componente propio a base de `div` con `onClick` tendría
que reimplementar las tres cosas y normalmente reimplementa mal las tres.

**Funciona sin JavaScript**: `useActionState` sobre `<form action>` degrada a un
envío normal del navegador. En un laboratorio con equipos viejos o una conexión
que corta el bundle a mitad, el alumno sigue pudiendo entregar.

Ningún tipo del cliente incluye `correctOptionIds` ni `explanation`, así que
intentar pintar la clave **rompe la compilación** en vez de filtrarse en
silencio. Está comprobado sobre el HTML servido, no sobre la intención.

El intento se abre al cargar la página —el límite de tiempo empieza cuando el
alumno ve las preguntas— y recargar devuelve **el mismo** intento.

**No hay cronómetro en pantalla, a propósito.** El tiempo lo cuenta el reloj del
servidor; un contador en el cliente daría a entender que ese es el que manda,
además de meterle prisa a un niño con un número rojo bajando.

### 5. La bandeja de corrección

La corrección automática solo cubre lo de marcar. Todo lo abierto —una respuesta
escrita, una foto del robot montado, el enlace al vídeo de la expo— quedaba en
`submitted` sin aparecer en ninguna pantalla: el docente tendría que acordarse de
mirar alumno por alumno.

- **`assessment` gana su propia proyección `classroom_directory`**, alimentada por
  los eventos de salón. La alternativa era llamar a instituciones en cada
  apertura de la bandeja, que se abre constantemente durante una clase y ataría
  la corrección a que el otro servicio esté arriba.
- Los dos endpoints de corrección viven en un **controlador aparte**, porque sus
  respuestas **sí** llevan la clave. Tenerlos separados hace visible de un
  vistazo cuál es el controlador que puede filtrar un examen y cuál no.
- **`institutions` gana `student_directory`**, gemelo del de docentes. Sin
  nombres, la bandeja diría "a3f1-… entregó su examen". El nombre va en una
  proyección y no en `enrollments` a propósito: no participa en ninguna regla del
  salón, llega por evento y puede ir unos segundos desactualizado, mientras que
  la matrícula tiene que ser exacta.
- **`GET /classrooms/mine`**, autenticado y solo del propio actor. Un alumno no
  tiene `CLASSROOM_READ` —no debe listar salones— pero necesita saber en cuál
  está: el intento se abre con su salón, y sin salón la entrega no llega a la
  bandeja de nadie. Es el mismo criterio que `MEDIA_READ`: el guard dice "es un
  usuario", el caso de uso decide qué recurso.

### 6. El docente crea sus propias evaluaciones

El backend ya sabía crear, ampliar, publicar y duplicar; `/docentes/evaluaciones`
era un enlace muerto en la barra.

- **`GET /assessments/:id` nuevo**: no había forma de leer una evaluación con sus
  preguntas. La clave se incluye **solo si quien pregunta puede editar**. Un
  docente mirando el banco de GLEXCO —para decidir si lo duplica— recibe las
  preguntas sin las respuestas, porque son las mismas que van a responder sus
  alumnos. Está comprobado.
- **`GET /catalog/kits`**: un índice de lo publicado, para elegir el kit sin
  teclear un identificador. Ver el contenido sigue exigiendo el derecho.
- El banco se presenta en **dos bloques** y no en una tabla con columna "origen":
  son dos cosas que se operan distinto —duplicar frente a editar y publicar— y
  mezclarlas obliga a leer la fila para saber qué botón esperar.
- Las opciones correctas se envían **por posición**, y la posición es la de la
  opción **ya filtrada**: con el índice de la fila del formulario, dejar un hueco
  en blanco desplazaría la respuesta correcta a otra opción sin que nadie lo note.
- Con entregas hechas se explica **el motivo y la salida** —archivar y duplicar—,
  no solo que no se puede. Un botón deshabilitado sin motivo se lee como un fallo
  de la aplicación.

### Errores reales encontrados y corregidos

1. **La entrega guardaba la institución de la EVALUACIÓN, no la del ALUMNO.** Una
   evaluación de GLEXCO no pertenece a ninguna institución, así que todos los
   resultados del banco común quedaban sin institución: el panel del director
   salía con cero alumnos medidos. Migración `assessment/0002` y la institución
   tomada del token del actor. Es el fallo más grave de la sesión, porque no daba
   ningún error: solo un dashboard vacío que parecía "todavía no hay datos".

2. **La restricción `CHECK` de `kind` aceptaba `('quiz','task','exam')`**, tres
   valores que no existen en `ASSESSMENT_TYPES`. Zod aceptaba `'project'`, el
   agregado también, y la inserción moría contra la base: **un 500 en vez de un
   422**, sin ninguna pista de que el problema era el valor de un campo. Solo se
   podía crear un cuestionario de marcar, es decir, justo lo que **no** llega a la
   bandeja de corrección. Migración `assessment/0004`.

3. **Un intento abierto antes de que la matrícula estuviera proyectada quedaba
   sin salón para siempre**, porque recargar devuelve el mismo intento y la
   entrega ya no aparecía en la bandeja de nadie. `Submission.attachClassroom`
   rellena el hueco y **nunca** cambia uno ya asignado: permitirlo dejaría mover
   una entrega de un docente a otro sin rastro.

4. `min(uuid)` no existe en PostgreSQL. Se usa `(array_agg(...))[1]`.

5. **`/auth/me` era inútil**: devolvía los claims del token que el cliente ya
   tenía. Reescrito como `GetMyProfileUseCase`, que lee la base y recalcula los
   permisos desde los roles.

6. **`next dev` y `next build` compartían `.next`**, así que un `pnpm build` del
   monorepo mientras corría el servidor de desarrollo lo rompía con `Cannot find
   module './735.js'`. Carpetas separadas con `distDir`.

7. **Un módulo `'use server'` no puede exportar funciones sincronas.** `portalPath`
   se movió a `lib/portal.ts`.

8. Dos comprobaciones del portal fallaban **aunque la pantalla estuviera bien**:
   React parte el texto de un JSX interpolado con separadores de comentario, así
   que buscar `"1 pregunta"` en el HTML servido falla. Se añadieron anclas
   estables (`data-chart`, `data-pending`).

9. Una prueba de humo estaba **mal escrita, no el código**: reutilizar el refresh
   token 50 ms después es exactamente para lo que existe la ventana de gracia de
   10 s. Reescrita para comprobar las dos mitades.

### Estado al cerrar

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 13/13 |
| `pnpm test` | **155 pruebas** en memoria |
| `pnpm smoke` | **95 comprobaciones** de punta a punta |
| `pnpm concurrency` | **14 comprobaciones** de concurrencia real |
| `pnpm smoke:web` | **70 comprobaciones** del portal |

Las 37 pruebas nuevas son del dominio de evaluación, **que no tenía ninguna**:
cubren que la clave no sale por ningún campo, que un docente no toca el banco de
GLEXCO, el todo-o-nada de las preguntas de varias respuestas, el minuto de
gracia del límite de tiempo, y que el evento de nota lleva lo que la analítica
necesita.

### Qué falta

Lo siguiente, en orden de valor:

1. **Registro de alumno y activación de código desde el portal.** Hoy el alta se
   hace por API; es la última pieza para que un colegio pueda usar la plataforma
   sin que nadie de GLEXCO toque nada.
2. **Biblioteca del kit con reproductor y descargas por URL prefirmada.** El
   backend de medios está completo; falta la pantalla.
3. **Panel de GLEXCO en el portal.** El endpoint por institución existe, la
   pantalla no.
4. **`learning-service` (Fase 6)**: progreso por lección, retos, XP, medallas y
   certificados. Hoy el progreso se mide **solo** con evaluaciones, que es la
   fuente que cuenta; el consumo de contenido añadiría la señal de "quién se
   descolgó".
5. **`engagement-service` (Fase 7)**: anuncios de salón, correo real —hoy
   identidad emite el token y el evento, y no hay quien los consuma—, mesa de
   ayuda.
6. Rúbricas de corrección, exportación a PDF/Excel/CSV, i18n con next-intl y la
   auditoría de accesibilidad pantalla a pantalla.

Sin bloqueos abiertos.

---

## Sesión 8 — 2026-09-03 — Enlaces externos y arranque de la Fase 5

### Dos aclaraciones del cliente

**1. Los centros alojan el vídeo en su propio Outlook / OneDrive y comparten el
enlace.** Se adopta ese flujo: `POST /media/links` registra material alojado
fuera. Evita almacenar y servir gigabytes que no son nuestros y encaja con lo que
la gente ya hace.

**No sustituye a la subida.** El cliente pidió expresamente conservar la subida
de vídeo con proveedor, así que conviven: quien tenga el vídeo en el móvil sube y
va al proveedor externo; quien ya lo tenga publicado en su institución comparte
el enlace. El vídeo vuelve a admitirse también en evidencias.

**2. ¿Pueden docentes y administradores crear o modificar tareas y exámenes?**
No existía nada: era la Fase 5 y `assessment-service` estaba vacío. Se ha
construido, con la distinción que el cliente señaló al preguntar —GLEXCO pone
evaluaciones por defecto, de marcar, tipo Coursera—.

### Qué se construyó

**Enlaces externos en `media-service`.** Lista blanca de dominios (Microsoft 365,
Google Workspace, YouTube, Vimeo), https obligatorio, sin credenciales
incrustadas y sin acortadores. Conviven con las subidas en la misma tabla.

**`assessment-service` completo en su núcleo:** `Assessment`, `Question`,
`Submission`, corrección automática de lo que es de marcar, corrección manual de
lo abierto, y la API para las dos cosas.

### Decisiones no obvias

- **El origen de una evaluación no se acepta de la petición: se deduce de quién
  la crea.** Si viniera en el cuerpo, un docente podría declarar su cuestionario
  como contenido de GLEXCO y publicarlo a todos los colegios del país cambiando
  un solo campo. Es la misma regla que ya protege el alta de personal en
  identidad.

- **Un docente no edita el banco de GLEXCO, pero puede duplicarlo.** Cuando
  choca con el error, lo que quiere no es romper el banco común: quiere su propia
  versión. Sin `clone`, la única salida sería copiar las preguntas a mano.

- **La clave de corrección nunca sale hacia un alumno.** `forStudent()` no
  incluye `correctOptionIds` ni `explanation`. Un cuestionario cuyas respuestas
  correctas viajan al navegador no evalúa nada: basta abrir la pestaña de red.
  Que el frontend "no las pinte" no sirve de nada. Hay una comprobación en la
  prueba de humo que lo verifica sobre el JSON servido.

- **Todo o nada en las preguntas de varias respuestas.** Dar puntos parciales por
  cada acierto premia marcarlo todo: quien selecciona las cinco opciones acierta
  las tres correctas y saca más que quien pensó y marcó dos de tres.

- **El límite de tiempo lo cuenta el reloj del servidor**, con un minuto de
  gracia para la latencia del envío final. Fiarse del cronómetro del navegador es
  no tener límite: se cambia con la consola abierta en diez segundos.

- **Con entregas hechas, las preguntas se congelan.** Cambiarlas invalidaría en
  silencio las notas ya puestas: el alumno respondió a otra cosa. Se archiva y se
  crea una versión nueva.

- **La nota no se cierra mientras falte corrección manual.** Decirle a un alumno
  que suspendió cuando falta la mitad de los puntos es peor que no decirle nada.

- **La fecha límite se comprueba al EMPEZAR, no al entregar.** Cortar a mitad a
  quien empezó a tiempo sería castigarle por tardar lo que la evaluación dura.

- **El enlace externo no se puede validar del todo, y se dice.** El permiso lo
  gobierna el proveedor del centro: el fallo más común con diferencia es que el
  alumno comparte un enlace restringido a su cuenta y el docente recibe "acceso
  denegado". La respuesta lo advierte de forma explícita, porque comprobarlo
  exigiría la sesión del docente.

- **Lista blanca de dominios, no lista negra**, y sin acortadores: `bit.ly/x`
  pasa cualquier lista blanca y redirige a donde sea, con lo que la convierte en
  decoración.

### Un error que apareció tres veces y se cerró en la raíz

El patrón: una operación idempotente sale sin tocar nada, la versión del agregado
no avanza, y el `UPDATE ... WHERE version < :nueva` no encuentra fila. El
repositorio lo interpreta como escritura concurrente y lanza un conflicto que no
existe, justo en el camino que debería ser el más inofensivo.

Apareció en el inicio de sesión (sesión 5), al reanular un código (sesión 6) y al
reentregar un intento (esta sesión). Se cerró añadiendo `AggregateRoot.hasChanges`
y una guarda en todos los repositorios: **un `save` sobre un agregado sin cambios
no escribe**. El error deja de poder cometerse en vez de tener que recordarlo en
cada caso de uso.

### Otros errores corregidos

- **`next dev` y `next build` compartían `.next`.** Un `pnpm build` del monorepo
  mientras corría el servidor de desarrollo lo dejaba con `Cannot find module
  './735.js'` y errores 500 en páginas que estaban bien. Ahora desarrollo escribe
  en `.next-dev`.
- **`requireSession` lanzaba en vez de redirigir.** Next renderiza layout y
  página en paralelo, así que la página llegaba ahí antes de que la redirección
  del layout surtiera efecto y llenaba el log de errores en un caso que no lo es.
- **`web-check.mjs` no decía qué objetivo fallaba.** Un `fetch failed` a secas
  con seis procesos en marcha obliga a adivinar. Ahora nombra la URL.
- **`QUESTION_TYPES` estaba a punto de duplicarse** en el esquema Zod. Se alineó
  con el vocabulario compartido, que ya lo definía.

### Estado al cerrar

- `pnpm build`: **12/12**. `pnpm test`: **118**.
- `pnpm smoke`: **73/73**. `pnpm concurrency`: **14/14**. `pnpm smoke:web`: **17/17**.
- Siete servicios: identity, institutions, catalog, media, assessment, gateway y
  el portal.
- **Sin push**, por decisión del cliente.

### Qué falta

**Fase 4**: las pantallas interiores de los portales, el registro y la activación
de código desde el portal, i18n con next-intl y la auditoría de accesibilidad.

**Fase 5**: rúbricas, la bandeja de corrección del docente en el portal
(`listPendingForClassroom` ya existe en el backend), y el portal docente
completo. Los tipos de pregunta `ordering` y `matching` están en el vocabulario
pero su corrección automática no está escrita, así que hoy se tratan como
manuales.

---

## Sesión 7 — 2026-09-02 — Arranque de la Fase 4 y aclaración sobre el video

### Aclaración del cliente que cambió una decisión

El cliente aclaró que **no hay videollamadas ni subidas de video por parte de los
colegios**: los tutoriales los produce GLEXCO y son los mismos para todos.

Eso convierte el catálogo de video en algo **fijo y pequeño**, que abarata mucho
la factura del proveedor externo, pero no elimina la necesidad de tenerlo: un
tutorial de 10 min en 720p pesa ~150 MB y visto por 100.000 alumnos son 15 TB de
salida, que a precio de almacenamiento de objetos son cuatro cifras por un solo
video. Además, un MP4 servido tal cual no se adapta a la conexión, y en un
colegio con mala línea el alumno mira la rueda girando en vez de la clase.

**Cambio aplicado:** `media-service` ya no acepta video en cualquier ámbito. La
tabla `SCOPE_TYPES` restringe `video/mp4` al ámbito `content` —material de
GLEXCO—; las evidencias quedan en foto y PDF, y los avatares solo en imagen.

**Contradicción abierta:** el roadmap de la Fase 5 dice *"Evidencias (foto/video)
del alumno"*. Con la aclaración de esta sesión, las evidencias son solo foto. Si
en algún momento un alumno debe grabar su robot funcionando, hay que revisarlo.

### Qué se construyó de la Fase 4

**`@glexco/icons`** con nueve iconos del dominio (robot, kit, insignia, nivel,
reto, código, salón, certificado, biblioteca). Solo iconos de dominio: redibujar
una lupa no aporta nada y resta consistencia, así que el cromo de interfaz sigue
viniendo de Lucide. Todos en `currentColor` y `aria-hidden` por defecto.

**`apps/web`** en Next.js 15 con App Router y React Server Components:

- Sistema de diseño con los tokens del canvas aprobado.
- Ingreso, cierre de sesión y enrutado al portal según edad y rol.
- Portadas de Discover y Academy leyendo el kit real del catálogo.
- Estados vacíos que dicen qué hacer, esqueletos con la forma del contenido,
  foco visible y salto al contenido.

**`pnpm smoke:web`**: 17 comprobaciones del portal contra el backend real.

### Decisiones no obvias

- **El token vive en una cookie `httpOnly` y las llamadas autenticadas se hacen
  desde el servidor.** Meterlo en `localStorage` —que es lo habitual en
  tutoriales de Next— lo deja al alcance de cualquier script inyectado: un solo
  XSS en cualquier dependencia del frontend se convierte en el robo de la sesión
  de todos los alumnos.

- **Discover y Academy comparten componentes y difieren en densidad**, declarada
  una sola vez en el layout con `data-portal`. Si cada componente llevara su
  propia variante, la coherencia dependería de que nadie se olvidara de pasarla.
  No es decoración: un niño de seis años necesita objetivos grandes y aire, y un
  estudiante de instituto necesita ver más por pantalla sin que le hablen como a
  un niño.

- **La navegación difiere de verdad, no solo en etiquetas.** Un niño de primaria
  no tiene certificaciones ni portafolio. Compartir la barra y renombrar sería
  mentir sobre lo que hay detrás.

- **El formulario de ingreso funciona sin JavaScript.** `useActionState` sobre un
  `<form action>` degrada a un envío normal del navegador: en un laboratorio con
  equipos viejos o una conexión que corta el bundle a mitad, el alumno sigue
  pudiendo entrar.

- **Esqueletos con la forma del contenido, no spinners.** Un spinner no dice nada
  y hace que la página salte cuando llega el contenido; un esqueleto reserva el
  hueco y evita el desplazamiento de maquetación.

### Errores encontrados y corregidos

- **`/auth/me` no servía para nada.** Devolvía los claims del token, que quien
  llama ya tiene. El nombre, el correo y el avatar no viajan en el token a
  propósito —son millones de tokens en cada petición—, así que el portal no podía
  ni saludar al alumno por su nombre. Ahora lee de la base y devuelve además el
  **portal**, que depende de la edad y de los roles: sacarlo del token dejaría a
  un docente recién nombrado viendo el portal de alumno hasta que su token
  caducara. Los permisos se recalculan desde los roles, no se copian del token,
  porque un rol retirado dejaría el menú mostrando opciones que el backend ya
  rechaza.

- **Un módulo con `'use server'` solo puede exportar funciones asíncronas.**
  `portalPath` era un ayudante síncrono en `auth.actions.ts` y rompía la
  compilación. Movido a `lib/portal.ts`.

- **El nombre de la variable del gateway no coincidía** (`NEXT_PUBLIC_GATEWAY_URL`
  frente al `NEXT_PUBLIC_API_URL` que ya existía en `.env`).

### Un hallazgo que conviene conocer

En `next dev`, **el access token aparece en el HTML**: React 19 serializa en el
payload de depuración los valores que atraviesan sus funciones instrumentadas, y
ahí cae la cookie entera. Se comprobó contra el build de producción y **allí no
aparece**, así que no es una vulnerabilidad desplegada. Aun así conviene no
compartir pantalla ni el `view-source` de un servidor de desarrollo con la sesión
iniciada. `web-check.mjs` distingue los dos casos en vez de dar por bueno
cualquiera de ellos.

### Estado al cerrar

- `pnpm build`: **11/11** (10 del backend más el portal). `pnpm test`: **118**.
- `pnpm smoke`: **51/51**. `pnpm concurrency`: **14/14**. `pnpm smoke:web`: **17/17**.
- Siete procesos en marcha: identity, institutions, catalog, media, gateway, el
  portal y la infraestructura.
- **Sin push todavía**, por decisión del cliente.

### Qué falta de la Fase 4

Las pantallas interiores de los dos portales (laboratorio, cursos, retos,
biblioteca con reproductor, logros, certificaciones, portafolio, perfil), el
registro y la activación de código desde el portal, la internacionalización con
next-intl —hoy los textos están en español en el código— y la auditoría de
accesibilidad pantalla a pantalla.

---

## Sesión 6 — 2026-09-02 — Cierre de la Fase 3

Continuación directa de la sesión 5, en la misma máquina y con la
infraestructura ya en marcha. Se cerraron los cuatro pendientes que quedaban de
la Fase 3.

### Qué se construyó

**Lotes de códigos para imprenta.** `POST /catalog/batches` genera la tirada y
devuelve los códigos **en claro una sola vez**; con `format=csv` la respuesta es
directamente el fichero que va a la imprenta. `GET /catalog/batches/:id` responde
la pregunta comercial de verdad: de los mil libros del colegio, cuántos niños
entraron.

**Canje asíncrono.** Catálogo consume `identity.user.registered.v1` y completa el
canje. Es lo que cierra el flujo del registro sin transacción distribuida:
identidad solo puede *comprobar* el código.

**Anulación de códigos y derechos.** Anular un código retira, en la misma
transacción, el acceso que concedió. `GET /catalog/batches/:id/codes` lista los
códigos por sufijo para que soporte localice la fila.

**Caché de catálogo con invalidación por etiqueta.** `CachedContentRepository`
decora el repositorio y agrupa las entradas por `kit:<id>`. `POST
/catalog/content/:id/status` publica, revisa, devuelve a borrador o archiva, e
invalida el kit entero.

**`media-service` completo.** Subidas con URL prefirmada, validación del tipo
real por firma binaria, miniaturas con sharp y proveedor de video tras un puerto.

### Decisiones no obvias

- **El evento de registro lleva el `activationCodeId`, no el código.** El canje
  asíncrono necesita saber qué fila tocar, pero el código es un secreto con valor
  económico y el evento vive días en la outbox y en el stream. Un UUID de fila no
  permite deducirlo, y el endpoint público solo acepta el código.

- **Las dos vías de canje comparten el mismo caso de uso.** Una busca por hash y
  la otra por id, pero desde el bloqueo de fila en adelante el camino es
  idéntico. La garantía de un solo uso escrita dos veces es la forma segura de
  que una de las copias se quede atrás.

- **No hay endpoint para volver a descargar el CSV de un lote.** En la base solo
  queda el hash, así que reconstruirlo es imposible por diseño. Si alguien lo
  pide, la respuesta es repetir la tirada, no relajar el hasheo.

- **La URL de subida se firma como POST con política, no como PUT.** Es la
  diferencia entre poder limitar el tamaño y no poder: un PUT prefirmado
  autoriza a escribir en esa clave y punto, así que cualquiera con la URL sube un
  fichero de cien gigabytes. La política del POST lleva `content-length-range` y
  es el propio almacén quien rechaza, sin que nosotros veamos un byte.

- **El tipo de un archivo se decide por sus bytes.** La extensión y el
  `Content-Type` los escribe el cliente. `MagicBytesSniffer` tiene una lista
  cerrada de firmas y se escribió a mano en vez de traer una librería de
  detección: una librería genérica reconoce cientos de formatos, y lo que
  interesa aquí es rechazar todo lo que no esté en la lista. La comprobación que
  decide si un fichero entra al bucket no debería depender de código que nadie
  del equipo ha leído.

- **Se leen solo los primeros bytes, con `Range`.** Para decidir si un fichero es
  lo que dice bastan doce. Bajarse dos gigabytes de vídeo por cada subida sería
  absurdo, y con un aula entera entregando evidencias a la vez, ruinoso.

- **El límite de píxeles de sharp no es opcional.** Una imagen de 40000×40000
  comprime a pocos kilobytes y pasa cualquier límite de tamaño, pero obliga a
  reservar gigabytes al descomprimirla. Con subidas abiertas a miles de alumnos
  no es un escenario teórico.

- **La caché no cubre nada que decida un permiso.** Los derechos de acceso se
  consultan siempre contra la base: cachearlos convertiría un acceso retirado en
  un acceso que sigue funcionando hasta que expire.

- **Si la invalidación de caché falla, la operación falla.** Al revés que la
  lectura, que se degrada en silencio. Si alguien archiva un contenido y la caché
  sigue sirviéndolo, quien lo retiró cree que ya no se ve.

- **Publicar exige pasar por revisión.** La tabla de transiciones prohíbe el
  salto de borrador a publicado: este contenido lo ven niños de seis años y la
  revisión es el único punto donde alguien distinto del autor lo mira.

### Errores encontrados y corregidos

- **`redeemed_fields_consistent` impedía anular un código canjeado.** La
  restricción exigía que cualquier estado distinto de `redeemed` tuviera
  `redeemed_by` a NULL. Estaba pensada para los estados que *preceden* al canje y
  atrapaba también a `revoked`, así que la única forma de anular habría sido
  borrar quién lo usó. De los tres motivos de anulación —error de imprenta,
  devolución, fraude— en el tercero ese dato es el principal de la investigación.
  Corregido en la migración `0002`.

- **Anular dos veces daba un conflicto de concurrencia inventado.** Misma clase
  de error que el del inicio de sesión en la sesión 5: el agregado sale sin
  cambiar nada, la versión no avanza y el `UPDATE ... WHERE version < :nueva` no
  encuentra fila. Aquí lo correcto es no escribir, así que se sale antes de
  guardar.

- **Una variable vacía en `.env` no es lo mismo que ausente.**
  `VIDEO_PROVIDER_URL=` llegaba como cadena vacía y `z.string().url().optional()`
  la trataba como valor presente e inválido: el servicio se negaba a arrancar por
  una variable que se dejó en blanco a propósito. Se añadió `optionalEnv` a
  `@glexco/config`.

- **La identidad de git en esta máquina era un marcador de posición**
  (`OTRO_USUARIO <otro_correo@ejemplo.com>`). Los dos commits de la sesión 5
  llevaban ese autor. Como no se habían subido, se reescribieron a
  `SvaleraG <svalera.glexco@gmail.com>`, que es el resto del historial.

### Estado al cerrar

- `pnpm build`: **10/10**. `pnpm test`: **118 en verde**.
- `pnpm smoke`: **51/51**, con secciones nuevas de catálogo, contenido y medios.
- `pnpm concurrency`: **14/14**.
- Cinco servicios en marcha: identity, institutions, catalog, media y el gateway.
- **Sin push todavía**, por decisión del cliente: se subirá cuando haga falta
  probar el backend desplegado.

### Qué falta

**La Fase 3 está cerrada.** El siguiente paso es la **Fase 4**, los portales de
alumno, con la dirección visual ya aprobada en `design/canvas/`.

Sueltos, sin bloquear nada: programar la limpieza de subidas abandonadas
(`listAbandoned` ya existe), contratar el proveedor de video real, y los
endpoints de alta y edición de contenido —hoy se siembra por SQL y solo el cambio
de estado de publicación tiene API—.

---

## Sesión 5 — 2026-09-02 — Primera ejecución real, y cierre del canje asíncrono

Primera sesión en una máquina con Docker. Todo el backend estaba escrito,
compilado y probado en memoria, pero **nunca se había ejecutado**. Al hacerlo
aparecieron nueve fallos que ninguna prueba unitaria podía ver, y las cuatro
comprobaciones de concurrencia de [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md)
pasaron a estar verificadas de verdad.

### Qué se hizo

**La infraestructura arrancó y las migraciones se aplicaron.** Los seis
contenedores en `healthy` y los tres schemas creados (`identity` 7 tablas,
`institutions` 8, `catalog` 11).

**`pnpm smoke` en verde: 32 comprobaciones**, ocho de ellas nuevas.
**`pnpm concurrency` en verde: 14 comprobaciones** que solo tienen sentido
contra infraestructura real.

**Fase 3, dos puntos cerrados:**

- **Generación de lotes y exportación para imprenta.** `POST /catalog/batches`,
  con `format=csv` para el fichero que va a la imprenta, más el resumen del lote
  (`GET /catalog/batches/:id`) que responde a la pregunta comercial de verdad:
  de los mil libros del colegio, cuántos niños entraron.
- **Consumidor en catálogo de `identity.user.registered.v1`.** El canje deja de
  ocurrir solo por HTTP: ahora se completa al consumir el alta, que es lo que
  cierra el flujo del registro sin transacción distribuida.

### Los nueve fallos que solo aparecen al ejecutar

Ordenados por lo que costaba encontrarlos, no por gravedad.

1. **`tsx` rompía la inyección de dependencias en silencio.** El script `dev`
   usaba tsx, que compila con esbuild, y esbuild **no implementa
   `emitDecoratorMetadata`**. Sin esa metadata NestJS no conoce el tipo de los
   parámetros del constructor y le inyecta `undefined` a todos. El servicio
   arrancaba, mapeaba sus rutas, pasaba el health check y reventaba en la
   **primera petición** con `Cannot read properties of undefined`. Es el peor
   modo de fallo posible: silencioso al arrancar y distinto entre desarrollo y
   producción, que sí compila con `tsc`.
   **Solución:** `infra/scripts/dev-service.mjs` compila con `tsc` y vigila, el
   mismo compilador en los dos entornos.

2. **Con la metadata correcta, Nest falló al arrancar** — que es lo que debía
   pasar desde el principio. Tres controladores recibían interfaces
   (`CookieOptions`) o puertos del dominio (`EntitlementRepository`,
   `InstitutionRepositoryPort`), que no existen en tiempo de ejecución. Ahora
   llevan `@Inject(TOKEN)` explícito, y los tokens salieron de los módulos a un
   `tokens.ts` propio para que los controladores puedan importarlos sin ciclo.

3. **Las sondas de salud eran inalcanzables.** El `exclude` del prefijo global
   quitaba el `/api` pero no el segmento de versión, así que `/health/live`
   estaba realmente en `/v1/health/live`; y con los guards globales respondía
   **401**. Un orquestador no lleva token: habría leído cada sonda como réplica
   muerta y habría reiniciado los servicios en bucle. Ahora son
   `VERSION_NEUTRAL` y `@Public()`.

4. **La API interna tenía la versión duplicada.** `internal/v1/...` más el
   versionado por URI daba `/api/v1/internal/v1/...`. Identidad llamaba a la ruta
   sin ese segundo `/v1`, recibía 404 y —porque un 404 significa "ese código no
   existe"— lo traducía a *código de libro inválido*. Un fallo de enrutado
   disfrazado de error de negocio.

5. **El gateway rompía las respuestas grandes.** Copiaba el `content-encoding`
   del servicio de destino hacia el cliente, pero `fetch` ya había descomprimido
   el cuerpo. Solo se notaba por encima del umbral de compresión: el login, por
   el tamaño de la lista de permisos.

6. **El gateway rompía las peticiones sin cuerpo.** Reenviaba el
   `content-length` del cliente y a la vez reserializaba el cuerpo: anunciaba
   cero bytes y enviaba `{}`. El destino cerraba el socket sin responder. En
   login y registro coincidían por casualidad; en `POST /auth/refresh`, no.

7. **Iniciar sesión fallaba con un conflicto de concurrencia inventado.** La
   versión optimista solo avanzaba al emitir un evento de dominio, y un inicio de
   sesión correcto no emite ninguno a propósito (en un ataque serían millones de
   eventos inundando la outbox). Pero sí cambia la fila, así que el
   `UPDATE ... WHERE version < :nueva` no encontraba nada. Se añadió
   `AggregateRoot.touch()`: **emitir un evento y avanzar la versión son dos cosas
   distintas**, y confundirlas rompe justo las operaciones más frecuentes.

8. **El canje siempre daba error 500.** El id del `Entitlement` se construía con
   `hex(16).slice(0,32)`: 32 caracteres sin guiones, que no son un UUID. Se
   añadió `uuid()` al puerto `SecureRandom` para que el error no se repita.

9. **Las migraciones no podían ejecutarse.** Tres cosas: `citext` y `btree_gist`
   las tiene que crear el superusuario del contenedor (el rol de cada servicio no
   tiene `CREATE` sobre la base, y no debe tenerlo); `unaccent()` es `STABLE` y
   PostgreSQL lo rechaza dentro de la expresión de un índice, así que ahora hay
   un `public.immutable_unaccent` que fija el diccionario; y
   `CREATE SCHEMA IF NOT EXISTS` falla igualmente porque el motor comprueba el
   permiso sobre la base **antes** que la existencia del schema.

### Decisiones no obvias de esta sesión

- **El evento de registro lleva el `activationCodeId`, no el código.** El canje
  asíncrono necesita saber qué fila canjear, pero el código es un secreto con
  valor económico y el evento vive días en la outbox y en el stream. El id de una
  fila no permite deducir el código ni sirve para canjear por HTTP, donde el
  endpoint solo acepta el código.

- **Las dos vías de canje comparten el mismo caso de uso.** El canje por HTTP
  busca por hash y el que viene del evento busca por id, pero desde el bloqueo de
  fila en adelante el camino es idéntico. La garantía de un solo uso es la
  invariante más delicada de la plataforma: tenerla escrita dos veces es la forma
  segura de que una de las dos copias se quede atrás.

- **Un código ya canjeado por otro alumno no se reintenta.** Si entre la
  comprobación del formulario y el consumo del evento alguien gana la carrera,
  reintentar no puede arreglarlo: se registra y se da el evento por procesado. El
  alumno queda registrado sin acceso al kit, que es recuperable por soporte;
  reventar y reprocesar el alta no le devolvería el código.

- **No hay endpoint para volver a descargar el CSV de un lote,** y es
  deliberado. En la base solo queda el hash de cada código, así que reconstruir
  el fichero es imposible por diseño: un volcado de la tabla no debe convertirse
  en miles de accesos vendibles. La respuesta de generación lo advierte de forma
  explícita.

- **Los códigos se generan FUERA de la transacción.** Cien mil códigos son
  varios segundos de CPU; tener una transacción abierta mientras tanto retendría
  una conexión y bloquearía el vacuum sin necesidad.

- **`pnpm smoke` prueba la ventana de gracia por sus dos lados.** La prueba
  anterior reutilizaba el refresh token antiguo cincuenta milisegundos después y
  esperaba que se detectara como robo. Era la prueba la que estaba mal: esa
  ventana de diez segundos existe justamente para que dos pestañas del mismo
  navegador no se cierren la sesión entre ellas. Ahora se comprueba que dentro de
  la ventana se acepta y fuera se revoca.

- **Postgres se publica en el puerto 5433 en esta máquina.** El 5432 lo ocupa
  otro proyecto del cliente; se parametrizó el puerto en el compose
  (`GLEXCO_POSTGRES_PORT`, en `infra/docker/.env`) en vez de parar un contenedor
  ajeno.

### Herramientas nuevas

| Comando | Qué hace |
|---|---|
| `pnpm seed` | Kit, lote de códigos, institución y salón. Necesario desde que identidad habla con el catálogo real en vez de con el doble en memoria. |
| `pnpm concurrency` | Las cuatro comprobaciones de la sección 3 de PUESTA-EN-MARCHA, con `Promise.all`. |
| `pnpm smoke` | Ahora 32 comprobaciones, con una sección de catálogo. |

### Estado al cerrar

- `pnpm build`: **9/9**. `pnpm test`: **118 en verde**.
- `pnpm smoke`: **32/32** a través del gateway.
- `pnpm concurrency`: **14/14** contra Postgres, Redis y NATS reales.
- Un canje de veinte simultáneos, cinco plazas de veinte solicitudes, la outbox
  reteniendo el evento con NATS parado y publicándolo al volver, y el mismo
  evento entregado dos veces aplicándose una.

### Qué falta

**Fase 3:** `media-service` (subida con URL prefirmada, validación de tipo real,
proveedor de video), caché de catálogo con invalidación por etiqueta al
publicar, y revocación de códigos y derechos —el permiso
`ACTIVATION_CODE_REVOKE` existe pero todavía no hay caso de uso que lo ejerza.

**Aviso para la próxima sesión:** `ACTIVATION_REDEEM_BY_IP` son cinco intentos
por IP y hora, y `REGISTRATION_BY_IP` diez. Son los valores correctos y no hay
que relajarlos, pero agotan el presupuesto en dos o tres ejecuciones seguidas de
`pnpm smoke` desde la misma máquina. Para limpiarlos:

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL"
```

---

## Sesión 4 — 2026-09-02 — Fases 2 y 3, y dirección visual

### Qué se construyó

**Fase 2 cerrada** — servicio `institutions`: instituciones, licencias, salones
con tope de plazas, matrículas, consumidor de eventos de identidad y tarea de
vencimiento de licencias. Detalle en la entrada de la sesión anterior y en el
roadmap.

**Fase 3 avanzada** — servicio `catalog`: el núcleo del modelo de negocio.
`ActivationCode`, `Entitlement`, kits y contenido académico, con repositorios
PostgreSQL, API HTTP y el endpoint interno que consulta identidad durante el
registro.

**Dirección visual aprobada** — canvas de 10 artboards en `design/canvas/`,
publicado como artifact: ingreso, los cuatro portales, fundamentos, iconografía
propia, dos vistas móviles y modo oscuro.

### Decisiones no obvias

- **El código de activación se guarda hasheado**, con una pimienta que vive en
  configuración y no en la base. Un volcado de la tabla no debe convertirse en
  miles de accesos vendibles. Se usa SHA-256 y no Argon2 porque el código tiene
  ~60 bits de entropía genuina: no hay diccionario que atacar, y un hash lento
  solo añadiría latencia al registro.

- **`ACTIVATION_CODE_PEPPER` no tiene valor por defecto.** Si lo tuviera, un
  despliegue descuidado usaría el de ejemplo y los hashes serían reproducibles
  por cualquiera que lea el repositorio. Cambiarla invalida todos los códigos
  emitidos: se fija una vez y no se rota.

- **Generación con `randomInt` de `node:crypto`, no `Math.random`.** El segundo
  es predecible desde la semilla del proceso: quien observara unos códigos de un
  lote podría predecir el resto. `randomInt` evita además el sesgo módulo que
  introduciría `bytes % alfabeto`.

- **El `Entitlement` se crea en la misma transacción que el canje.** Hacerlo
  después dejaría al alumno con el código quemado y sin acceso si algo fallara
  entre medias, y ese código ya no volvería a servir.

- **Los eventos no llevan el código.** Viven días en la outbox y en el stream, y
  ningún consumidor lo necesita.

- **`listLibrary` exige `kitId` obligatorio** y no existe un listado global de
  contenido en la interfaz del repositorio: sería el atajo por el que se
  filtraría material de kits no comprados.

- **La paleta salió del logo real**, no de una suposición. Descargué el SVG de
  glexrobotics.com: `#2C53A0` y `#86C9BD` son las dos paradas de su degradado.
  Antes había construido la paleta deduciéndola de las maquetas, y estaba mal.

### Errores corregidos

- **El logger estaba roto en silencio.** Las firmas de pino y de `LoggerPort`
  están invertidas, y el casteo que había hacía que pino interpretara el mensaje
  como contexto: las líneas de log salían sin los campos por los que hay que
  filtrar en producción. Se añadió `toLoggerPort` y dos tokens de inyección
  distintos para que el error no se pueda repetir.

- **`upsert` para renombrar borraba datos.** Reflejar un cambio de nombre en el
  directorio de docentes con un upsert borraba la institución y el correo, que
  ese evento no trae. Se añadió `rename`.

- **Mi reemplazo automático del logo rompió la pantalla de ingreso**: dejó un
  `</div>` de más que cerraba el panel de marca antes de tiempo. Lo detectó el
  cliente en una captura. Ahora hay una comprobación de balance de etiquetas.

- **Fundamentos declaraba 1180px con 1660px de contenido** y recortaba una
  sección entera; el gris de las etiquetas pequeñas daba 3,05:1 sobre blanco; y
  había tres contradicciones de contenido entre portales sobre el kit y el grado
  del mismo alumno.

### Estado al cerrar

- **9 paquetes y servicios compilan. 118 pruebas en verde**, en memoria y sin
  Docker.
- **Nada se ha ejecutado nunca contra infraestructura real.** Docker no llegó a
  arrancar en esta máquina: corrupción del almacén de componentes de Windows
  (`0x80188306`, doble titularidad de dos ensamblados de `Microsoft.GroupPolicy`)
  que resistió a `StartComponentCleanup`, `ResetBase`, `RestoreHealth` y `sfc`.
  Lo que queda es una reparación en el sitio del sistema operativo.

### Siguiente paso

Levantarlo en una máquina con Docker y verificar las cuatro cosas que justifican
la arquitectura y que **la concurrencia real puede desmentir**: el canje de un
solo uso, el tope de plazas, que la outbox no pierde eventos y la deduplicación.
Todo el procedimiento está en [PUESTA-EN-MARCHA.md](PUESTA-EN-MARCHA.md).

---

## Sesión 3 — 2026-09-02 — Cierre de la Fase 1 y gateway

### Qué se construyó

**Casos de uso que faltaban en identidad:**
- `ChangePasswordUseCase` — cambio de contraseña autenticado.
- `CreateStaffUserUseCase` — alta de docentes, administradores de institución y
  personal GLEXCO, con contraseña temporal de un solo uso.
- `ListSessionsUseCase` / `RevokeSessionUseCase` — gestión de sesiones activas.
- `AccountController` y `UsersController` para exponerlos.

**Servicio `api-gateway`**, el único expuesto a internet:
- Tabla de enrutado **explícita** (prefijo público → servicio interno).
- Propagación y saneado del `x-correlation-id`.
- Rate limiting en el borde, más estricto en las rutas de autenticación.
- Un circuit breaker **por servicio**.
- Sondas `live`/`ready` y apagado ordenado con drenaje.

**Herramientas de desarrollo:**
- `pnpm setup` (`infra/scripts/setup-env.mjs`) genera `.env` con secretos
  criptográficos reales y nunca sobrescribe uno existente.
- `pnpm smoke` (`infra/scripts/smoke-test.mjs`) ejecuta 22 comprobaciones de
  punta a punta contra los servicios en ejecución.
- Los scripts `dev` y `start` usan `node --env-file-if-exists`, que carga el
  `.env` en local y no falla en Railway, donde las variables las inyecta la
  plataforma y el archivo no existe.

**21 pruebas nuevas** (total: **65**), centradas en lo que puede causar daño real:
aislamiento entre instituciones, escalada de privilegios, y que nadie pueda
cerrar la sesión de otro usuario.

### Decisiones no obvias de esta sesión

- **El cambio de contraseña exige la contraseña actual** aunque la sesión ya esté
  autenticada. En un laboratorio escolar las sesiones se quedan abiertas
  constantemente; sin esta comprobación, sentarse ante un equipo ajeno bastaría
  para apropiarse de la cuenta. Con ella, el descuido es temporal en vez de
  definitivo.

- **`CreateStaffUserUseCase` IGNORA el `institutionId` del cuerpo** cuando el
  actor tiene ámbito de institución, y usa el del token. Aceptarlo permitiría a
  un administrador crear docentes en otro colegio cambiando un solo campo. Hay
  tres controles y ninguno sustituye a los otros: permiso (guard), matriz de
  roles (agregado) y ámbito (caso de uso). El tercero **solo** puede vivir en el
  caso de uso, porque el guard no ve el cuerpo y el agregado no sabe a qué
  institución pertenece quien envía la petición.

- **Revocar una sesión comprueba que sea propia.** Sin esa comprobación, conocer
  un id de sesión bastaría para expulsar a cualquiera de la plataforma. Además,
  "no existe" y "es de otro" devuelven el mismo error, para no permitir sondear
  qué ids son reales.

- **El gateway usa `fetch` nativo en lugar de `http-proxy-middleware`.** No es
  minimalismo: hacen falta tres cosas que esa librería resuelve de forma opaca —
  qué cabeceras se propagan en cada sentido (para que un cliente no inyecte
  cabeceras de confianza ni se filtren las internas), el timeout por petición, y
  el circuit breaker por servicio.

- **`x-forwarded-for` entrante se descarta.** El gateway la fija desde la
  conexión real. Aceptar la del cliente permitiría falsificar la IP de origen y
  esquivar toda la limitación por IP.

- **La tabla de enrutado es explícita, no por convención.** Con enrutado por
  convención, añadir un servicio interno nuevo lo expondría a internet sin que
  nadie tomara la decisión.

### Verificaciones ejecutadas

Sin Docker todavía, pero sí contra los artefactos reales compilados:

| Comprobación | Resultado |
|---|---|
| `pnpm build` | 7/7 paquetes y servicios compilan |
| `pnpm test` | **65 pruebas en verde** (~60 ms) |
| Carga de configuración con `.env` real | Válida; secretos de access y refresh distintos |
| Argon2id nativo (`@node-rs/argon2`) | Hash 13 ms, verificación correcta, `needsRehash` detecta parámetros débiles |
| Interoperabilidad con bcrypt | Argon2 verifica un hash bcrypt heredado y lo marca para rehash |
| Emisión de JWT | Access 379 bytes, 15 min; refresh 12 h sin "recordarme" y 30 días con él |
| Defensa: access como refresh | Rechazado (secretos distintos) |
| Defensa: `alg: none` | Rechazado |
| Defensa: audiencia incorrecta | Rechazada |
| Marca `crit` | Ausente en alumnos (ahorra bytes), presente en administradores |

### Estado del entorno

- **Docker Desktop instalado, pero no arranca.** Diagnóstico ejecutado:
  la virtualización **sí funciona** (`systeminfo` reporta "Seguridad basada en
  virtualización: En ejecución" y "Se detectó un hipervisor"; el
  `VirtualizationFirmwareEnabled: False` de `Win32_Processor` es un espejismo,
  porque con un hipervisor activo Windows no ve los flags crudos de la CPU).
  Lo que falta es **WSL**: `wsl --status` responde "El Subsistema de Windows para
  Linux no está instalado".
  **Solución:** `wsl --install` en PowerShell **como administrador** y reiniciar.
- Aviso: el equipo tiene **App Control for Business en modo "Forzado"**. Si es un
  portátil gestionado por TI, esa política puede bloquear la instalación de WSL.

### Siguiente paso

1. Con Docker en marcha: `pnpm infra:up`, `db:migrate`, arrancar identidad y
   gateway, y ejecutar `pnpm smoke`.
2. Fase 2 — instituciones, salones y licencias. O bien el canvas de Claude Design
   antes, para validar la dirección visual y la iconografía.

---

## Sesión 2 — 2026-09-02 — Fase 1: servicio de identidad

### Qué se construyó

El **microservicio `identity`** completo en su parte de autenticación, con
arquitectura hexagonal estricta.

**Dominio** (`src/domain/`, cero dependencias de framework):
- Agregado `User` con todas sus invariantes: alta de alumno, alta de personal,
  verificación de correo, cambio de contraseña, concesión y retirada de roles,
  desactivación y reactivación, bloqueo progresivo por intentos fallidos.
- Objetos de valor `Email`, `PersonName`, `BirthDate`, `PasswordHash`,
  `LocalePreference`, `UserId`.
- Ocho eventos de dominio versionados.
- `Session` y `SessionStore` como puerto (vive en Redis, no en PostgreSQL).

**Aplicación** (`src/application/`):
- `RegisterStudentUseCase`, `LoginUseCase`, `RefreshSessionUseCase`,
  `LogoutUseCase`, `VerifyEmailUseCase`, `RequestPasswordResetUseCase`,
  `ConfirmPasswordResetUseCase`.
- Puertos propios: `TokenIssuer`, `OneTimeTokenStore`, `ActivationCodeGateway`,
  `ClassroomGateway`, `PasswordPolicy`, `AuditLog`.
- `resolvePortal`: decide Discover / Academy / Teacher / Institution / Admin.

**Infraestructura** (`src/infrastructure/`):
- `Argon2PasswordHasher` (Argon2id, con bcrypt para migración y rehash automático).
- `JwtTokenIssuer` (secretos separados, algoritmo fijado).
- `PgUserRepository` con reparto entre pool de escritura y de lectura.
- `RedisSessionStore` con rotación atómica en Lua.
- `PgOneTimeTokenStore` (guarda el hash, nunca el token).
- `PgAuditLog` con escritura en lote diferida.
- `DefaultPasswordPolicy` (NIST SP 800-63B).
- Gateways HTTP con circuit breaker + dobles en memoria para desarrollo.

**Interfaz**: `AuthController` con registro, login, refresh, logout,
verificación de correo, recuperación de contraseña y `/me`.

**Persistencia**: migración `0001_identity_schema.sql` con `citext` para el
correo, índices parciales, restricciones `CHECK` que replican reglas del dominio
y concurrencia optimista. Ejecutor de migraciones (`infra/scripts/migrate.mjs`)
con cerrojo de aviso de PostgreSQL.

**Pruebas**: 44 pruebas en memoria (26 de dominio, 18 de casos de uso) que corren
en ~30 ms **sin Docker**, usando dobles escritos a mano de todos los puertos.

### Decisiones no obvias de esta sesión

- **El hash de la contraseña se calcula EL ÚLTIMO en el registro.** Argon2 cuesta
  ~80 ms y 19 MiB por operación. Si se hiciera antes de validar el correo
  duplicado y el código de activación, un atacante conseguiría que el servidor
  gastara ese coste en cada petición basura. Colocarlo detrás de todas las
  validaciones baratas es una defensa concreta contra el agotamiento de CPU.

- **Hash señuelo cuando el usuario no existe.** Sin él, "no existe" responde en
  microsegundos y "contraseña incorrecta" en decenas de milisegundos, y esa
  diferencia permite enumerar qué correos están registrados. El señuelo se
  calcula una sola vez por proceso: generarlo en cada intento convertiría la
  enumeración en un ataque de agotamiento de CPU.

- **Ventana de gracia de 10 s en la rotación del refresh token.** Dos pestañas
  del mismo navegador refrescan a la vez con frecuencia. Sin la gracia, la
  segunda parecería una reutilización y al usuario se le cerraría la sesión sin
  que nadie le haya robado nada. Un token robado nunca llega dentro de esa
  ventana.

- **El registro NO canjea el código de activación de forma síncrona.** Eso
  exigiría una transacción distribuida con catálogo, que no existe. Se hace una
  comprobación previa de lectura (para que un código inválido falle de inmediato
  en el formulario) y el canje real ocurre cuando catálogo consume
  `identity.user.registered.v1`, de forma idempotente y compensable.

- **El bloqueo de cuenta es temporal y creciente, nunca permanente.** Un bloqueo
  permanente convierte el ataque en una denegación de servicio contra el usuario
  legítimo: cualquiera que sepa un correo podría dejar fuera a esa persona.

- **`findByEmailForAuth` va contra el pool de ESCRITURA.** Es una lectura, pero
  alguien que acaba de registrarse e inicia sesión de inmediato no puede toparse
  con que la réplica todavía no lo tiene.

- **Los adaptadores en memoria de catálogo e instituciones no pueden llegar a
  producción.** `loadIdentityConfig` aborta el arranque si faltan `CATALOG_URL`
  o `INSTITUTIONS_URL` en producción. Sin esa comprobación, un despliegue
  descuidado aceptaría cualquier código que empezara por `GLX-TEST` y regalaría
  acceso al contenido de pago.

- **La fecha de nacimiento se calcula por componentes, no dividiendo
  milisegundos.** La división acumula error con los años bisiestos y puede dar 13
  a alguien que ya cumplió 14: exactamente donde se decide si se exige el correo
  del apoderado.

### Errores corregidos durante la sesión

- `declare private` en `Identifier` → TS4094 al devolverlo desde `defineId`.
  Pasó a `declare readonly`.
- `TransactionContext` con marca de símbolo obligatoria hacía imposible construir
  la transacción sin un `as unknown`. Pasó a marca opcional.
- Una prueba fallaba porque el fixture creaba un alumno de 10 años sin correo de
  apoderado. **El dominio tenía razón**: se corrigió la prueba, no la regla.

### Estado al cerrar

- Los 5 paquetes compartidos y el servicio `identity` **compilan sin errores**.
- **44 pruebas en verde.**
- Sigue abierto el bloqueo de **Docker Desktop no instalado**: sin él no se puede
  ejecutar el servicio ni hacer pruebas de integración. Todo lo entregado se ha
  verificado por compilación y pruebas unitarias.
- Repositorio publicado en
  <https://github.com/GLEXROBOTICS-DEV/glexco-backend-edu-platform>, rama `main`,
  106 archivos. Recordatorio permanente: **los commits nunca llevan
  `Co-Authored-By`**.
- **Decisión: monorepo único** (backend + frontend en el mismo repositorio).
  El motivo es `@glexco/contracts`: en monorepo, renombrar un permiso rompe la
  compilación del frontend al instante; en repos separados habría que publicar
  el paquete a GitHub Packages, versionarlo y bumpearlo en cada cambio de
  contrato, que es justo lo que más va a cambiar los próximos meses.
  En Railway se despliega como N servicios sobre el mismo repositorio, cada uno
  con su *Root Directory* y sus *Watch Paths* para que tocar el frontend no
  redespliegue los ocho servicios del backend.
- El repositorio está **público** por ahora; el cliente lo pasará a privado.

### Siguiente paso

Cerrar los pendientes de la Fase 1 listados en [ROADMAP.md](ROADMAP.md)
(cambio de contraseña, alta de personal por HTTP, gestión de sesiones,
`api-gateway`) y arrancar la Fase 2 (instituciones y salones).

---

## Sesión 1 — 2026-09-02 — Fase 0: cimientos

### Contexto de partida

El proyecto empezó desde cero con la propuesta comercial (PDF de 15 páginas y 5
maquetas HTML rústicas) en `~/Downloads/PROPUESTA DE CONTENIDO PLATAFORMA ONLINE
- REVISAR/`. El directorio de trabajo estaba vacío.

Se extrajo el PDF con `pypdf` y se analizaron las maquetas. El contenido
funcional está destilado en [DOMINIO.md](DOMINIO.md); **el PDF ya no hace falta**.

### Decisiones consultadas con el cliente

Se preguntaron cuatro cosas que cambiaban la arquitectura de raíz:

| Pregunta | Respuesta |
|---|---|
| ¿Dónde viven los videos y materiales pesados? | **Híbrido**: video largo en proveedor externo privado, documentos en almacenamiento propio con URL prefirmada. |
| ¿Qué nivel necesita la mensajería profesor↔alumno? | **Anuncios asíncronos**, sin WebSockets. |
| ¿Cómo repartimos la persistencia? | **Un PostgreSQL, un schema y un rol por servicio.** |
| ¿Qué alcance en la primera entrega? | **Toda la propuesta**, por fases y sesiones, documentando en `.md`. |

Después el cliente añadió el requisito de escala (~8M registrados, ~400k
concurrentes en punta), que se analizó en [ESCALABILIDAD.md](ESCALABILIDAD.md), y
pidió que la iconografía no use sets por defecto.

### Qué se construyó

**Monorepo** con pnpm 11 + Turborepo, TypeScript en modo estricto
(`noUncheckedIndexedAccess` incluido).

**`@glexco/kernel`** — bloques de construcción del dominio, sin una sola
dependencia de framework:
- `Identifier` tipado por agregado, para que el compilador impida pasar un
  `StudentId` donde se espera un `ClassroomId`.
- `AggregateRoot` con versión optimista y acumulación de eventos de dominio.
- `ValueObject`, `Guard` (invariantes en el constructor, no en el controlador).
- Jerarquía `DomainError` con categoría semántica, no códigos HTTP.
- Puertos hexagonales: `CacheStore`, `UnitOfWork`, `PasswordHasher`,
  `ObjectStorage`, `EventPublisher`, `DistributedLock`, `Mailer`, `Clock`,
  `SecureRandom`, `LoggerPort`.
- Paginación **por cursor**, no por `OFFSET`.

**`@glexco/contracts`** — el vocabulario que comparten backend y frontend:
- 8 roles con ámbito (`platform` / `institution` / `classroom` / `self`), ~70
  permisos y la matriz rol→permisos.
- `ROLE_CREATION_MATRIX`: qué rol puede crear qué rol. Cierra la escalada de
  privilegios de forma explícita.
- Vocabulario de dominio: programas, niveles, grados peruanos, plataformas
  robóticas UBTECH, tipos de contenido, estados de publicación, progreso,
  evaluación, gamificación, licencias, códigos de activación.
- Catálogo de eventos de integración versionados.
- Esquemas Zod compartidos, incluido el de registro de alumno con unión
  discriminada institucional/independiente.

**`@glexco/config`** — validación de entorno que **aborta el arranque** si falta
o está mal una variable, con comprobaciones extra en producción (secretos que
siguen siendo los de ejemplo, `COOKIE_SECURE=false`, access y refresh con el
mismo secreto).

**`@glexco/observability`** — logs JSON con contexto de correlación inyectado
por `AsyncLocalStorage`, redacción automática de campos sensibles
(`password`, `token`, `activationCode`…) y trazas OpenTelemetry.

**`@glexco/nest-platform`** — todo lo que debe ser idéntico en los ocho
servicios:
- `DomainExceptionFilter`, `CorrelationMiddleware`, `ZodValidationPipe`.
- `JwtAuthGuard` (verificación local, algoritmo fijado) y `PermissionsGuard`.
- `RedisCacheStore` con etiquetas y protección anti-estampida.
- `RedisDistributedLock` con token de propiedad y liberación atómica en Lua.
- `RateLimiter` de ventana deslizante en Lua, con políticas por operación.
- Pools separados de escritura y lectura, con `statement_timeout`.
- `PgUnitOfWork` con outbox transaccional y reintentos ante deadlock.
- Cliente NATS JetStream y `OutboxRelay` con `SKIP LOCKED` y backoff.
- `CircuitBreaker` cerrado/abierto/semiabierto.
- `HealthController` con las tres sondas diferenciadas.
- `bootstrapService()` con apagado ordenado y drenaje.

**Infraestructura local** (`infra/docker/`): Postgres 16, Redis 7 con AOF, NATS
JetStream, MinIO con cuatro buckets privados, Mailpit, Jaeger. Scripts de
inicialización que crean schema y rol por servicio, más las tablas `outbox` y
`processed_events` con índices parciales.

**Documentación**: `CLAUDE.md`, `ARQUITECTURA.md`, `ESCALABILIDAD.md`,
`DOMINIO.md`, `ROADMAP.md` y esta bitácora.

### Por qué se decidió así (lo no obvio)

- **Argon2id en lugar de bcrypt**, pese a que el cliente mencionó bcrypt. Es la
  recomendación actual de OWASP: resiste el ataque con GPU al ser duro en
  memoria. La decisión es reversible: el puerto `PasswordHasher` acepta ambos y
  `needsRehash` permite migrar sin que nadie cambie su contraseña.

- **Política de contraseñas sin reglas de composición.** Longitud mínima de 8 y
  rechazo de contraseñas filtradas, siguiendo NIST SP 800-63B. Exigir mayúsculas
  y símbolos empuja a patrones predecibles, y aquí hay niños de 6 años.

- **Alfabeto del código de activación sin `0/O/1/I/L`.** Un niño copiando de un
  libro de papel no debe perder su acceso por un carácter ambiguo. Quedan 31
  símbolos; con 12 posiciones el espacio sigue siendo 7,9·10¹⁷.

- **Rate limiter fail-open.** Si Redis cae y bloqueamos todo, convertimos una
  degradación de caché en una caída total. Los límites duros de verdad (WAF,
  balanceador) van delante.

- **Separación de pools de lectura/escritura desde el día uno**, aunque en local
  apunten al mismo Postgres. Evita una migración dolorosa después.

- **`live` no toca dependencias.** Si la sonda de liveness comprobara Redis, una
  caída de Redis reiniciaría en bucle todas las réplicas.

### Problemas del entorno resueltos (no repetir)

1. `corepack enable pnpm` falla con `EPERM` (escribe en `C:\Program Files\nodejs`).
   Solución: `npm i -g pnpm`.
2. pnpm 11 **ignora** el campo `pnpm` de `package.json`; `onlyBuiltDependencies`
   va en `pnpm-workspace.yaml`. Tras cambiarlo hace falta un `pnpm rebuild`.
3. Los **heredocs de Bash con TypeScript grande se corrompen** en este entorno.
   Escribir archivos con la herramienta de escritura o con Python
   (`io.open(..., newline='\n')`).
4. **Caracteres de control literales en expresiones regulares** se corrompen al
   pasar por el shell. Se reemplazó por `hasForbiddenControlChars`, que recorre
   puntos de código.
5. `@opentelemetry/resources` 1.30 no exporta `resourceFromAttributes` (es de la
   2.x). Se usa `new Resource({...})` con claves de atributo literales.
6. `declare private` en una clase devuelta desde una función da **TS4094**. La
   marca de tipo de `Identifier` es `declare readonly`, sin `private`.

### Estado al cerrar

- Los **5 paquetes compartidos compilan** sin errores (`tsc` limpio).
- `services/*` y `apps/web` son carpetas vacías.
- **Bloqueo abierto: Docker Desktop no está instalado.** Sin él no hay Postgres,
  Redis, NATS ni MinIO locales, así que ningún servicio puede ejecutarse todavía.
  WSL2 sí está disponible, que es el backend que Docker Desktop necesita.
- Repositorio Git **no inicializado todavía**: el cliente enviará el enlace
  correcto de GitHub. Regla fijada: **los commits nunca llevan `Co-Authored-By`**.

### Siguiente paso

**Fase 1 — identidad y acceso** (en curso): `identity-service` completo y
`api-gateway`. Ver [ROADMAP.md](ROADMAP.md).
