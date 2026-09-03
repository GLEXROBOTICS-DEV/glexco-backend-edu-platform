import type { TransactionContext } from '@glexco/kernel';
import type { Announcement } from './announcement.aggregate';
import type { AnnouncementView } from '../application/announcements.usecase';

export interface AnnouncementRepository {
  save(announcement: Announcement, tx: TransactionContext): Promise<void>;
  findById(announcementId: string): Promise<Announcement | null>;
  /** Los vigentes de varios salones, fijados primero. Es la consulta de cada
   *  apertura del portal, asi que va al pool de replicas. */
  listActive(classroomIds: string[]): Promise<AnnouncementView[]>;
}

export interface ClassroomRecord {
  classroomId: string;
  institutionId: string;
  teacherId: string;
  name: string;
  grade: string | null;
  archived: boolean;
}

/**
 * Directorio de salones y matriculas, alimentado por eventos.
 *
 * Gemelo del de `assessment`. Existe para no llamar a instituciones en cada
 * publicacion ni en cada carga del portal: eso ataria escribir y leer anuncios a
 * que el otro servicio este arriba, y las dos cosas ocurren en mitad de una
 * clase. Puede ir unos segundos desatrasado, que es aceptable para decidir quien
 * escribe un anuncio y quien lo lee.
 */
export interface ClassroomDirectory {
  find(classroomId: string): Promise<ClassroomRecord | null>;
  /** Los salones de un usuario, sea alumno (por matricula) o docente (por
   *  asignacion). Devuelve solo identificadores: es lo unico que hace falta para
   *  acotar la consulta de anuncios. */
  classroomsFor(userId: string): Promise<string[]>;
}
