# Guía de demostración — GLEXCO

**Para quién es:** para enseñar la plataforma a otra persona en 20–30 minutos,
sin instalar nada y sin conocer el código. Todo pasa en el navegador.

**Dónde:** <https://glexcoweb-production.up.railway.app>

**Contraseña de todas las cuentas de demostración:** `GlexcoDemo2026`

> Antes de empezar, abre el portal una vez y espera a que cargue. Railway
> duerme los servicios sin uso y el primer acceso tarda unos segundos; el
> segundo ya es inmediato. Si vas a presentar, ábrelo cinco minutos antes.

---

## Recorrido en 8 paradas

Está ordenado como una historia —el alumno usa, el docente corrige, la dirección
mide, GLEXCO administra—, que es como se entiende el producto. Si tienes menos
tiempo, las paradas 2, 4 y 6 son las que más se ven.

### 1. El acceso y el alta de un alumno (5 min)

1. Entra en `/registro` **sin sesión**.
2. Código de colegio: **`DEMO-SMP`**. Verás que aparecen los salones reales del
   colegio, no una lista escrita a mano.
3. Elige grado **4.º de primaria** y usa un código de activación libre:
   `GLX89Y5J7CP82EV`.
4. Completa el alta y entra.

**Qué enseñar aquí:**

- El registro va **en dos pasos y sin JavaScript**: es un formulario del
  servidor. En un aula con equipos viejos o con la red cayéndose, esto es la
  diferencia entre poder entrar y no.
- El código **caduca al canjearse**. Vuelve a intentarlo con el mismo y verás
  que lo rechaza. Ese canje va dentro de una transacción con bloqueo de fila:
  veinte alumnos pulsando a la vez sólo dan un acceso.
- Un alumno **menor de 14** pide el correo de su apoderado, y la verificación se
  manda a los dos por separado, nunca en copia.

*Si el registro te da «demasiados registros desde esta conexión», es el límite
de fuerza bruta funcionando: diez por IP y hora. Para presentar, usa una cuenta
ya sembrada en vez de crear una.*

### 2. El portal del alumno — Discover, primaria (5 min)

Entra como **`alumno1@demo.glexco.pe`**. Es el mejor caso: curso completo, nota
100, insignias y XP.

| Mirar | Dónde | Qué demuestra |
|---|---|---|
| Portada | `/discover` | Su kit, sus misiones y los anuncios de su docente |
| Biblioteca | `/discover/biblioteca` | Vídeo, ficha descargable y enlace externo |
| Mi progreso | `/discover/progreso` | Nivel de Explorador, XP, insignias y notas |
| Zona de retos | `/discover/retos` | Los retos de construcción con su plazo |
| Mi portafolio | `/discover/portafolio` | Lo que ha entregado, con su foto |
| Robot Lab | menú lateral | Enlaces a las páginas oficiales de UBTECH |

**Qué enseñar aquí:**

- **No hay ranking, y es una decisión.** El progreso se compara sólo con uno
  mismo. Entre menores, señalar al último no motiva a nadie.
- El **modo claro/oscuro y el idioma** viven en el perfil (abajo en la barra).
  Cambia a inglés y recorre el portal: cambia todo el cuerpo, no sólo el menú.
- La ficha descargable se sirve con una **URL firmada de vida corta**. Copia el
  enlace, ábrelo en una pestaña de incógnito y a los minutos deja de funcionar:
  el almacén es privado.

### 3. El portal del alumno — Academy, secundaria (2 min)

Entra como **`alumno3@demo.glexco.pe`**.

Es el **mismo backend y otro portal**: tipografía sobria, más densidad, sin
gamificación infantil. Se decide por el **grado** del alumno, no por una opción
que alguien elija.

Y entra como **`alumno8@demo.glexco.pe`**: no tiene kit activado. Verás el
estado vacío con su formulario de activación, que es lo que ve de verdad un
alumno cuyo libro aún no llegó.

### 4. Responder una evaluación (5 min)

Con cualquier alumno, entra en `/discover/evaluaciones` y abre una.

**Qué enseñar aquí:**

- Lo de **marcar se corrige al instante**: la nota aparece en la misma pantalla.
  Si llegara tres días después, el cuestionario ya no serviría para aprender.
- **Recargar no gasta un intento.** Ver el resultado y gastar un intento son dos
  pantallas distintas, a propósito.
- Hay **siete tipos de pregunta**: una respuesta, varias, verdadero/falso,
  respuesta escrita, **ordenar una secuencia**, **emparejar dos columnas** y
  **entrega de archivo o enlace**.
- Ordenar y emparejar puntúan **parcialmente** —cuántas piezas quedaron en su
  sitio, cuántas parejas acertaste—, y se responden con un desplegable por fila
  y **no arrastrando**: arrastrar exige JavaScript, es casi imposible con lector
  de pantalla y falla con el dedo de un niño en una tableta.
- En emparejar, la columna derecha llega **desordenada**: si saliera en el orden
  en que el docente la escribió, emparejar en fila acertaría todo.
- **Abre las herramientas del navegador y mira la respuesta de red.** La clave
  de corrección no está. Un cuestionario cuyas respuestas viajan al navegador no
  evalúa nada, y que la pantalla «no las pinte» no sirve de nada.
- Si la pregunta es de entrega, sube una **foto de más de 5 MB**: el navegador
  la reduce **antes** de que salga del dispositivo. Se ve el aviso «reduciendo
  foto». Un móvil produce fotos de 12 MB y el límite del servicio son 12 MB.
- La evidencia es **opcional**: lo normal es que el docente lo revise en clase.
  Cuando es a distancia, el alumno pega el **enlace** a su vídeo en el Drive o
  el OneDrive del centro. No subimos vídeos.

### 5. El docente corrige (5 min)

Entra como **`docente1@demo.glexco.pe`**.

| Mirar | Dónde | Qué demuestra |
|---|---|---|
| Panel de su salón | `/docentes` | Media **y dispersión**, no sólo la media |
| Preguntas más falladas | mismo panel | El dato más accionable que tiene |
| Bandeja de corrección | `/docentes/salones/…/correccion` | Entregas con el nombre real del alumno |
| Sus evaluaciones | `/docentes/evaluaciones` | El banco del kit y el suyo, separados |
| Anuncios y muro | `/docentes/anuncios` | Publicar; el alumno lo ve en su portada |

**Qué enseñar aquí:**

- La bandeja está ordenada **por lo que hay que hacer**: lo abierto primero, lo
  que corrigió la máquina plegado como referencia. Un examen de veinte preguntas
  con dos abiertas no debe obligar a bajar veinte tarjetas.
- Abre una entrega con **rúbrica**: en vez de escribir un número, el docente
  elige un nivel por criterio —montaje, cableado, explicación— y la suma se ve
  en vivo. **La nota la calcula el servidor a partir de los niveles**, así que
  un total manipulado no otorga nada.
- Crea una evaluación tuya y luego intenta **editar una de GLEXCO**: no te deja,
  te ofrece **duplicarla**. Es la misma para todos los colegios; editarla
  cambiaría el examen de todo el país.
- El **muro del salón** es un tablón, no un chat: el alumno también pregunta y
  lo ve toda la clase. **No existe ningún canal privado entre un adulto y un
  menor**, y eso es deliberado.

### 6. La dirección del colegio (3 min)

Entra como **`director@demo.glexco.pe`**.

**Qué enseñar aquí:**

- La **eficacia docente se mide por progreso, no por nota**. Medirla por nota
  premia al profesor que pone exámenes fáciles.
- Cada fila lleva **el tamaño de su muestra**, y el aviso viaja junto al dato:
  una media de tres alumnos no dice lo mismo que una de treinta.
- Ve la ficha individual de un alumno: sus notas y su evolución.
- **Exporta**: en cada gráfico hay `CSV` y `PDF`. El CSV lo abre Excel
  directamente con los acentos bien; el PDF lo hace el navegador y conserva los
  gráficos, porque son SVG.
- Y prueba a entrar en `/admin`: **no puede**. No es que la pantalla lo esconda,
  es que el backend se lo niega.

### 7. GLEXCO, la plataforma (3 min)

Entra como **`glexco@demo.glexco.pe`** y ve a `/admin`.

**Qué enseñar aquí:**

- Todos los colegios, con su **nombre y su ciudad** —que llegan por evento, sin
  que la analítica consulte el schema de nadie— y los kits con peor resultado.
  Si un kit va mal en todas partes, el problema es del contenido.
- Da de alta **un colegio nuevo**, concédele su licencia, crea una cuenta de
  personal y genera un **lote de códigos** de imprenta. Las cuatro cosas se
  hacen desde la pantalla.
- Al crear personal, la contraseña temporal **se muestra una vez**: no se manda
  ningún correo, y la pantalla lo dice en vez de prometerlo.

### 8. Un certificado, y su verificación pública (2 min)

Desde el Teacher Center, emite un certificado a un alumno que haya **completado**
el curso —a quien no lo terminó no se le puede emitir—, o emítelos a todo el
salón de una vez.

Luego **cierra la sesión**, coge el enlace o el QR del certificado y ábrelo:
se verifica **sin iniciar sesión**.

La firma es **Ed25519**, asimétrica, no un HMAC: cualquiera puede comprobar un
certificado con la clave pública, sin pedirnos permiso y sin que podamos negar
después haberlo emitido. Para un título que el alumno enseña fuera, esa
diferencia es el producto.

---

## Lo que se ve desde dentro (para una audiencia técnica)

Números reproducibles hoy, en local, con la infraestructura levantada:

| Comprobación | Resultado |
|---|---|
| `pnpm build` | **15/15** paquetes, servicios y portal |
| `pnpm typecheck` | **21/21** |
| `pnpm test` | **264** pruebas en memoria |
| `pnpm smoke` | **96** comprobaciones de punta a punta |
| `pnpm concurrency` | **14** comprobaciones de concurrencia real |
| `pnpm smoke:web` | **243** comprobaciones del portal contra el backend |
| `pnpm a11y` | **15** pantallas |

Las de **concurrencia** son las que justifican la arquitectura: un solo canje de
veinte simultáneos, cinco plazas para veinte solicitudes, la outbox reteniendo el
evento con NATS parado y publicándolo al volver, y el mismo evento entregado dos
veces aplicándose una.

**Y `pnpm projections`**, que reconstruye cualquier proyección de analítica
re-emitiendo los hechos al servicio dueño. Existe porque el consumidor duradero
de NATS conserva su posición: un asunto nuevo empieza por el final del stream, y
sin este comando los datos anteriores no se recuperan nunca.

---

## Qué falta

Ordenado por lo que se nota antes.

### Bloqueos de negocio, no técnicos

- **Proveedor de vídeo.** Hoy los vídeos largos se sirven desde el
  almacenamiento propio. La decisión ya está tomada —proveedor externo privado
  con restricción de dominio—, falta contratarlo.
- **SMTP real.** El correo funciona de verdad (verificación y recuperación), pero
  en local sale a Mailpit. Falta un proveedor y su dominio verificado.

### Pantallas de autoría que el modelo ya soporta

- **Misiones semanales:** las escribe GLEXCO y vienen con el kit. El campo
  `origin` existe desde el primer día porque institución y docentes podrán
  ajustarlas, pero **la pantalla de autoría no está**.
- **Certificaciones a nivel de plataforma:** hoy se emiten por salón, desde el
  Teacher Center.
- **Configuración del Portal Admin:** no tiene nada detrás todavía.

### Del portal docente

- **Recursos pedagógicos y capacitación docente**: el apartado de formación para
  el profesor.

### De comunicación

- **Notificaciones, mesa de ayuda y base de conocimiento.** El muro del salón y
  el correo transaccional ya están.

### Fase 8 completa — endurecimiento y despliegue

Es la fase que queda entera, y es la que separa «funciona» de «se puede operar»:

- Pruebas de carga con k6 (inicio de clase y jornada completa).
- Revisión de seguridad y prueba de penetración interna.
- CI/CD con despliegue sin caída y reversión automática.
- Réplicas de lectura conectadas (el código ya separa `DB_READ_POOL` de
  `DB_WRITE_POOL`; falta la réplica).
- **Copias de seguridad probadas restaurándolas.** Una copia que nadie ha
  restaurado no es una copia.
- Runbooks operativos y alertas.
- Manifiestos para AWS / Huawei Cloud, para cuando se salga de Railway.

### Deuda conocida, anotada y sin resolver

- **2144 usuarios sembrados no pueden iniciar sesión**: su apellido contiene un
  dígito y la validación de nombre lo rechaza al rehidratar el agregado. Afecta
  sólo a datos de prueba masivos, no a las cuentas de demostración.
- **`StudentWeakSpots`** está construido y sin conectar: enseñaría identificadores
  de pregunta en vez de su enunciado.
- **i18n del panel del docente y del Admin**: el portal del alumno está completo
  en español e inglés; estos dos aún tienen literales.
