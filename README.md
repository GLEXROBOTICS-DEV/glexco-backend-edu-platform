# Plataforma GLEXCO

Plataforma educativa para robótica STEM. Aula virtual integral para el
acompañamiento de docentes y alumnos en el uso de kits de robótica educativa
GLEXCO–UBTECH (uKit, uGoT, Yanshee, Dobot, Cruzr, GO2, entre otros).

Cuatro portales sobre un mismo backend de microservicios:

- **GLEXCO Discover** — Primaria (6–12 años)
- **GLEXCO Academy** — Secundaria, técnico, institutos y universidad
- **GLEXCO Teacher Center** — Docentes
- **GLEXCO Admin** — Administración GLEXCO e instituciones

---

## Puesta en marcha

**Requisitos:** Node ≥ 22, pnpm 11, Docker Desktop.

```bash
pnpm install
cp .env.example .env        # ajustar secretos
pnpm infra:up               # Postgres, Redis, NATS, MinIO, Mailpit, Jaeger
pnpm build
pnpm dev
```

### Servicios locales

| Servicio | URL |
|---|---|
| Frontend | http://localhost:3010 |
| API Gateway | http://localhost:3000 |
| MinIO (consola) | http://localhost:9001 |
| Mailpit (correo) | http://localhost:8025 |
| Jaeger (trazas) | http://localhost:16686 |
| NATS (monitor) | http://localhost:8222 |

---

## Documentación

| Documento | Contenido |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Guía de trabajo en el repositorio. Empezar aquí. |
| [docs/BITACORA.md](docs/BITACORA.md) | Qué se hizo en cada sesión, por qué y qué falta. |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Fases del proyecto. |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Decisiones de arquitectura y su justificación. |
| [docs/ESCALABILIDAD.md](docs/ESCALABILIDAD.md) | Modelo de capacidad y estrategia de escalado. |
| [docs/DOMINIO.md](docs/DOMINIO.md) | Reglas de negocio: roles, kits, códigos, salones. |

---

## Estructura

```
packages/     Código compartido: kernel DDD, contratos, configuración,
              observabilidad, plataforma NestJS.
services/     Microservicios: gateway, identity, institutions, catalog,
              learning, assessment, engagement, analytics, media.
apps/web/     Frontend Next.js.
infra/        Docker Compose, inicialización de base de datos, despliegue.
docs/         Documentación del proyecto.
```

---

## Stack

**Backend:** NestJS 11 · TypeScript · PostgreSQL 16 · Redis 7 · NATS JetStream ·
S3/MinIO · OpenTelemetry
**Frontend:** Next.js 15 · React 19 · Tailwind CSS v4 · next-intl
**Arquitectura:** Microservicios con hexagonal/DDD, outbox transaccional,
CQRS ligero con réplicas de lectura, caché distribuida con invalidación por
etiquetas.
