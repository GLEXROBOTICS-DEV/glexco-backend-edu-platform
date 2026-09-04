import { describe, expect, it } from 'vitest';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
  isAutoGradable,
} from '../src/domain/assessment.aggregate';
import { SUBMISSION_STATUS, Submission, SubmissionId } from '../src/domain/submission.aggregate';

/**
 * Preguntas de EMPAREJAR.
 *
 * Lo que hacia falta no era el algoritmo -contar parejas acertadas es trivial-
 * sino el MODELO: una lista plana de identificadores no puede decir que va con
 * que. Estas pruebas cubren las dos mitades: que el modelo no deja capturar una
 * pregunta imposible de acertar, y que la clave no viaja al alumno por el hueco
 * mas facil de dejar abierto, que es el ORDEN de la columna derecha.
 */

const NOW = new Date('2026-09-04T12:00:00Z');
const KIT = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '44444444-4444-4444-8444-444444444444';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const INSTITUTION = '77777777-7777-4777-8777-777777777777';

/** Identificadores con forma de UUID: el desordenado de la derecha se apoya en
 *  que su orden no tiene relacion con el de captura. */
const IZQUIERDA = [
  { id: 'aa000000-0000-4000-8000-000000000001', text: 'Yanshee' },
  { id: 'aa000000-0000-4000-8000-000000000002', text: 'uKit' },
  { id: 'aa000000-0000-4000-8000-000000000003', text: 'Dobot' },
];

const DERECHA = [
  { id: 'ff000000-0000-4000-8000-000000000009', text: 'Robot humanoide' },
  { id: 'cc000000-0000-4000-8000-000000000005', text: 'Kit de bloques' },
  { id: 'bb000000-0000-4000-8000-000000000001', text: 'Brazo robotico' },
];

const CLAVE = [
  { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
  { optionId: IZQUIERDA[1]!.id, matchId: DERECHA[1]!.id },
  { optionId: IZQUIERDA[2]!.id, matchId: DERECHA[2]!.id },
];

function quizVacio(): Assessment {
  return Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.GLEXCO,
    institutionId: null,
    authorId: AUTHOR,
    kind: ASSESSMENT_TYPES.QUIZ,
    title: 'Reconoce los kits',
    passingScore: 60,
    now: NOW,
  });
}

function quizDeEmparejar(points = 9): Assessment {
  const assessment = quizVacio();

  assessment.addQuestion(
    {
      id: 'q-1',
      type: QUESTION_TYPES.MATCHING,
      prompt: 'Empareja cada kit con lo que es.',
      options: IZQUIERDA,
      matches: DERECHA,
      pairs: CLAVE,
      // Emparejar no usa `correctOptionIds`: su clave son los pares.
      correctOptionIds: [],
      points,
      explanation: null,
    },
    NOW,
  );

  assessment.publish(NOW);
  return assessment;
}

function responder(
  assessment: Assessment,
  pairs: { optionId: string; matchId: string }[],
): Submission {
  const submission = Submission.start({
    id: SubmissionId.create(),
    assessment,
    studentId: STUDENT,
    institutionId: INSTITUTION,
    classroomId: null,
    attemptNumber: 1,
    now: NOW,
  });

  submission.answer({ questionId: 'q-1', pairs, now: NOW });
  submission.submit(assessment, NOW);
  return submission;
}

describe('Emparejar: la maquina la corrige sola', () => {
  it('esta en la lista de autocorregibles', () => {
    expect(isAutoGradable(QUESTION_TYPES.MATCHING)).toBe(true);
  });

  it('no deja la entrega esperando a un docente', () => {
    const submission = responder(quizDeEmparejar(), CLAVE);
    expect(submission.snapshot().status).toBe(SUBMISSION_STATUS.GRADED);
  });
});

describe('Emparejar: la nota es parcial, por parejas acertadas', () => {
  it('todo emparejado vale todos los puntos', () => {
    expect(responder(quizDeEmparejar(9), CLAVE).snapshot().score).toBe(9);
  });

  it('dos parejas cruzadas conservan la tercera', () => {
    // Yanshee y uKit cambiadas; Dobot en su sitio -> 1 de 3.
    const cruzado = [
      { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[1]!.id },
      { optionId: IZQUIERDA[1]!.id, matchId: DERECHA[0]!.id },
      { optionId: IZQUIERDA[2]!.id, matchId: DERECHA[2]!.id },
    ];

    expect(responder(quizDeEmparejar(9), cruzado).snapshot().score).toBe(3);
  });

  it('no emparejar nada es cero, y queda constancia', () => {
    const submission = responder(quizDeEmparejar(9), []);
    const state = submission.snapshot();

    expect(state.score).toBe(0);
    // Se guarda la respuesta en cero y no se omite: el alumno tiene que ver que
    // no la contesto, en vez de creer que la fallo.
    expect(state.answers[0]?.awardedPoints).toBe(0);
  });

  it('se redondea hacia abajo, no se regalan puntos', () => {
    // 2 de 3 sobre 10 puntos = 6.66 -> 6.
    const dosBien = [
      { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
      { optionId: IZQUIERDA[1]!.id, matchId: DERECHA[1]!.id },
      { optionId: IZQUIERDA[2]!.id, matchId: DERECHA[1]!.id },
    ];

    expect(responder(quizDeEmparejar(10), dosBien).snapshot().score).toBe(6);
  });

  it('repetir la misma pareja correcta no multiplica la nota', () => {
    // El agujero clasico de la puntuacion parcial: mandar el acierto tres veces
    // para cobrarlo tres veces. Se cuenta por elemento de la izquierda.
    const repetida = [
      { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
      { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
      { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
    ];

    expect(responder(quizDeEmparejar(9), repetida).snapshot().score).toBe(3);
  });

  it('una pareja inventada no suma', () => {
    const inventada = [
      { optionId: IZQUIERDA[0]!.id, matchId: 'no-existe' },
      { optionId: 'tampoco-existe', matchId: DERECHA[0]!.id },
    ];

    expect(responder(quizDeEmparejar(9), inventada).snapshot().score).toBe(0);
  });
});

describe('Emparejar: la clave NO viaja al alumno', () => {
  it('forStudent no devuelve los pares', () => {
    const pregunta = quizDeEmparejar().forStudent()[0]!;

    expect(pregunta.matches).toBeDefined();
    // Un cuestionario cuya clave viaja al navegador no evalua nada: basta abrir
    // la pestana de red.
    expect((pregunta as unknown as Record<string, unknown>)['pairs']).toBeUndefined();
    expect((pregunta as unknown as Record<string, unknown>)['correctOptionIds']).toBeUndefined();
  });

  it('la columna derecha sale DESORDENADA respecto a la izquierda', () => {
    const pregunta = quizDeEmparejar().forStudent()[0]!;

    // Es el hueco mas facil de dejar abierto: si la derecha sale en el orden de
    // captura, emparejar el primero con el primero acierta todo sin saber nada.
    // Se ordena por identificador -UUID, sin relacion con el orden de captura-
    // en vez de con azar, para que el dominio siga siendo determinista.
    expect(pregunta.matches?.map((match) => match.text)).toEqual([
      'Brazo robotico',
      'Kit de bloques',
      'Robot humanoide',
    ]);
  });

  it('el desorden es estable entre cargas', () => {
    // Con `Math.random()` la derecha bailaria al recargar y el alumno perderia
    // lo que llevaba emparejado.
    const assessment = quizDeEmparejar();

    expect(assessment.forStudent()[0]!.matches).toEqual(assessment.forStudent()[0]!.matches);
  });
});

describe('Emparejar: no se puede capturar una pregunta imposible de acertar', () => {
  /** El CODIGO y no el mensaje: el mensaje es texto para una persona y cambia. */
  function codigoAl(anadir: () => void): string {
    try {
      anadir();
    } catch (error) {
      return (error as { code?: string }).code ?? 'SIN_CODIGO';
    }

    throw new Error('No lanzo nada, y tenia que lanzar.');
  }

  function anadir(overrides: Record<string, unknown>): void {
    quizVacio().addQuestion(
      {
        id: 'q-1',
        type: QUESTION_TYPES.MATCHING,
        prompt: 'Empareja cada kit con lo que es.',
        options: IZQUIERDA,
        matches: DERECHA,
        pairs: CLAVE,
        correctOptionIds: [],
        points: 9,
        explanation: null,
        ...overrides,
      },
      NOW,
    );
  }

  it('sin columna derecha, no', () => {
    expect(codigoAl(() => anadir({ matches: [], pairs: [] }))).toBe('MATCHING_NEEDS_TWO_COLUMNS');
  });

  it('dejar un elemento de la izquierda sin pareja, no', () => {
    // El alumno tendria que emparejar algo que no puntua y no hay forma de que
    // lo sepa.
    expect(codigoAl(() => anadir({ pairs: CLAVE.slice(0, 2) }))).toBe('MATCHING_NEEDS_ALL_PAIRS');
  });

  it('una pareja que apunta a un elemento inexistente, no', () => {
    expect(
      codigoAl(() =>
        anadir({
          pairs: [{ optionId: IZQUIERDA[0]!.id, matchId: 'no-existe' }, ...CLAVE.slice(1)],
        }),
      ),
    ).toBe('MATCHING_PAIR_UNKNOWN');
  });

  it('el mismo elemento de la izquierda con dos parejas, no', () => {
    expect(
      codigoAl(() =>
        anadir({
          pairs: [
            { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
            { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[1]!.id },
            { optionId: IZQUIERDA[2]!.id, matchId: DERECHA[2]!.id },
          ],
        }),
      ),
    ).toBe('MATCHING_OPTION_DUPLICATED');
  });

  it('el mismo elemento de la derecha para dos de la izquierda, no', () => {
    // Se podria permitir, pero entonces "cuantas parejas acerto" deja de ser
    // explicable: quien asigna el mismo elemento a todo acertaria varias sin
    // haber emparejado nada.
    expect(
      codigoAl(() =>
        anadir({
          pairs: [
            { optionId: IZQUIERDA[0]!.id, matchId: DERECHA[0]!.id },
            { optionId: IZQUIERDA[1]!.id, matchId: DERECHA[0]!.id },
            { optionId: IZQUIERDA[2]!.id, matchId: DERECHA[2]!.id },
          ],
        }),
      ),
    ).toBe('MATCHING_MATCH_DUPLICATED');
  });
});
