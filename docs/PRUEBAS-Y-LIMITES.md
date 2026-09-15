# Probar la plataforma sin pelearse con sus defensas

**Para quién es:** para quien ejecute `pnpm smoke`, `pnpm smoke:web`,
`pnpm concurrency` o pruebe a mano, y se encuentre con `429`,
`TOO_MANY_ACTIVATION_ATTEMPTS` o una cuenta bloqueada.

**Lo que hay que entender antes de nada:** esta plataforma se defiende de la
fuerza bruta, y una batería de pruebas hace exactamente lo mismo que un ataque
—muchas altas, muchos canjes de código y muchos inicios de sesión desde una sola
IP en pocos segundos—. Cuando una prueba falla con `429`, **lo normal es que el
código esté bien y la defensa haya hecho su trabajo.**

De ahí la regla que ordena todo este documento:

> **Los límites no se relajan para que pase una prueba.** Se limpian los
> contadores antes de medir. Bajar un límite para ver verde es cambiar el
> producto para que la prueba mienta.

---

## 1. Los límites que existen de verdad

Salen de `RATE_LIMITS` en
[`packages/nest-platform/src/redis/rate-limiter.ts`](../packages/nest-platform/src/redis/rate-limiter.ts).
Esta tabla es una copia para leer; **la fuente es el código**.

| Límite | Cuánto | Ventana | Con qué choca al probar |
|---|---|---|---|
| `ACTIVATION_REDEEM_BY_IP` | 5 | 1 hora | Activar códigos de libro. **El primero que se agota.** |
| `ACTIVATION_REDEEM_BY_ACCOUNT` | 10 | 24 horas | Un mismo alumno probando códigos |
| `REGISTRATION_BY_IP` | 10 | 1 hora | Altas de alumno. El segundo que se agota |
| `PASSWORD_RESET` | 3 | 1 hora | Recuperación de contraseña |
| `LOGIN_BY_IP` | 20 | 1 minuto | Tandas de inicios de sesión seguidos |
| `LOGIN_BY_ACCOUNT` | 5 | 15 minutos | Rociado de contraseñas contra una cuenta |
| `WRITE` / `READ` | 60 / 300 | 1 minuto | Escritura y lectura autenticadas en general |
| `UPLOAD_PRESIGN` | 30 | 1 minuto | Subidas de evidencias |
| `REPORT_EXPORT` | 5 | 5 minutos | Exportar dashboards |

**Por qué el de activación es el más duro:** un código válido vale dinero. Es el
único vector de fuerza bruta económicamente interesante que tiene la plataforma,
y por eso son cinco por hora y el error no distingue «no existe» de «ya
canjeado»: decirlo confirmaría aciertos parciales al que recorre el espacio.

### El bloqueo de cuenta es otra cosa, y no vive en Redis

Está en el agregado `User`
([`user.aggregate.ts`](../services/identity/src/domain/user/user.aggregate.ts)):
a partir del **sexto** fallo seguido de contraseña la cuenta se bloquea, y el
bloqueo **crece**: 1 minuto, 5, 15 y 1 hora de ahí en adelante.

Importa porque **limpiar Redis no lo deshace**: el contador vive en la fila del
usuario en PostgreSQL. Un inicio de sesión correcto lo pone a cero, así que la
salida es acertar la contraseña, no borrar claves.

---

## 2. El procedimiento correcto

**Limpiar antes de medir, no después de fallar.** El orden importa: si se lanza
la prueba y luego se limpia, la tanda ya se perdió y hay que repetirla entera.

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL"
```

Y acto seguido, en el **mismo** comando, la prueba:

```bash
docker exec glexco-redis sh -c "redis-cli -a glexco_local_dev --no-auth-warning \
  --scan --pattern 'glexco:rl:*' | xargs -r redis-cli -a glexco_local_dev \
  --no-auth-warning DEL" >/dev/null 2>&1 && pnpm smoke:web
```

Encadenarlos no es cosmético: `pnpm smoke:web` son 243 comprobaciones que
registran alumnos y canjean códigos, así que **una sola pasada agota los límites
para la siguiente**. Dos ejecuciones seguidas sin limpiar en medio dan resultados
distintos, y el segundo no significa nada.

El patrón `glexco:rl:*` solo toca contadores de límite. No hay sesiones ni cachés
bajo ese prefijo, así que borrarlo no cierra la sesión de nadie.

---

## 3. Lo que limpiar Redis **no** arregla

Aquí es donde se pierde más tiempo, porque los síntomas se parecen y la causa no
tiene nada que ver.

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `422` al entregar una evaluación | Los **3 intentos** del cuestionario están gastados (`maxAttempts`, 3 en los de tipo `quiz` y 1 en el resto) | Sembrar de nuevo, o usar otro alumno |
| Un código de activación ya no sirve | Se canjeó. **Es de un solo uso por diseño** | Usar otro de la lista de [ENTORNO-DEMO.md](ENTORNO-DEMO.md) |
| «Ese correo ya está registrado» | El alta anterior sí funcionó | Otro correo, o volver a sembrar |
| La cuenta sigue bloqueada | El contador está en PostgreSQL, no en Redis | Acertar la contraseña, o esperar a que venza |

Cuando el entorno acumula poso de muchas siembras, la salida es volver a sembrar
de cero con `DEMO_RESET=1` (ver [ENTORNO-DEMO.md](ENTORNO-DEMO.md) §5) y
**quitar la variable después**, o cada despliegue borrará la demostración.

---

## 4. El otro falso fallo: los reinicios del servidor de desarrollo

`dev` corre `node --watch dist/main.js`. Cualquier cosa que reescriba `dist`
—un `pnpm build`, o un paquete compartido recompilando— **reinicia los nueve
servicios a la vez**, y durante unos segundos las peticiones mueren con
`ECONNREFUSED`, `ECONNRESET` o, desde el portal, `fetch failed` y un 500 en la
pantalla.

No es un fallo del código. Antes de medir, **espera a que los nueve respondan**:

```bash
for p in 3000 3101 3102 3103 3104 3105 3106 3107 3108; do
  printf "%s:%s " "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
    http://localhost:$p/health/live)"
done; echo
```

Los nueve tienen que decir `200`. El portal (3010) **no** tiene `/health/live`:
devuelve 404 y eso es lo correcto, se comprueba pidiendo `/ingresar`. Su primera
carga compila bajo demanda y tarda unos segundos: eso tampoco es un fallo.

---

## 5. Cómo leer los números de referencia

Los números que aparecen en la documentación —build 15/15, typecheck 21/21, 284
pruebas, smoke 96, concurrencia 18, smoke:web 243— **son de la ejecución que los
escribió**, no un contrato que se cumpla solo. Dos avisos:

- **`pnpm build` con caché de Turborepo no prueba nada.** Un `15/15` con
  `>>> FULL TURBO` significa que no compiló: replicó registros. Para verificar
  de verdad, `pnpm build --force`.
- **`pnpm smoke:web` no es determinista sobre una base con poso.** En una misma
  sesión, sin tocar código, se han visto 234, 240 y 242 sobre 243 según cuántos
  intentos de evaluación y cuántos códigos quedaran libres. **Un resultado sobre
  una base sucia no sirve para comparar**; si el número importa, siembra de cero
  antes.

Lo que sí es estable y se puede exigir sin preparativos: `pnpm test` (284, en
memoria y sin Docker), `pnpm typecheck` (21/21) y `pnpm build --force` (15/15).

**`pnpm concurrency` también necesita los contadores limpios.** Sus cinco
comprobaciones registran alumnos por la API, así que lanzarla dos veces seguidas
—o después de un `smoke`— hace fallar la 3.3 con cuatro errores que parecen de la
outbox y son del límite de altas. Limpia y vuelve a lanzarla antes de buscar
nada en el código.

---

## 6. Antes de mirar el código, mira las proyecciones

Una comprobación que dice que algo «no aparece por su nombre» —kits, colegios,
autores del muro— casi nunca es un fallo de la pantalla: es una **proyección
vacía**, y una proyección vacía no da error. La pantalla se pinta, responde 200
y dice `None`.

```bash
pnpm projections:check   # ¿cuadra cada proyección con su origen?
pnpm projections         # reconstruir las que no
```

Sobre una base recién migrada y sembrada **hay que ejecutarlo**: los consumidores
duraderos de NATS empiezan por el final del stream, así que los hechos anteriores
a su creación no llegan solos. Es lo que hace que la primera pasada de
`pnpm smoke` falle en «los ve por su NOMBRE, no por su identificador».

---

## 7. En producción no se toca nada de esto

- **No existe un `DEMO_RESET` que sea seguro** en un entorno con alumnos reales.
- **El límite de altas por IP tiene una consecuencia conocida**: una clase de
  treinta alumnos detrás del NAT de su colegio lo agota en el minuto tres. La
  salida **no** es subir el límite global —eso abre la puerta al alta masiva
  automatizada desde cualquier conexión—, sino distinguir el alta que llega
  contra un salón de una institución con licencia vigente del alta suelta.
- **`ACTIVATION_CODE_PEPPER` no se rota nunca.** Cambiarla invalida todos los
  códigos ya impresos.
