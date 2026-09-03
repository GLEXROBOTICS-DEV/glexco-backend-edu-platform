import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ForbiddenError } from '@glexco/kernel';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
  type Question,
} from '../src/domain/assessment.aggregate';
import { SUBMISSION_STATUS, Submission, SubmissionId } from '../src/domain/submission.aggregate';

const NOW = new Date('2026-09-03T12:00:00Z');
const KIT = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '44444444-4444-4444-8444-444444444444';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const OTHER_STUDENT = '66666666-6666-4666-8666-666666666666';
const INSTITUTION = '77777777-7777-4777-8777-777777777777';
const CLASSROOM = '88888888-8888-4888-8888-888888888888';
const TEACHER = '99999999-9999-4999-8999-999999999999';

interface QuizOptions {
  timeLimitMinutes?: number | null;
  maxAttempts?: number;
  withOpenQuestion?: boolean;
  multiple?: boolean;
  dueAt?: Date | null;
}

function publishedQuiz(options: QuizOptions = {}): Assessment {
  const assessment = Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.GLEXCO,
    institutionId: null,
    authorId: AUTHOR,
    kind: ASSESSMENT_TYPES.QUIZ,
    title: 'Piezas del uKit',
    passingScore: 60,
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.timeLimitMinutes !== undefined
      ? { timeLimitMinutes: options.timeLimitMinutes }
      : {}),
    ...(options.dueAt !== undefined ? { dueAt: options.dueAt } : {}),
    now: NOW,
  });

  const choice: Question & { id: string } = options.multiple
    ? {
        id: 'q-1',
        type: QUESTION_TYPES.MULTIPLE_CHOICE,
        prompt: 'Cuales son sensores?',
        options: [
          { id: 'o-1', text: 'Ultrasonido' },
          { id: 'o-2', text: 'Infrarrojo' },
          { id: 'o-3', text: 'Servo' },
        ],
        correctOptionIds: ['o-1', 'o-2'],
        points: 10,
        explanation: null,
      }
    : {
        id: 'q-1',
        type: QUESTION_TYPES.SINGLE_CHOICE,
        prompt: 'Cual es un servomotor?',
        options: [
          { id: 'o-1', text: 'El bloque' },
          { id: 'o-2', text: 'El servo' },
        ],
        correctOptionIds: ['o-2'],
        points: 10,
        explanation: null,
      };

  assessment.addQuestion(choice, NOW);

  if (options.withOpenQuestion) {
    assessment.addQuestion(
      {
        id: 'q-2',
        type: QUESTION_TYPES.SHORT_ANSWER,
        prompt: 'Explica que hace tu robot.',
        options: [],
        correctOptionIds: [],
        points: 10,
        explanation: null,
      },
      NOW,
    );
  }

  assessment.publish(NOW);
  return assessment;
}

function startAttempt(
  assessment: Assessment,
  overrides: { classroomId?: string | null; attemptNumber?: number; now?: Date } = {},
): Submission {
  return Submission.start({
    id: SubmissionId.create(),
    assessment,
    studentId: STUDENT,
    institutionId: INSTITUTION,
    classroomId: overrides.classroomId ?? null,
    attemptNumber: overrides.attemptNumber ?? 1,
    now: overrides.now ?? NOW,
  });
}

describe('Submission: abrir un intento', () => {
  it('no se abre sobre una evaluacion en borrador', () => {
    const draft = Assessment.create({
      id: AssessmentId.create(),
      kitId: KIT,
      origin: ASSESSMENT_ORIGIN.GLEXCO,
      institutionId: null,
      authorId: AUTHOR,
      kind: ASSESSMENT_TYPES.QUIZ,
      title: 'Sin publicar',
      now: NOW,
    });

    expect(() => startAttempt(draft)).toThrowError(/todavia no esta disponible/);
  });

  it('respeta el tope de intentos', () => {
    const quiz = publishedQuiz({ maxAttempts: 2 });

    expect(() => startAttempt(quiz, { attemptNumber: 2 })).not.toThrow();
    expect(() => startAttempt(quiz, { attemptNumber: 3 })).toThrowError(/agotaste los intentos/);
  });

  it('la fecha limite se comprueba al empezar, no al entregar', () => {
    const due = new Date('2026-09-02T12:00:00Z');
    const quiz = publishedQuiz({ dueAt: due });

    expect(() => startAttempt(quiz)).toThrowError(/fecha de entrega/);
  });

  it('un intento es de su dueno y de nadie mas', () => {
    const submission = startAttempt(publishedQuiz());

    expect(() => submission.assertOwnedBy(STUDENT)).not.toThrow();
    expect(() => submission.assertOwnedBy(OTHER_STUDENT)).toThrowError(ForbiddenError);
  });
});

describe('Submission: el salon, que decide quien corrige', () => {
  it('rellena el salon que faltaba', () => {
    // Pasa de verdad: el intento se abre antes de que la matricula este
    // proyectada. Sin rellenarlo, esa entrega no aparece en la bandeja de nadie
    // y lo que el alumno escriba no lo corrige nunca nadie.
    const submission = startAttempt(publishedQuiz({ withOpenQuestion: true }));
    expect(submission.snapshot().classroomId).toBeNull();

    submission.attachClassroom(CLASSROOM);

    expect(submission.snapshot().classroomId).toBe(CLASSROOM);
  });

  it('nunca cambia uno ya asignado', () => {
    const submission = startAttempt(publishedQuiz(), { classroomId: CLASSROOM });

    submission.attachClassroom('otro-salon');

    // Permitirlo dejaria mover una entrega de un docente a otro sin rastro.
    expect(submission.snapshot().classroomId).toBe(CLASSROOM);
  });

  it('no toca un intento ya entregado', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz);
    submission.submit(quiz, NOW);

    submission.attachClassroom(CLASSROOM);

    expect(submission.snapshot().classroomId).toBeNull();
  });
});

describe('Submission: correccion automatica', () => {
  it('corrige al entregar y cierra la nota si no queda nada manual', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz);

    submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-2'], now: NOW });
    submission.submit(quiz, NOW);

    const state = submission.snapshot();
    expect(state.status).toBe(SUBMISSION_STATUS.GRADED);
    expect(state.score).toBe(10);
    expect(state.passed).toBe(true);
    expect(state.gradedBy).toBeNull();
  });

  it('una pregunta sin responder queda a cero y con constancia', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz);

    submission.submit(quiz, NOW);

    const answer = submission.snapshot().answers.find((a) => a.questionId === 'q-1');
    // A cero, pero registrada: el alumno tiene que ver que no la contesto en
    // vez de creer que la fallo.
    expect(answer?.awardedPoints).toBe(0);
    expect(answer?.selectedOptionIds).toEqual([]);
    expect(submission.snapshot().passed).toBe(false);
  });

  it('en las de varias respuestas es todo o nada', () => {
    const quiz = publishedQuiz({ multiple: true });

    // Dos de las dos correctas: los puntos.
    const exact = startAttempt(quiz);
    exact.answer({ questionId: 'q-1', selectedOptionIds: ['o-1', 'o-2'], now: NOW });
    exact.submit(quiz, NOW);
    expect(exact.snapshot().score).toBe(10);

    // Una de dos: cero. Puntuacion parcial premiaria pensar a medias.
    const partial = startAttempt(quiz);
    partial.answer({ questionId: 'q-1', selectedOptionIds: ['o-1'], now: NOW });
    partial.submit(quiz, NOW);
    expect(partial.snapshot().score).toBe(0);

    // Marcarlo todo: cero tambien. Es la regla que sostiene la anterior, porque
    // sin ella marcar las tres opciones sacaria mas nota que pensar dos.
    const everything = startAttempt(quiz);
    everything.answer({ questionId: 'q-1', selectedOptionIds: ['o-1', 'o-2', 'o-3'], now: NOW });
    everything.submit(quiz, NOW);
    expect(everything.snapshot().score).toBe(0);
  });

  it('entregar dos veces no vuelve a corregir', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz);
    submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-2'], now: NOW });
    submission.submit(quiz, NOW);
    const first = submission.snapshot().submittedAt;

    submission.submit(quiz, new Date('2026-09-03T13:00:00Z'));

    expect(submission.snapshot().submittedAt).toEqual(first);
  });

  it('no admite respuestas despues de entregar', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz);
    submission.submit(quiz, NOW);

    expect(() =>
      submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-2'], now: NOW }),
    ).toThrowError(BusinessRuleError);
  });
});

describe('Submission: el limite de tiempo lo cuenta el servidor', () => {
  it('deja entregar dentro del minuto de gracia', () => {
    const quiz = publishedQuiz({ timeLimitMinutes: 10 });
    const submission = startAttempt(quiz);

    // 10 min y 30 s: el minuto de gracia cubre la latencia del envio final.
    // Perder un examen entero porque la peticion tardo dos segundos seria
    // absurdo.
    const justAfter = new Date(NOW.getTime() + 10.5 * 60_000);
    expect(() => submission.submit(quiz, justAfter)).not.toThrow();
  });

  it('rechaza una entrega claramente fuera de tiempo', () => {
    const quiz = publishedQuiz({ timeLimitMinutes: 10 });
    const submission = startAttempt(quiz);

    const wayAfter = new Date(NOW.getTime() + 30 * 60_000);
    expect(() => submission.submit(quiz, wayAfter)).toThrowError(/Se acabo el tiempo/);
  });
});

describe('Submission: correccion manual', () => {
  it('con parte abierta la nota queda parcial y sin veredicto', () => {
    const quiz = publishedQuiz({ withOpenQuestion: true });
    const submission = startAttempt(quiz, { classroomId: CLASSROOM });

    submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-2'], now: NOW });
    submission.answer({ questionId: 'q-2', text: 'Sigue una linea negra.', now: NOW });
    submission.submit(quiz, NOW);

    const state = submission.snapshot();
    expect(state.status).toBe(SUBMISSION_STATUS.SUBMITTED);
    expect(state.score).toBe(10);
    // `passed` en null a proposito: decirle que suspendio con la mitad de los
    // puntos sin puntuar seria mentirle.
    expect(state.passed).toBeNull();
  });

  it('no cierra la nota mientras quede algo sin puntuar', () => {
    const quiz = publishedQuiz({ withOpenQuestion: true });
    const submission = startAttempt(quiz);
    submission.answer({ questionId: 'q-2', text: 'Sigue una linea.', now: NOW });
    submission.submit(quiz, NOW);

    expect(() => submission.finaliseGrading(quiz, TEACHER, null, NOW)).toThrowError(
      /sin puntuar/,
    );
  });

  it('puntuar y cerrar publica la nota completa', () => {
    const quiz = publishedQuiz({ withOpenQuestion: true });
    const submission = startAttempt(quiz);
    submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-2'], now: NOW });
    submission.answer({ questionId: 'q-2', text: 'Sigue una linea negra.', now: NOW });
    submission.submit(quiz, NOW);

    submission.gradeQuestion({
      questionId: 'q-2',
      points: 8,
      feedback: 'Bien, faltaba mencionar el sensor.',
      question: quiz.forAuthor().find((q) => q.id === 'q-2')!,
    });
    submission.finaliseGrading(quiz, TEACHER, 'Buen trabajo.', NOW);

    const state = submission.snapshot();
    expect(state.status).toBe(SUBMISSION_STATUS.GRADED);
    expect(state.score).toBe(18);
    expect(state.passed).toBe(true);
    expect(state.gradedBy).toBe(TEACHER);
    expect(state.feedback).toBe('Buen trabajo.');
  });

  it('no deja poner mas puntos de los que vale la pregunta', () => {
    const quiz = publishedQuiz({ withOpenQuestion: true });
    const submission = startAttempt(quiz);
    submission.answer({ questionId: 'q-2', text: 'Algo.', now: NOW });
    submission.submit(quiz, NOW);

    expect(() =>
      submission.gradeQuestion({
        questionId: 'q-2',
        points: 50,
        question: quiz.forAuthor().find((q) => q.id === 'q-2')!,
      }),
    ).toThrowError(/como maximo 10 puntos/);
  });

  it('no se corrige un intento que todavia no se entrego', () => {
    const quiz = publishedQuiz({ withOpenQuestion: true });
    const submission = startAttempt(quiz);

    expect(() =>
      submission.gradeQuestion({
        questionId: 'q-2',
        points: 5,
        question: quiz.forAuthor().find((q) => q.id === 'q-2')!,
      }),
    ).toThrowError(/todavia no se ha entregado/);
  });

  it('el evento de nota corregida lleva lo que la analitica necesita', () => {
    const quiz = publishedQuiz();
    const submission = startAttempt(quiz, { classroomId: CLASSROOM });
    submission.answer({ questionId: 'q-1', selectedOptionIds: ['o-1'], now: NOW });
    submission.submit(quiz, NOW);

    const [event] = submission.pullDomainEvents();
    const payload = event!.payload as Record<string, unknown>;

    // Sin estos campos la analitica tendria que llamar de vuelta a evaluacion
    // por cada entrega, y una proyeccion asincrona se convertiria en una
    // dependencia sincrona entre servicios.
    expect(payload.kitId).toBe(KIT);
    expect(payload.origin).toBe(ASSESSMENT_ORIGIN.GLEXCO);
    expect(payload.institutionId).toBe(INSTITUTION);
    expect(payload.classroomId).toBe(CLASSROOM);
    expect(payload.questionOutcomes).toEqual([{ questionId: 'q-1', missed: true }]);
  });
});
