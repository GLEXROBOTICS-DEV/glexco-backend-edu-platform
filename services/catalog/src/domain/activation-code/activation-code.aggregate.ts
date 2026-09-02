import {
  AggregateRoot,
  BusinessRuleError,
  ConflictError,
  DomainEvent,
  Guard,
  ValueObject,
  defineId,
  type DomainEventContext,
} from '@glexco/kernel';
import {
  ACTIVATION_CODE_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  ACTIVATION_CODE_PREFIX,
  ACTIVATION_CODE_STATUS,
  EVENTS,
  type ActivationCodeStatus,
} from '@glexco/contracts';

export class ActivationCodeId extends defineId('ActivationCode') {}
export class CodeBatchId extends defineId('CodeBatch') {}

/**
 * Codigo de activacion impreso en el libro.
 *
 * Es el objeto con valor economico de la plataforma: quien tiene un codigo
 * valido tiene acceso al contenido de un kit. Por eso su formato esta pensado
 * para dos cosas a la vez, y las dos importan:
 *
 * 1. **Que un nino pueda transcribirlo de papel sin fallar.** El alfabeto excluye
 *    O/0, I/1 y L, que son los pares que se confunden al copiar. Se acepta con o
 *    sin guiones y en cualquier capitalizacion. Exigir un formato exacto no
 *    aporta seguridad y si genera tickets de soporte de un colegio entero el
 *    primer dia de clase.
 *
 * 2. **Que adivinarlo sea inviable.** 31 simbolos en 12 posiciones son 31^12,
 *    unos 7,9·10^17. Aun probando mil codigos por segundo sin ningun limite,
 *    recorrer una milesima parte del espacio llevaria siglos. La limitacion de
 *    intentos por IP es la segunda linea, no la primera.
 */
export class ActivationCodeValue extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  /**
   * Normaliza cualquier forma tecleada a la canonica.
   *
   * "glx 8f2k 9m3p 7q4r", "GLX-8F2K-9M3P-7Q4R" y "glx8f2k9m3p7q4r" son el mismo
   * codigo. La normalizacion vive aqui y no en el controlador para que cualquier
   * via de entrada -formulario, importacion, consumidor de eventos- obtenga la
   * misma garantia.
   */
  static create(raw: string): ActivationCodeValue {
    const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

    Guard.againstEmpty(normalized, 'activationCode');

    if (!normalized.startsWith(ACTIVATION_CODE_PREFIX)) {
      throw new BusinessRuleError(
        'ACTIVATION_CODE_INVALID',
        'El codigo del libro no es valido.',
        { field: 'activationCode' },
      );
    }

    const body = normalized.slice(ACTIVATION_CODE_PREFIX.length);

    if (body.length !== ACTIVATION_CODE_LENGTH) {
      throw new BusinessRuleError(
        'ACTIVATION_CODE_INVALID',
        'El codigo del libro no es valido.',
        { field: 'activationCode' },
      );
    }

    // Un caracter fuera del alfabeto significa que se transcribio mal, casi
    // siempre una O por un 0 o una I por un 1.
    for (const char of body) {
      if (!ACTIVATION_CODE_ALPHABET.includes(char)) {
        throw new BusinessRuleError(
          'ACTIVATION_CODE_INVALID',
          'El codigo del libro no es valido. Revisa que lo hayas copiado correctamente.',
          { field: 'activationCode' },
        );
      }
    }

    return new ActivationCodeValue(normalized);
  }

  /** Forma sin separadores, que es como se guarda e indexa. */
  get value(): string {
    return this.props.value;
  }

  /** Forma legible para imprimir: GLX-XXXX-XXXX-XXXX */
  get formatted(): string {
    const body = this.props.value.slice(ACTIVATION_CODE_PREFIX.length);
    const groups = body.match(/.{1,4}/g) ?? [];
    return [ACTIVATION_CODE_PREFIX, ...groups].join('-');
  }

  override toString(): string {
    return this.formatted;
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

const AGGREGATE = 'ActivationCode';

export interface ActivationCodeRedeemedPayload {
  activationCodeId: string;
  /** El codigo NO viaja en el evento. Los eventos viven dias en el stream y en
   *  la outbox; meter ahi un secreto con valor economico multiplica la
   *  superficie de exposicion sin que ningun consumidor lo necesite. */
  kitId: string;
  studentId: string;
  batchId: string;
  institutionId?: string;
  grade: string;
  redeemedAt: string;
}

export class ActivationCodeRedeemed extends DomainEvent<ActivationCodeRedeemedPayload> {
  constructor(
    payload: ActivationCodeRedeemedPayload,
    version: number,
    context?: DomainEventContext,
  ) {
    super(
      EVENTS.ACTIVATION_CODE_REDEEMED,
      AGGREGATE,
      payload.activationCodeId,
      version,
      payload,
      context,
    );
  }
}

export interface ActivationCodeRevokedPayload {
  activationCodeId: string;
  kitId: string;
  reason: string;
  revokedBy: string;
  /** Si ya estaba canjeado, al alumno hay que retirarle el acceso. */
  previouslyRedeemedBy?: string;
  revokedAt: string;
}

export class ActivationCodeRevoked extends DomainEvent<ActivationCodeRevokedPayload> {
  constructor(
    payload: ActivationCodeRevokedPayload,
    version: number,
    context?: DomainEventContext,
  ) {
    super(
      EVENTS.ACTIVATION_CODE_REVOKED,
      AGGREGATE,
      payload.activationCodeId,
      version,
      payload,
      context,
    );
  }
}

// ---------------------------------------------------------------------------
// Agregado
// ---------------------------------------------------------------------------

interface ActivationCodeState {
  /** Hash del codigo, NO el codigo. Ver la nota de `ActivationCode`. */
  codeHash: string;
  /** Ultimos cuatro caracteres, para que soporte pueda identificarlo con el
   *  cliente al telefono sin poder reconstruirlo. */
  codeSuffix: string;
  batchId: string;
  kitId: string;
  grade: string;
  status: ActivationCodeStatus;
  redeemedBy: string | null;
  redeemedAt: Date | null;
  /** Institucion a la que se distribuyo el lote, si fue venta institucional. */
  distributedTo: string | null;
  expiresAt: Date | null;
  revokedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Codigo de activacion.
 *
 * **El codigo se guarda hasheado, nunca en claro.** Es la misma decision que con
 * las contrasenas y por el mismo motivo: si alguien obtiene un volcado de la
 * base, no debe salir de ahi con miles de accesos vendibles. La consulta de
 * canje busca por hash, que es igual de rapido porque el indice es sobre el
 * hash.
 *
 * Se usa SHA-256 y no Argon2: el codigo tiene 60 bits de entropia real y no es
 * adivinable por diccionario, asi que un hash lento solo anadiria latencia al
 * registro sin aportar nada.
 *
 * **El canje es de un solo uso, y esa garantia NO vive aqui.** Este agregado
 * rechaza canjear un codigo ya canjeado segun el estado que tiene cargado, pero
 * eso solo es correcto si nadie mas puede cambiarlo entre la lectura y la
 * escritura. Quien lo garantiza es el repositorio, cargando la fila con
 * `SELECT ... FOR UPDATE` dentro de la transaccion. Las dos piezas son
 * necesarias: sin el bloqueo, dos peticiones simultaneas con el mismo codigo
 * leerian ambas "disponible" y ambas pasarian esta comprobacion.
 */
export class ActivationCode extends AggregateRoot<ActivationCodeId> {
  private constructor(
    id: ActivationCodeId,
    private state: ActivationCodeState,
  ) {
    super(id);
  }

  static issue(input: {
    id: ActivationCodeId;
    codeHash: string;
    codeSuffix: string;
    batchId: string;
    kitId: string;
    grade: string;
    expiresAt?: Date | null;
    now: Date;
  }): ActivationCode {
    return new ActivationCode(input.id, {
      codeHash: input.codeHash,
      codeSuffix: input.codeSuffix,
      batchId: input.batchId,
      kitId: input.kitId,
      grade: input.grade,
      status: ACTIVATION_CODE_STATUS.ISSUED,
      redeemedBy: null,
      redeemedAt: null,
      distributedTo: null,
      expiresAt: input.expiresAt ?? null,
      revokedReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(
    id: ActivationCodeId,
    state: ActivationCodeState,
    version: number,
  ): ActivationCode {
    const code = new ActivationCode(id, state);
    code.setVersion(version);
    return code;
  }

  /**
   * Comprueba si el codigo se puede canjear, sin canjearlo.
   *
   * La usa la comprobacion previa del formulario de registro. Devuelve el motivo
   * para que quien llama decida cuanto contar al usuario: solo
   * `already_redeemed` se le comunica de forma especifica, porque es el unico
   * caso en que puede hacer algo util con la informacion (reclamar el libro).
   * Los demas se agrupan para no confirmar aciertos parciales a quien este
   * sondeando.
   */
  redeemabilityAt(now: Date): { ok: true } | { ok: false; reason: ActivationCodeRejection } {
    if (this.state.status === ACTIVATION_CODE_STATUS.REDEEMED) {
      return { ok: false, reason: 'already_redeemed' };
    }
    if (this.state.status === ACTIVATION_CODE_STATUS.REVOKED) {
      return { ok: false, reason: 'revoked' };
    }
    if (this.state.expiresAt && this.state.expiresAt <= now) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true };
  }

  /**
   * Canjea el codigo a favor de un alumno.
   *
   * Debe ejecutarse con la fila ya bloqueada. Es irreversible por diseno: el
   * codigo impreso en ese libro no vuelve a servir.
   */
  redeem(input: {
    studentId: string;
    institutionId?: string;
    now: Date;
  }): void {
    // Idempotencia: si el MISMO alumno reintenta -un reintento de red, un evento
    // entregado dos veces- se devuelve sin error y sin emitir un segundo evento.
    // Solo para el mismo alumno: para otro es un conflicto real.
    if (
      this.state.status === ACTIVATION_CODE_STATUS.REDEEMED &&
      this.state.redeemedBy === input.studentId
    ) {
      return;
    }

    const check = this.redeemabilityAt(input.now);
    if (!check.ok) {
      throw new ConflictError(
        check.reason === 'already_redeemed'
          ? 'ACTIVATION_CODE_ALREADY_USED'
          : 'ACTIVATION_CODE_INVALID',
        check.reason === 'already_redeemed'
          ? 'Este codigo ya fue utilizado. Si crees que es un error, contacta con tu institucion.'
          : 'El codigo del libro no es valido.',
        { field: 'activationCode' },
      );
    }

    this.state.status = ACTIVATION_CODE_STATUS.REDEEMED;
    this.state.redeemedBy = input.studentId;
    this.state.redeemedAt = input.now;
    this.state.updatedAt = input.now;

    this.record(
      (version) =>
        new ActivationCodeRedeemed(
          {
            activationCodeId: this.id.value,
            kitId: this.state.kitId,
            studentId: input.studentId,
            batchId: this.state.batchId,
            institutionId: input.institutionId,
            grade: this.state.grade,
            redeemedAt: input.now.toISOString(),
          },
          version,
          { actorId: input.studentId, tenantId: input.institutionId },
        ),
    );
  }

  /** Marca el lote como entregado a una institucion o punto de venta. */
  markDistributed(institutionId: string | null, now: Date): void {
    if (this.state.status !== ACTIVATION_CODE_STATUS.ISSUED) return;
    this.state.status = ACTIVATION_CODE_STATUS.DISTRIBUTED;
    this.state.distributedTo = institutionId;
    this.state.updatedAt = now;
  }

  /**
   * Anula el codigo: error de impresion, devolucion o fraude.
   *
   * Se puede anular incluso uno ya canjeado. En ese caso el evento lleva el
   * alumno afectado, para que se le retire el acceso al kit. Es la unica via de
   * revertir un canje, y deliberadamente deja rastro en vez de devolver el
   * codigo a "disponible": un codigo que vuelve a estar libre despues de haberse
   * usado es un agujero de auditoria.
   */
  revoke(reason: string, by: string, now: Date): void {
    if (this.state.status === ACTIVATION_CODE_STATUS.REVOKED) return;

    Guard.againstEmpty(reason, 'reason');

    const previouslyRedeemedBy = this.state.redeemedBy ?? undefined;

    this.state.status = ACTIVATION_CODE_STATUS.REVOKED;
    this.state.revokedReason = reason;
    this.state.updatedAt = now;

    this.record(
      (version) =>
        new ActivationCodeRevoked(
          {
            activationCodeId: this.id.value,
            kitId: this.state.kitId,
            reason,
            revokedBy: by,
            previouslyRedeemedBy,
            revokedAt: now.toISOString(),
          },
          version,
          { actorId: by },
        ),
    );
  }

  /** Marca como caducado un codigo que paso su fecha limite sin canjearse. */
  expire(now: Date): void {
    if (this.state.status === ACTIVATION_CODE_STATUS.REDEEMED) return;
    if (this.state.status === ACTIVATION_CODE_STATUS.REVOKED) return;
    if (!this.state.expiresAt || this.state.expiresAt > now) return;

    this.state.status = ACTIVATION_CODE_STATUS.EXPIRED;
    this.state.updatedAt = now;
  }

  get kitId(): string {
    return this.state.kitId;
  }
  get batchId(): string {
    return this.state.batchId;
  }
  get grade(): string {
    return this.state.grade;
  }
  get status(): ActivationCodeStatus {
    return this.state.status;
  }
  get redeemedBy(): string | null {
    return this.state.redeemedBy;
  }
  get redeemedAt(): Date | null {
    return this.state.redeemedAt;
  }
  get codeSuffix(): string {
    return this.state.codeSuffix;
  }
  get expiresAt(): Date | null {
    return this.state.expiresAt;
  }

  snapshot(): Readonly<ActivationCodeState> {
    return this.state;
  }
}

export type ActivationCodeRejection = 'already_redeemed' | 'revoked' | 'expired';
