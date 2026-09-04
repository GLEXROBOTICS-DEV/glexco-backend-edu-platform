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
 * Preguntas de ORDENAR.
 *
 * Es el primer tipo con puntuacion PARCIAL, y por eso tiene su propio archivo:
 * las reglas de las de marcar -todo o nada- no valen aqui, y mezclarlas en el
 * mismo `describe` invita a copiar la afirmacion equivocada.
 */

const NOW = new Date('2026-09-03T12:00:00Z');
const KIT = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '44444444-4444-4444-8444-444444444444';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const INSTITUTION = '77777777-7777-4777-8777-777777777777';

/** Cuatro pasos de montaje, en el orden correcto. */
const PASOS = ['p-1', 'p-2', 'p-3', 'p-4'];

function quizDeOrdenar(points = 12): Assessment {
  const assessment = Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.GLEXCO,
    institutionId: null,
    authorId: AUTHOR,
    kind: ASSESSMENT_TYPES.QUIZ,
    title: 'Monta el brazo',
    passingScore: 60,
    now: NOW,
  });

  assessment.addQuestion(
    {
      id: 'q-1',
      type: QUESTION_TYPES.ORDERING,
      prompt: 'Ordena los pasos del montaje.',
      options: [
        { id: 'p-1', text: 'Fijar la base' },
        { id: 'p-2', text: 'Montar el servo' },
        { id: 'p-3', text: 'Conectar el cable' },
        { id: 'p-4', text: 'Encender' },
      ],
      // La clave ES el orden del array. No hace falta ninguna estructura nueva.
      correctOptionIds: PASOS,
      points,
      explanation: null,
    },
    NOW,
  );

  assessment.publish(NOW);
  return assessment;
}

function responder(assessment: Assessment, orden: string[]): Submission {
  const submission = Submission.start({
    id: SubmissionId.create(),
    assessment,
    studentId: STUDENT,
    institutionId: INSTITUTION,
    classroomId: null,
    attemptNumber: 1,
    now: NOW,
  });

  submission.answer({ questionId: 'q-1', selectedOptionIds: orden, now: NOW });
  submission.submit(assessment, NOW);
  return submission;
}

describe('Ordenar: la maquina la corrige sola', () => {
  it('esta en la lista de autocorregibles', () => {
    expect(isAutoGradable(QUESTION_TYPES.ORDERING)).toBe(true);
  });

  it('matching NO lo esta: su correccion no existe todavia', () => {
    // Meterlo en la lista lo puntuaria a cero en silencio, que es peor que
    // mandarlo a la bandeja del docente.
    expect(isAutoGradable(QUESTION_TYPES.MATCHING)).toBe(false);
  });

  it('no deja la entrega pendiente de correccion manual', () => {
    const submission = responder(quizDeOrdenar(), PASOS);

    // Si `ordering` no fuera autocorregible, la entrega se quedaria en
    // `submitted` esperando a un docente que no tiene nada que corregir.
    expect(submission.snapshot().status).toBe(SUBMISSION_STATUS.GRADED);
  });
});

describe('Ordenar: la nota es parcial, por piezas en su sitio', () => {
  it('el orden exacto vale todos los puntos', () => {
    const submission = responder(quizDeOrdenar(12), PASOS);
    expect(submission.snapshot().score).toBe(12);
  });

  it('dos piezas intercambiadas conservan las otras dos', () => {
    // p-1 y p-4 en su sitio; p-2 y p-3 cambiadas -> 2 de 4.
    const submission = responder(quizDeOrdenar(12), ['p-1', 'p-3', 'p-2', 'p-4']);
    expect(submission.snapshot().score).toBe(6);
  });

  it('el orden invertido de una secuencia par no acierta ninguna', () => {
    const submission = responder(quizDeOrdenar(12), ['p-4', 'p-3', 'p-2', 'p-1']);
    expect(submission.snapshot().score).toBe(0);
  });

  it('redondea HACIA ABAJO: no se regalan puntos', () => {
    // 10 puntos y UNA pieza de cuatro en su sitio = 2,5 -> 2.
    //
    // Con cuatro piezas no se puede acertar exactamente tres: si tres estan en
    // su sitio, la cuarta no tiene donde ir mas que al suyo. Es la clase de
    // afirmacion imposible que una prueba escrita a ojo deja pasar y que aqui
    // fallo antes de llegar a nadie.
    const submission = responder(quizDeOrdenar(10), ['p-1', 'p-3', 'p-4', 'p-2']);
    expect(submission.snapshot().score).toBe(2);
  });

  it('una secuencia incompleta vale cero, no un acierto por azar', () => {
    // Con dos de cuatro, comparar por posicion premiaria haber dejado el resto
    // sin poner: se exige la secuencia entera.
    const submission = responder(quizDeOrdenar(12), ['p-1', 'p-2']);
    expect(submission.snapshot().score).toBe(0);
  });

  it('no responder nada vale cero y queda constancia', () => {
    const assessment = quizDeOrdenar(12);
    const submission = Submission.start({
      id: SubmissionId.create(),
      assessment,
      studentId: STUDENT,
      institutionId: INSTITUTION,
      classroomId: null,
      attemptNumber: 1,
      now: NOW,
    });

    submission.submit(assessment, NOW);

    const snapshot = submission.snapshot();
    expect(snapshot.score).toBe(0);
    // La respuesta vacia se guarda para que el alumno vea que no la contesto,
    // en vez de creer que la fallo.
    expect(snapshot.answers).toHaveLength(1);
  });

  it('repetir una pieza no puede sumar mas que ponerla una vez', () => {
    // Cuatro huecos, la misma pieza dos veces: acierta la posicion 1 y nada mas.
    const submission = responder(quizDeOrdenar(12), ['p-1', 'p-1', 'p-3', 'p-2']);
    expect(submission.snapshot().score).toBe(6);
  });
});

describe('Ordenar: la clave no sale hacia el alumno', () => {
  it('forStudent no lleva el orden correcto', () => {
    const assessment = quizDeOrdenar();
    const [question] = assessment.forStudent();

    // Es LA garantia del cuestionario: con `correctOptionIds` en el HTML, basta
    // abrir la pestana de red para tener el orden hecho.
    expect(question).toBeDefined();
    expect(JSON.stringify(question)).not.toContain('correctOptionIds');
  });

  it('las opciones si viajan: sin ellas no hay nada que ordenar', () => {
    const [question] = quizDeOrdenar().forStudent();
    expect(question!.options).toHaveLength(4);
  });
});
