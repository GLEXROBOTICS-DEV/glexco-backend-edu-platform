import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

/**
 * Identidad de un agregado.
 *
 * Los ids se generan en el dominio (no en la base de datos) por dos razones:
 * 1. Un caso de uso puede publicar el evento de creacion y devolver el id sin
 *    esperar al INSERT, lo que habilita escrituras diferidas y reintentos
 *    idempotentes.
 * 2. Con varias replicas escribiendo en paralelo no dependemos de secuencias
 *    centralizadas, que son un punto de contencion al escalar horizontalmente.
 */
export class Identifier<T extends string = string> {
  /**
   * Marca de tipo. Existe solo para el compilador (nunca en runtime): sin ella
   * TypeScript compararia los identificadores de forma estructural y dejaria
   * pasar un StudentId donde se espera un ClassroomId.
   *
   * No puede ser `private`: las clases anonimas que devuelve `defineId` no
   * pueden exportar un tipo con miembros privados (TS4094).
   */
  declare readonly __idTag?: T;

  protected constructor(public readonly value: string) {}

  static isValid(value: string): boolean {
    return uuidValidate(value);
  }

  equals(other?: Identifier<T> | null): boolean {
    if (other === null || other === undefined) return false;
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/**
 * Crea una clase de identificador tipada por agregado, para que el compilador
 * impida pasar un StudentId donde se espera un ClassroomId.
 *
 *   export class ClassroomId extends defineId('Classroom') {}
 */
export function defineId<Tag extends string>(tag: Tag) {
  return class TypedId extends Identifier<Tag> {
    static readonly tag = tag;

    static create(value?: string): TypedId {
      const id = value ?? uuidv4();
      if (!uuidValidate(id)) {
        throw new TypeError(`Identificador invalido para ${tag}: ${JSON.stringify(id)}`);
      }
      return new TypedId(id);
    }
  };
}

export const newUuid = (): string => uuidv4();
