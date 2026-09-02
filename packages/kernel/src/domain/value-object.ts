/**
 * Objeto de valor: sin identidad propia, inmutable, comparado por sus atributos.
 *
 * Encapsula las reglas de formato o rango en su constructor, de modo que un
 * valor invalido no pueda existir en memoria. La validacion vive aqui y no en
 * el controlador HTTP: cualquier adaptador (REST, consumidor de eventos, script
 * de importacion) obtiene la misma garantia sin repetir codigo.
 */
export abstract class ValueObject<Props extends Record<string, unknown>> {
  protected readonly props: Readonly<Props>;

  protected constructor(props: Props) {
    this.props = Object.freeze({ ...props });
  }

  equals(other?: ValueObject<Props> | null): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  toJSON(): Props {
    return this.props as Props;
  }
}
