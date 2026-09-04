import { describe, expect, it } from 'vitest';
import { EVENTS } from '@glexco/contracts';
import { PublishContentUseCase } from '../src/application/publish-content.usecase';

/**
 * Publicacion de contenido: lo que se ANUNCIA al publicar.
 *
 * Estas pruebas no comprueban que la fila cambie de estado -eso lo cubre el
 * repositorio-, sino que **el hecho se emite**. Es el fallo que ya ocurrio dos
 * veces con dos eventos distintos: `course.published` y `kit.published` estaban
 * en el catalogo desde el principio, no los emitia nadie, y la funcion que
 * dependia de ellos estaba muerta SIN dar ningun error. Una proyeccion vacia no
 * falla: pinta identificadores, o no pinta nada.
 *
 * De ahi que se afirme sobre los eventos encolados en la unidad de trabajo y no
 * sobre el resultado del caso de uso: el resultado salia bien las dos veces.
 */

const KIT = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'UKX-3',
  name: 'uKit Explore',
  description: '',
  program: 'discover' as const,
  grade: 'primary_3',
  robotPlatforms: [],
  coverImageKey: null,
  status: 'in_review' as const,
  courseIds: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** Recoge lo encolado en vez de publicarlo: es lo que se quiere afirmar. */
function fakeUnitOfWork() {
  const enqueued: { metadata: { eventName: string }; payload: Record<string, unknown> }[] = [];

  return {
    enqueued,
    async run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      return work({
        enqueue(...events: { metadata: { eventName: string }; payload: Record<string, unknown> }[]) {
          enqueued.push(...events);
        },
      });
    },
  };
}

function build(kit = KIT) {
  const stored = { ...kit };
  const unitOfWork = fakeUnitOfWork();

  const kits = {
    async findById(id: string) {
      return id === stored.id ? { ...stored } : null;
    },
    async findByCode() {
      return null;
    },
    async list() {
      return { items: [], nextCursor: null };
    },
    async save(next: typeof KIT) {
      Object.assign(stored, next);
    },
  };

  const content = {
    async findCourse() {
      return null;
    },
    async findAsset() {
      return null;
    },
    async listLessonsByCourse() {
      return [];
    },
    async saveCourse() {},
    async saveAsset() {},
  };

  const invalidated: string[] = [];
  const cache = {
    async invalidateTag(tag: string) {
      invalidated.push(tag);
    },
  };

  const useCase = new PublishContentUseCase(
    content as never,
    kits as never,
    unitOfWork as never,
    cache as never,
    { now: () => new Date('2026-09-04T10:00:00Z') } as never,
    { info() {}, warn() {}, error() {}, debug() {} } as never,
  );

  return { useCase, unitOfWork, invalidated, stored };
}

const CONTEXT = { correlationId: 'corr-1', locale: 'es', requestedAt: new Date() } as never;

describe('Publicar un kit', () => {
  it('emite catalog.kit.published.v1 con el NOMBRE dentro', async () => {
    const { useCase, unitOfWork } = build();

    await useCase.execute({ target: 'kit', id: KIT.id, status: 'published' }, CONTEXT);

    const event = unitOfWork.enqueued.find((e) => e.metadata.eventName === EVENTS.KIT_PUBLISHED);

    expect(event).toBeDefined();
    // El nombre es TODO lo que se le pedia a este evento: sin el, la analitica
    // lista la cartera de kits por UUID en la pantalla que decide que material
    // hay que rehacer.
    expect(event?.payload.name).toBe('uKit Explore');
    expect(event?.payload.kitId).toBe(KIT.id);
    expect(event?.payload.grade).toBe('primary_3');
  });

  it('cambia el estado del kit, no solo anuncia', async () => {
    const { useCase, stored } = build();

    await useCase.execute({ target: 'kit', id: KIT.id, status: 'published' }, CONTEXT);

    expect(stored.status).toBe('published');
  });

  it('NO anuncia nada al archivar', async () => {
    const { useCase, unitOfWork } = build({ ...KIT, status: 'published' });

    await useCase.execute({ target: 'kit', id: KIT.id, status: 'archived' }, CONTEXT);

    // Retirar un kit no es "kit publicado". El dia que haga falta anunciarlo
    // sera con su propio evento, porque quien lo consuma tiene que borrar del
    // directorio y no reescribirlo.
    expect(unitOfWork.enqueued).toHaveLength(0);
  });

  it('invalida la cache del kit publicado', async () => {
    const { useCase, invalidated } = build();

    await useCase.execute({ target: 'kit', id: KIT.id, status: 'published' }, CONTEXT);

    // Sin esto, publicar un kit tardaria en verse lo que durase el TTL.
    expect(invalidated.some((tag) => tag.includes(KIT.id))).toBe(true);
  });

  it('es idempotente: publicar lo ya publicado no vuelve a anunciarlo', async () => {
    const { useCase, unitOfWork } = build({ ...KIT, status: 'published' });

    await useCase.execute({ target: 'kit', id: KIT.id, status: 'published' }, CONTEXT);

    // Un doble clic en el panel no debe emitir el hecho dos veces. El manejador
    // del directorio es idempotente, asi que no romperia nada; pero un evento
    // por clic convierte la outbox en un registro de la interfaz.
    expect(unitOfWork.enqueued).toHaveLength(0);
  });

  it('rechaza publicar un kit que sigue en borrador', async () => {
    const { useCase } = build({ ...KIT, status: 'draft' });

    // Este contenido lo ven ninos de seis anos, y la revision es el unico punto
    // donde alguien distinto del autor lo mira antes de que llegue a un aula.
    await expect(
      useCase.execute({ target: 'kit', id: KIT.id, status: 'published' }, CONTEXT),
    ).rejects.toThrow(/no puede pasar/i);
  });

  it('un kit que no existe no se publica', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute(
        { target: 'kit', id: '99999999-9999-4999-8999-999999999999', status: 'published' },
        CONTEXT,
      ),
    ).rejects.toThrow(/no existe/i);
  });
});
