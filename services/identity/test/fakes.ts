import { randomUUID } from 'node:crypto';
import type {
  Clock,
  CursorPage,
  CursorQuery,
  LoggerPort,
  PasswordHasher,
  TransactionContext,
  UnitOfWork,
} from '@glexco/kernel';
import type { Role } from '@glexco/contracts';
import type { User } from '../src/domain/user/user.aggregate';
import type { UserRepository, UserSummary } from '../src/domain/user/user.repository';
import type { Email, UserId } from '../src/domain/user/value-objects';
import type { Session, SessionStore } from '../src/domain/session/session';
import type {
  AccessTokenInput,
  AuditEntry,
  AuditLog,
  PasswordPolicy,
  RefreshTokenInput,
  RefreshTokenPayload,
  TokenIssuer,
} from '../src/application/ports';

/**
 * Dobles en memoria de los puertos.
 *
 * Existen porque los casos de uso dependen de interfaces y no de PostgreSQL,
 * Redis o NATS. Gracias a eso una prueba de "bloquear la cuenta tras cinco
 * intentos fallidos" corre en microsegundos, y no hay que arrancar Docker ni
 * limpiar una base entre pruebas.
 *
 * Se implementan a mano en lugar de con una libreria de mocks a proposito: un
 * doble con comportamiento real (que de verdad guarda y devuelve) detecta
 * errores que un mock configurado para devolver lo esperado nunca vera.
 */

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-09-02T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  timestamp(): number {
    return this.current.getTime();
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(date: Date): void {
    this.current = date;
  }
}

export class FakeUnitOfWork implements UnitOfWork {
  readonly publishedEvents: unknown[] = [];
  /** Fuerza un fallo para comprobar que no se persiste nada a medias. */
  failNext = false;

  async run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const collected: unknown[] = [];
    const tx = {
      enqueue: (...events: unknown[]) => collected.push(...events),
    } as unknown as TransactionContext;

    if (this.failNext) {
      this.failNext = false;
      throw new Error('fallo simulado de transaccion');
    }

    const result = await work(tx);
    // Solo se "publican" tras el commit, igual que en la implementacion real.
    this.publishedEvents.push(...collected);
    return result;
  }
}

export class FakeUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();
  private readonly byEmail = new Map<string, string>();

  seed(user: User): void {
    this.byId.set(user.id.value, user);
    this.byEmail.set(user.email.value, user.id.value);
  }

  async findById(id: UserId): Promise<User | null> {
    return this.byId.get(id.value) ?? null;
  }

  async findByEmailForAuth(email: Email): Promise<User | null> {
    const id = this.byEmail.get(email.value);
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    return this.byEmail.has(email.value);
  }

  async save(user: User): Promise<void> {
    this.byId.set(user.id.value, user);
    this.byEmail.set(user.email.value, user.id.value);
  }

  async listByInstitution(
    _institutionId: string,
    _filters: unknown,
    _page: CursorQuery,
  ): Promise<CursorPage<UserSummary>> {
    return { items: [], nextCursor: null };
  }

  async countByInstitutionAndRole(): Promise<Record<Role, number>> {
    return {} as Record<Role, number>;
  }
}

export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, Session>();
  readonly revokedFamilies: string[] = [];

  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }
  async findById(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }
  async rotate(
    sessionId: string,
    presentedTokenId: string,
    next: Session,
  ): Promise<'rotated' | 'reused' | 'not_found'> {
    const current = this.sessions.get(sessionId);
    if (!current) return 'not_found';
    if (current.currentTokenId !== presentedTokenId) return 'reused';
    this.sessions.set(sessionId, next);
    return 'rotated';
  }
  async revoke(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
  async revokeFamily(familyId: string): Promise<void> {
    this.revokedFamilies.push(familyId);
    for (const [id, session] of this.sessions) {
      if (session.familyId === familyId) this.sessions.delete(id);
    }
  }
  async revokeAllForUser(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) this.sessions.delete(id);
    }
  }
  async listForUser(userId: string): Promise<Session[]> {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }
  async isRevoked(sessionId: string): Promise<boolean> {
    return !this.sessions.has(sessionId);
  }
}

/**
 * Hasher rapido para pruebas.
 *
 * Argon2 real tarda ~80 ms por operacion: con veinte pruebas que hashean, la
 * suite pasaria de milisegundos a segundos. El formato imita al real para que
 * las comprobaciones de `PasswordHash` sigan aplicandose.
 */
export class FakePasswordHasher implements PasswordHasher {
  hashCalls = 0;
  verifyCalls = 0;
  /** Simula un hash con parametros obsoletos, para probar el rehash. */
  staleHashes = new Set<string>();

  async hash(plain: string): Promise<string> {
    this.hashCalls += 1;
    return `$argon2id$v=19$m=19456,t=2,p=1$fakesalt$${Buffer.from(plain).toString('base64url')}`;
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    this.verifyCalls += 1;
    return hashed.endsWith(Buffer.from(plain).toString('base64url'));
  }

  needsRehash(hashed: string): boolean {
    return this.staleHashes.has(hashed);
  }
}

export class FakeTokenIssuer implements TokenIssuer {
  private readonly refreshTokens = new Map<string, RefreshTokenPayload>();

  issueAccessToken(input: AccessTokenInput): { token: string; expiresInSeconds: number } {
    return { token: `access.${input.userId}.${input.sessionId}`, expiresInSeconds: 900 };
  }

  issueRefreshToken(input: RefreshTokenInput): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + (input.longLived ? 30 : 0.5) * 86_400_000);
    const token = `refresh.${tokenId}`;
    this.refreshTokens.set(token, {
      userId: input.userId,
      sessionId: input.sessionId,
      familyId: input.familyId,
      tokenId,
      expiresAt,
    });
    return { token, tokenId, expiresAt };
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    const payload = this.refreshTokens.get(token);
    if (!payload) throw new Error('token invalido');
    return payload;
  }
}

/** Limitador que nunca bloquea, salvo que se le indique. */
export class FakeRateLimiter {
  blockKeys = new Set<string>();
  readonly consumed: string[] = [];

  async consume(
    key: string,
    limit: number,
  ): Promise<{ allowed: boolean; used: number; limit: number; retryAfterSeconds: number }> {
    this.consumed.push(key);
    const blocked = [...this.blockKeys].some((prefix) => key.startsWith(prefix));
    return { allowed: !blocked, used: blocked ? limit : 1, limit, retryAfterSeconds: blocked ? 60 : 0 };
  }
}

export class FakeAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  find(action: string, outcome?: 'success' | 'failure'): AuditEntry[] {
    return this.entries.filter(
      (entry) => entry.action === action && (!outcome || entry.outcome === outcome),
    );
  }
}

export class PermissivePasswordPolicy implements PasswordPolicy {
  async assertAcceptable(): Promise<void> {}
}

export const silentLogger: LoggerPort = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
