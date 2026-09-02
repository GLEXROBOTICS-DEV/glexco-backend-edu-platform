# Modelo de dominio

Resumen destilado de la propuesta comercial (PDF de 15 páginas) más las reglas de
negocio que el cliente aportó en conversación. **Esta es la fuente de verdad
funcional**: no hace falta volver a abrir el PDF.

---

## 1. Los cuatro portales

| Portal | Público | Carácter |
|---|---|---|
| **GLEXCO Discover** | Primaria, 6–12 años | Lúdico, gamificado, colorido pero legible |
| **GLEXCO Academy** | Secundaria, técnico, institutos, universidad | Sobrio, orientado a competencias y certificación |
| **GLEXCO Teacher Center** | Docentes, coordinadores, especialistas STEM | Herramienta de trabajo: planificar, seguir, evaluar |
| **GLEXCO Admin** | Personal interno GLEXCO y admins de institución | Gestión, métricas, contenido, comercial |

Tras autenticarse, el sistema **detecta el perfil y redirige** al portal que
corresponde. Un usuario con varios roles entra por el de mayor alcance.

---

## 2. Roles y quién puede crear a quién

```
platform_owner          ── puede todo, incluido crear otros administradores GLEXCO
   └── platform_admin   ── contenido, cursos, instituciones, usuarios, métricas globales
        ├── content_manager    ── solo contenido y evaluaciones
        ├── support_agent      ── tickets, reseteo de acceso, diagnóstico
        ├── commercial_agent   ── instituciones, licencias, renovaciones
        └── institution_admin  ── SU institución: crea docentes, ve métricas
             └── teacher       ── SUS salones: crea salones, evalúa, publica anuncios
                  └── student  ── solo lo suyo y solo el contenido de su kit
```

La matriz de creación está codificada en `ROLE_CREATION_MATRIX`
(`packages/contracts/src/authorization/roles.ts`). Es lo que impide la escalada
de privilegios: sin ella, un `institution_admin` con permiso `user:create` podría
fabricarse un `platform_admin`.

### Ámbitos

El permiso dice *qué clase de operación*; el ámbito dice *sobre qué*.
`classroom:read` significa cosas distintas para un docente (sus salones) y para
un administrador de institución (todos los de su colegio). Por eso:

- El **guard** comprueba el permiso.
- El **caso de uso** comprueba el ámbito sobre el recurso concreto.

Ambas cosas son obligatorias. Confundirlas es el origen típico de las fugas entre
instituciones.

---

## 3. El flujo del código de libro (regla central del negocio)

```
GLEXCO genera un lote de códigos para el kit "uKit AI – 3.º de primaria"
        │
        ▼
Los códigos se imprimen en los libros
        │
        ▼
El colegio (o la familia) compra el libro → un libro por grado = un kit
        │
        ▼
El alumno se registra en la web e introduce:
   · código del libro
   · institución educativa   ┐
   · docente                 ├─ opcionales si es cuenta independiente
   · salón de clases         ┘
        │
        ▼
El código se CANJEA y CADUCA (un solo uso, irreversible)
        │
        ▼
El alumno obtiene un "entitlement" y ve ÚNICAMENTE el contenido de ese kit
        │
        ▼
El docente ve cuántos alumnos han activado en su salón
```

### Reglas duras

1. **Un solo uso.** El canje va dentro de una transacción con `SELECT ... FOR
   UPDATE` sobre la fila del código. Sin ese bloqueo, dos peticiones simultáneas
   con el mismo código otorgan dos accesos.
2. **El registro institucional viene marcado por defecto** en el formulario, pero
   el independiente debe funcionar igual de bien: hay familias que compran el
   libro por su cuenta.
3. **El alumno solo ve el contenido de su kit.** No es una cuestión de interfaz:
   se comprueba en el servidor, en cada petición de contenido y en cada URL
   prefirmada que se emite.
4. **Formato del código:** `GLX-XXXX-XXXX-XXXX`, alfabeto de 31 símbolos sin
   `0/O/1/I/L` (un niño copiando de papel no debe perder su acceso por un
   carácter ambiguo). Espacio de 31¹² ≈ 7,9·10¹⁷.
5. **Rate limiting agresivo en el canje**: 5 intentos por IP y hora. Es el vector
   de fuerza bruta económicamente interesante, porque un código válido vale
   dinero.

### Estados del código

`issued` → `distributed` → `redeemed` · `revoked` · `expired`

---

## 4. Salones

- Los crean el **docente** o el **administrador de institución**.
- Tienen un **tope de plazas configurable** (por defecto 30, máximo 60; la
  propuesta menciona ejemplos de 20).
- El cupo se comprueba **dentro de la transacción de matrícula**, no antes: si se
  comprueba fuera, dos alumnos entran a la vez en la última plaza.
- El docente puede: enviar anuncios, compartir enlaces y adjuntar documentos
  ligeros (PDF, documentos), ver el avance de su salón.
- La matrícula conserva historial: `active` → `transferred` / `withdrawn` /
  `completed`. Nunca se borra: un alumno que cambia de colegio no debe perder su
  progreso ni sus certificados.

---

## 5. Contenido y estructura académica

```
Kit (= libro = grado)
 └── Curso                 p. ej. "uKit AI – Zoológico Fantástico"
      └── Módulo
           └── Lección
                └── Recurso  video · documento · presentación · ficha · guía ·
                             manual · tutorial · webinar · código de ejemplo ·
                             instrucción de armado · enlace externo
```

Además, **rutas formativas** (`LearningPath`) que encadenan cursos:
Escuela Vocacional → Escuela Técnica → Educación Superior → Especialización →
Certificación Profesional.

### Catálogo de robots

**Discover:** uKit AI, uKit Explore, uGoT.
**Academy:** Yanshee, AI BOX PRO, CreaBot, Dobot Magician E6, Cadebot, Cruzr,
GO2, GLEX-1, Xpertus.

Se modelan como datos semilla con clave estable (`ROBOT_PLATFORMS`), no como
tabla libre: el contenido, los cursos y los kits cuelgan de esas claves.

### Estados de publicación

`draft` → `in_review` → `published` → `archived`

Solo `published` es visible para alumnos y docentes. Publicar invalida la caché
por etiqueta (`course:<id>`, `kit:<id>`, `content:<id>`).

---

## 6. Evaluación

- **Tipos:** cuestionario, prueba práctica, proyecto, actividad STEM.
- **Preguntas:** opción única, opción múltiple, verdadero/falso, respuesta corta,
  ordenar, emparejar, subida de archivo (foto o video de la construcción).
- **Rúbricas** prediseñadas para: construcción robótica, programación,
  resolución de problemas, trabajo colaborativo.
- **Entrega:** `draft` → `submitted` → `auto_graded` / `pending_review` →
  `graded` → `returned`.
- Las de opción se corrigen solas; las de archivo y proyecto las califica el
  docente con rúbrica.

---

## 7. Gamificación (sobre todo en Discover)

- **XP y niveles del Explorador:**
  1 Explorador (0) · 2 Inventor (500) · 3 Constructor (1500) ·
  4 Innovador (3500) · 5 Maestro Robótico (7000).
- **Insignias** por categoría: participación, desempeño, creatividad, habilidad,
  hito. Ejemplos de la propuesta: Constructor Experto, Programador Inicial,
  Maestro STEM.
- **Medallas**, **ranking de participación**, **misiones semanales**, **retos de
  construcción y programación**, **eventos especiales** (concursos, ferias STEM,
  olimpiadas).

Diseño con cuidado: el ranking se muestra de forma amigable y **no expone a los
alumnos con peor desempeño**. La comparación pública entre menores tiene coste
emocional real; el ranking celebra logros, no señala rezagos.

---

## 8. Certificaciones

- Plantillas configurables con logo, firma digital y **código QR verificable**.
- Emisión **individual y masiva**.
- Verificación pública por QR sin necesidad de iniciar sesión (pero sin exponer
  datos personales del alumno más allá del nombre y el curso).
- Historial de emisión y descargas.

---

## 9. Módulos transversales

Presentes en los cuatro portales: **Centro de Ayuda** (FAQ, soporte, tutoriales),
**Biblioteca General** (manuales, guías, documentación), **Notificaciones**
(avisos, recordatorios, cursos nuevos) y **Perfil Personal** (datos, historial,
certificados, preferencias, idioma).

---

## 10. Consideraciones de protección de datos

La plataforma maneja datos de **menores de edad**. No es un detalle legal
secundario: condiciona el diseño.

- Correo de apoderado **obligatorio para menores de 14**.
- Consentimiento explícito de términos y privacidad con sello de tiempo servidor.
- Minimización: no se pide más dato del necesario.
- Redacción automática de campos sensibles en logs
  (`packages/observability/src/logger.ts`).
- Contenido y evidencias en buckets privados con URL prefirmada de vida corta.
- El ranking y los perfiles públicos nunca exponen datos de contacto.
