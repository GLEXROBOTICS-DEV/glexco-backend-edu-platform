import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * Tipos de objetivo de una mision semanal.
 *
 * Se copia del dominio en vez de importarlo: este paquete no depende de ningun
 * servicio -es al reves- y duplicar tres cadenas cuesta menos que invertir esa
 * dependencia. Si se anade uno nuevo alla, el `CHECK` de la base y esta lista
 * tienen que crecer con el, y por eso estan las dos junto a su enum.
 */
export const MISSION_OBJECTIVE_KINDS = [
  'lessons_completed',
  'assessment_passed',
  'xp_earned',
] as const;

/**
 * Crear una mision semanal.
 *
 * **El origen no se pide.** Lo decide el backend segun quien llama, igual que
 * en las evaluaciones: aceptarlo aqui permitiria a un administrador de colegio
 * publicar una mision como contenido de GLEXCO y colarla en todos los colegios
 * que tienen ese kit.
 */
export const createMissionSchema = z.object({
  kitId: uuidSchema,

  /** Semana dentro del kit, empezando en 1. */
  weekNumber: z.coerce.number().int().min(1).max(52),

  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),

  /**
   * Al menos uno: una mision sin objetivos no se puede completar nunca, y eso
   * no se descubre hasta que el salon se queda sin su XP.
   */
  objectives: z
    .array(
      z.object({
        kind: z.enum(MISSION_OBJECTIVE_KINDS),
        target: z.coerce.number().int().min(1).max(1000),
        courseId: uuidSchema.nullable().optional(),
        assessmentId: uuidSchema.nullable().optional(),
      }),
    )
    .min(1)
    .max(10),

  xpReward: z.coerce.number().int().min(1).max(10_000),
});

export type CreateMissionRequest = z.infer<typeof createMissionSchema>;
