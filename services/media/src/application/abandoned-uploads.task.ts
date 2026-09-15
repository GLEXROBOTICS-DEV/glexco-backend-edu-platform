import type {
  Clock,
  DistributedLock,
  LoggerPort,
  ObjectStorage,
  UnitOfWork,
} from '@glexco/kernel';
import type { MediaAssetRepository } from './ports';

/**
 * Tarea periodica que limpia las subidas que se quedaron a medias.
 *
 * `listAbandoned` estaba implementado desde la Fase 3 **y no lo llamaba nadie**,
 * asi que las filas en `pending` se acumulaban para siempre. Son inevitables y
 * numerosas: el usuario pide la URL prefirmada, cambia de idea o pierde la
 * conexion del laboratorio, y nadie confirma nunca esa subida.
 *
 * Lo que de verdad cuesta dinero no es la fila, es el OBJETO: una URL
 * prefirmada se puede usar sin que nadie confirme despues, asi que el archivo
 * llega al bucket y se paga indefinidamente sin que aparezca en ninguna
 * pantalla. Por eso se borra primero del almacen y despues la fila.
 *
 * **Solo una replica la ejecuta**, con cerrojo distribuido en Redis. Sin el, con
 * N replicas detras del balanceador las N recorrerian la misma lista y las N
 * intentarian borrar los mismos objetos.
 */
export class AbandonedUploadsTask {
  private timer: NodeJS.Timeout | null = null;

  /** Cada seis horas. Nada de esto es urgente: lo que se limpia lleva al menos
   *  un dia muerto y adelantar la limpieza no ahorra nada apreciable. */
  private static readonly INTERVAL_MS = 21_600_000;

  /** Vida del cerrojo: mas que lo que la tarea puede tardar con un lote entero,
   *  menos que el intervalo, para que nunca se solape consigo misma. */
  private static readonly LOCK_TTL_MS = 600_000;
  private static readonly LOCK_KEY = 'task:abandoned-uploads';

  /**
   * Cuanto espera antes de dar una subida por muerta.
   *
   * Veinticuatro horas y no una: la URL prefirmada dura minutos, pero el aula
   * que empieza a subir el viernes por la tarde y termina el lunes existe, y
   * borrarle la fila deja su evidencia sin sitio donde confirmarse. El coste de
   * esperar un dia es una fila; el de no esperarlo, el trabajo de un alumno.
   */
  private static readonly ABANDONED_AFTER_MS = 86_400_000;

  /** Cuantas por pasada. Un lote acotado deja la tarea predecible y el cerrojo
   *  corto; lo que sobre se limpia en la pasada siguiente. */
  private static readonly BATCH = 200;

  constructor(
    private readonly assets: MediaAssetRepository,
    private readonly storage: ObjectStorage,
    private readonly unitOfWork: UnitOfWork,
    private readonly lock: DistributedLock,
    private readonly clock: Clock,
    private readonly logger: LoggerPort,
  ) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.runOnce();
    }, AbandonedUploadsTask.INTERVAL_MS);

    // `unref` para que un temporizador pendiente no impida que el proceso
    // termine durante un apagado ordenado.
    this.timer.unref();

    // Una pasada al arrancar: si el servicio estuvo caido, no hay que esperar
    // seis horas para recuperar lo acumulado.
    void this.runOnce();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ejecuta una pasada. Devuelve cuantas se limpiaron, o `null` si otra replica
   * tenia el cerrojo.
   */
  async runOnce(): Promise<number | null> {
    return this.lock.withLock(
      AbandonedUploadsTask.LOCK_KEY,
      AbandonedUploadsTask.LOCK_TTL_MS,
      async () => {
        const corte = new Date(
          this.clock.now().getTime() - AbandonedUploadsTask.ABANDONED_AFTER_MS,
        );

        const abandonadas = await this.assets.listAbandoned(corte, AbandonedUploadsTask.BATCH);
        if (abandonadas.length === 0) return 0;

        let limpiadas = 0;

        for (const asset of abandonadas) {
          const state = asset.snapshot();

          // Primero el OBJETO y despues la fila, nunca al reves. Si se borrara
          // la fila primero y fallara el almacen, el archivo quedaria en el
          // bucket sin nada que lo nombre: pagandose para siempre y sin forma de
          // encontrarlo. Al reves, un fallo al borrar la fila solo deja una
          // subida muerta mas, que la pasada siguiente vuelve a intentar.
          // Los dos juntos: un recurso que es un ENLACE externo no tiene bucket
          // ni clave, y ahi no hay nada que borrar del almacen -solo la fila-.
          if (state.storageKey && state.bucket) {
            const bucket = state.bucket;
            try {
              await this.storage.delete(bucket, state.storageKey.value);
            } catch (error) {
              // Se registra y se SIGUE con las demas: un objeto que no se deja
              // borrar no puede parar la limpieza de las otras ciento noventa y
              // nueve. Lo vuelve a intentar la proxima pasada.
              this.logger.warn('No se pudo borrar un objeto abandonado', {
                assetId: asset.id.value,
                bucket: state.bucket ?? '',
                error: error instanceof Error ? error.message : String(error),
              });
              continue;
            }
          }

          await this.unitOfWork.run(async (tx) => {
            await this.assets.delete(asset.id, tx);
          });

          limpiadas += 1;
        }

        this.logger.info('Subidas abandonadas limpiadas', {
          encontradas: abandonadas.length,
          limpiadas,
        });

        return limpiadas;
      },
    );
  }
}

