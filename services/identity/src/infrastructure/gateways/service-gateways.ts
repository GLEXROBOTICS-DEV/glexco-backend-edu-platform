import { CircuitBreaker, defaultBreakerOptions } from '@glexco/nest-platform';
import { ServiceUnavailableError } from '@glexco/kernel';
import type { Logger } from '@glexco/observability';
import { getRequestContext } from '@glexco/observability';
import type {
  ActivationCodeGateway,
  ActivationCodePrecheck,
  ClassroomGateway,
  ClassroomPrecheck,
  InstitutionGateway,
  InstitutionSummaryCheck,
} from '../../application/ports';

/**
 * Adaptadores HTTP hacia otros microservicios.
 *
 * Cada dependencia lleva su propio interruptor de circuito. Si catalogo se
 * degrada, el registro deja de funcionar de inmediato con un error claro, pero
 * el inicio de sesion, el refresco de token y el resto de identidad siguen
 * intactos. Sin el interruptor, las peticiones de registro se acumularian
 * esperando a catalogo, agotarian los sockets del proceso y tumbarian tambien lo
 * que no dependia de el: el fallo en cascada clasico.
 *
 * Se propaga `x-correlation-id` para poder seguir una peticion a traves de los
 * dos servicios en los logs.
 */
export class HttpActivationCodeGateway implements ActivationCodeGateway {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      ...defaultBreakerOptions('catalog', logger),
      // Umbral corto y timeout ajustado: es una comprobacion de lectura sencilla
      // y si tarda mas de dos segundos hay un problema real al otro lado.
      timeoutMs: 2_000,
      failureThreshold: 5,
    });
  }

  async precheck(code: string): Promise<ActivationCodePrecheck> {
    return this.breaker.execute(async () => {
      const response = await fetch(
        `${this.baseUrl}/api/internal/v1/activation-codes/${encodeURIComponent(code)}/precheck`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.internalToken}`,
            'x-correlation-id': getRequestContext()?.correlationId ?? '',
            Accept: 'application/json',
          },
        },
      );

      // 404 es una respuesta valida del negocio, no un fallo de la dependencia:
      // significa "ese codigo no existe". Tratarlo como error abriria el
      // circuito cada vez que alguien se equivoca al teclear.
      if (response.status === 404) return { valid: false, reason: 'not_found' as const };

      if (!response.ok) {
        throw new ServiceUnavailableError(
          'CATALOG_UNAVAILABLE',
          'El servicio de catalogo no respondio correctamente.',
          { status: response.status },
        );
      }

      return (await response.json()) as ActivationCodePrecheck;
    });
  }
}

export class HttpClassroomGateway implements ClassroomGateway {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      ...defaultBreakerOptions('institutions', logger),
      timeoutMs: 2_000,
    });
  }

  async precheck(input: { institutionId: string; classroomId: string }): Promise<ClassroomPrecheck> {
    return this.breaker.execute(async () => {
      const url = new URL(`${this.baseUrl}/api/internal/v1/classrooms/precheck`);
      url.searchParams.set('institutionId', input.institutionId);
      url.searchParams.set('classroomId', input.classroomId);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.internalToken}`,
          'x-correlation-id': getRequestContext()?.correlationId ?? '',
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        return {
          exists: false,
          belongsToInstitution: false,
          hasCapacity: false,
          capacity: 0,
          enrolled: 0,
        };
      }

      if (!response.ok) {
        throw new ServiceUnavailableError(
          'INSTITUTIONS_UNAVAILABLE',
          'El servicio de instituciones no respondio correctamente.',
          { status: response.status },
        );
      }

      return (await response.json()) as ClassroomPrecheck;
    });
  }
}

export class HttpInstitutionGateway implements InstitutionGateway {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    logger?: Logger,
  ) {
    this.breaker = new CircuitBreaker({
      ...defaultBreakerOptions('institutions', logger),
      timeoutMs: 2_000,
    });
  }

  async summary(institutionId: string): Promise<InstitutionSummaryCheck> {
    return this.breaker.execute(async () => {
      const response = await fetch(
        `${this.baseUrl}/api/internal/v1/institutions/${encodeURIComponent(institutionId)}/summary`,
        {
          headers: {
            Authorization: `Bearer ${this.internalToken}`,
            'x-correlation-id': getRequestContext()?.correlationId ?? '',
            Accept: 'application/json',
          },
        },
      );

      // 404 es una respuesta valida del negocio, no un fallo de la dependencia:
      // tratarla como error abriria el circuito cada vez que alguien teclea mal
      // un identificador.
      if (response.status === 404) return { exists: false, acceptsNewMembers: false };

      if (!response.ok) {
        throw new ServiceUnavailableError(
          'INSTITUTIONS_UNAVAILABLE',
          'El servicio de instituciones no respondio correctamente.',
          { status: response.status },
        );
      }

      return (await response.json()) as InstitutionSummaryCheck;
    });
  }
}

/**
 * Implementaciones en memoria para desarrollo local.
 *
 * Existen porque los servicios de catalogo e instituciones son de fases
 * posteriores, y sin ellas no se podria probar el registro de alumnos hoy. Se
 * activan solo cuando `NODE_ENV !== 'production'` y falta la URL del servicio
 * real; la comprobacion de produccion en el arranque impide que se cuelen en un
 * despliegue real.
 */
export class InMemoryActivationCodeGateway implements ActivationCodeGateway {
  /** Codigos de prueba: cualquiera que empiece por GLX-TEST se acepta. */
  private readonly redeemed = new Set<string>();

  async precheck(code: string): Promise<ActivationCodePrecheck> {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (this.redeemed.has(normalized)) {
      return { valid: false, reason: 'already_redeemed' };
    }
    if (!normalized.startsWith('GLXTEST')) {
      return { valid: false, reason: 'not_found' };
    }

    return {
      valid: true,
      activationCodeId: '00000000-0000-4000-8000-0000000000c0',
      kitId: '00000000-0000-4000-8000-000000000001',
      kitName: 'uKit AI - Zoologico Fantastico (kit de prueba)',
      grade: 'primary_3',
      program: 'discover',
    };
  }

  markRedeemed(code: string): void {
    this.redeemed.add(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  }
}

export class InMemoryClassroomGateway implements ClassroomGateway {
  async precheck(_input: {
    institutionId: string;
    classroomId: string;
  }): Promise<ClassroomPrecheck> {
    return {
      exists: true,
      belongsToInstitution: true,
      hasCapacity: true,
      capacity: 20,
      enrolled: 7,
      classroomName: '3.º A (salon de prueba)',
      teacherName: 'Docente de prueba',
    };
  }
}

export class InMemoryInstitutionGateway implements InstitutionGateway {
  async summary(_institutionId: string): Promise<InstitutionSummaryCheck> {
    return {
      exists: true,
      acceptsNewMembers: true,
      name: 'Institucion de prueba',
      shortName: 'Prueba',
      status: 'active',
    };
  }
}
