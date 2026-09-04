# Entorno de demostración

Direcciones y cuentas del despliegue en Railway. **Todo el contenido de aquí es
reemplazable, editable y borrable desde el portal**: no hay ninguna fila marcada
como intocable ni que el producto trate distinto por venir del sembrador.

---

## 1. Direcciones

| | |
|---|---|
| **Portal** (alumnos y docentes) | https://glexcoweb-production.up.railway.app |
| **API** (gateway) | https://glexcoapi-gateway-production.up.railway.app |

Son las **dos únicas direcciones públicas**, y es deliberado: los ocho
microservicios viven en la red privada de Railway, porque la tabla de rutas del
gateway es el único sitio donde se decide qué queda expuesto a internet.

---

## 2. Cuentas

**La contraseña de todas es `GlexcoDemo2026`.**

| Quién | Correo | Qué ve |
|---|---|---|
| **GLEXCO (plataforma)** | `glexco@demo.glexco.pe` | Panel de plataforma: todos los colegios y los kits con peor resultado |
| **Dirección del colegio** | `director@demo.glexco.pe` | Su institución, la eficacia docente y la activación de códigos |
| Docente de 4.º A | `docente1@demo.glexco.pe` | Su salón, su bandeja de corrección y sus evaluaciones |
| Docente de 6.º B | `docente2@demo.glexco.pe` | Ídem |
| Docente de 2.º de secundaria | `docente3@demo.glexco.pe` | Ídem |
| Alumnos | `alumno1@…` … `alumno12@demo.glexco.pe` | Su kit, su progreso y sus evaluaciones |

**Qué alumno mirar según lo que quieras ver:**

**Portal Discover (primaria):** `alumno1`, `alumno2`, `alumno4`, `alumno5`,
`alumno7`, `alumno8`, `alumno10`.
**Portal Academy (secundaria):** `alumno3`, `alumno6`, `alumno9`, `alumno12`.

- `alumno1@demo.glexco.pe` — **el mejor caso** de Discover: curso completo,
  nota 100, insignias y XP.
- `alumno3@demo.glexco.pe` — portal **Academy**, con su ruta tecnológica.
- `alumno8` y `alumno11` — **sin kit activado**, para ver el estado vacío y el
  formulario de activación.

El reparto de notas es desigual **a propósito**: sin dispersión, el panel del
docente enseña una media y nada más, y la dispersión es justo lo que distingue un
salón que va bien de uno partido en dos.

---

## 3. El colegio

**Colegio San Martín de Porres** (Lima) · código de institución **`DEMO-SMP`**

| Salón | Grado | Docente | Kit |
|---|---|---|---|
| 4.º A | 4.º de primaria | Luis Ramírez | uKit Explore |
| 6.º B | 6.º de primaria | Ana Quispe | uGot |
| 2.º de secundaria A | 2.º de secundaria | Jorge Mendoza | Yanshee |

Cada kit trae un curso con sus lecciones, y cada lección un **tutorial en vídeo**
y una **ficha descargable**.

### Probar el alta de un alumno nuevo

En `/registro` del portal, con el código de colegio **`DEMO-SMP`** y uno de estos
códigos de activación (uno por kit; cada uno sirve **una sola vez**):

| Kit | Grado a elegir | Códigos libres |
|---|---|---|
| uKit Explore | 4.º de primaria | `GLX89Y5J7CP82EV` · `GLX9WB98Q8CA7XR` · `GLXTRBM62D8NDJS` |
| uGot | 6.º de primaria | `GLXWS55QXCAKAYV` · `GLXTPXCLN48VVCX` · `GLXTFAMTU4JPKL7` |
| Yanshee | 2.º de secundaria | `GLXDXDTY95WMA7Z` · `GLXS4JC9K7VSLDW` · `GLXRN2A4H28T847` |

Hay **30 códigos por kit**; estos son solo los primeros libres. Los generan
`idFor`/hash de forma determinista, así que volver a sembrar no los invalida.

> **En producción de verdad los códigos NO son deterministas.** Los genera
> `catalog` con entropía real. Estos existen para que se pueda probar el
> formulario sin que la documentación quede obsoleta en cada siembra.

---

## 4. Qué mirar en cada pantalla

| Pantalla | Cómo llegar | Qué demuestra |
|---|---|---|
| Registro | `/registro` sin sesión | Alta en dos pasos, sin JavaScript, con salones reales |
| Portada del alumno | Entrar como `alumno1` | Su kit y los anuncios de su docente |
| Biblioteca | `/discover/biblioteca` | Vídeo, ficha descargable con URL firmada, enlace externo |
| Mi progreso | `/discover/progreso` | Nivel de Explorador, XP, insignias y notas |
| Panel del docente | Entrar como `docente1` | Media **y dispersión**, preguntas más falladas |
| Bandeja de corrección | `/docentes/salones/…/correccion` | Entregas con nombre real del alumno |
| Anuncios | `/docentes/anuncios` | Publicar; el alumno lo ve en su portada |
| Panel de institución | Entrar como `director` | Eficacia docente por **progreso**, no por nota |
| Panel de GLEXCO | Entrar como `glexco` → `/admin` | Todos los colegios y los kits más flojos |

---

## 5. Volver a sembrar

El sembrador vive en `infra/scripts/seed-demo.mjs` y es **idempotente**: los
identificadores son deterministas y adopta los que ya existan, así que volver a
ejecutarlo no duplica nada. Repone el progreso de los alumnos de demostración
para dejar un estado conocido, y **actualiza la contraseña**, de modo que lo que
imprime siempre funciona.

Con `DEMO_RESET=1` **borra el colegio entero y lo vuelve a sembrar desde cero**.
Hace falta cuando el entorno acumula poso de muchas siembras: los tres intentos
por evaluación se agotan, los códigos quedan canjeados y las entregas empiezan a
fallar con 422. Acuérdate de **quitar la variable después**, o cada despliegue
borrará la demostración.

**Trampas de ejecutarlo en Railway**, las dos comprobadas perdiendo despliegues:

- El comando previo al despliegue **no pasa por un intérprete**: encadenar con
  `&&` ejecuta el primero y descarta el resto en silencio, con el despliegue
  marcado como correcto.
- El código de institución se guarda **normalizado**: `DEMO-SMP` se almacena
  como `DEMOSMP`. Cualquier consulta SQL directa tiene que usar esa forma.

Corre **dentro de Railway**, porque PostgreSQL no está expuesto a internet y no
hace falta exponerlo para esto:

```bash
# Variables temporales en identity
railway variables --service "@glexco/identity" --skip-deploys \
  --set "ADMIN_DATABASE_URL=<DATABASE_URL de Postgres>" \
  --set "ACTIVATION_CODE_PEPPER=<la de catalog>" \
  --set "DEMO_PASSWORD=GlexcoDemo2026" \
  --set "GATEWAY_URL=http://glexcoapi-gateway.railway.internal:3000"

# El comando previo pasa a ser la siembra, se despliega, y se devuelve a migrar
# (ver infra/railway en el traspaso). Al terminar, BORRAR las cuatro variables:
# la credencial de administrador de PostgreSQL no debe vivir en un servicio de
# aplicación, y la pimienta permite reconstruir el hash de cualquier código.
```

**Las dos advertencias que importan al resembrar:**

- Publicar un curso es **idempotente**, así que uno ya publicado no vuelve a
  emitir su evento. El sembrador lo fuerza pasando por revisión. Es el problema
  clásico de una proyección nueva frente a datos viejos, y la solución
  definitiva es un comando de reconstrucción que todavía no existe.
- Las **matrículas, canjes y evaluaciones** pasan por la API real para que los
  eventos se publiquen y las proyecciones se alimenten solas. Sembrar esas tablas
  a mano produciría dashboards que se ven bien y no se corresponden con nada.

---

## 6. Lo que este entorno todavía NO es

- **MinIO y Mailpit son provisionales.** MinIO sobre un volumen es un único punto
  de fallo con todo el material de los kits dentro; **Mailpit acepta correos y no
  entrega ninguno**, así que la verificación de cuenta y la recuperación de
  contraseña no llegan a ningún buzón real. Para tráfico de verdad: Cloudflare R2
  y un SMTP con SPF, DKIM y DMARC.
- **`ALLOW_BUCKET_VIDEO=true`** está puesto en `catalog` y `media`. Es la válvula
  que permite arrancar sin proveedor de vídeo. Con alumnos reales significa
  servir cientos de megas por vídeo desde nuestro ancho de banda — exactamente lo
  que el corte existe para impedir.
- Los tutoriales en vídeo son **enlaces externos de relleno**. Un archivo que
  dice ser vídeo y no lo es deja el reproductor en negro, y eso se lee como que
  la plataforma está rota.
- **No hay copias de seguridad probadas.** Una copia que nadie ha restaurado
  nunca no es una copia, es una intención.
