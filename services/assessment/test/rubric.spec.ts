import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@glexco/kernel';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
} from '../src/domain/assessment.aggregate';
import { Submission, SubmissionId } from '../src/domain/submission.aggregate';
import {
  assertRubricIsUsable,
  explainRubric,
  rubricMaxPoints,
  scoreRubric,
  type Rubric,
} from '../src/domain/rubric';

/**
 * Rubricas de correccion.
 *
 * La prueba que importa de este archivo es la ultima del tercer bloque: **un
 * total manipulado no otorga ni un punto**. Todo el valor de una rubrica se
 * apoya en que los puntos los calcula el dominio a partir de los niveles, y no
 * la pantalla; si eso se rompiera, la rubrica seria decoracion.
 */

const KIT = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '44444444-4444-4444-8444-444444444444';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const INSTITUTION = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-09-04T12:00:00Z');

/** Montaje sobre 12, cableado sobre 6, explicacion sobre 2. Total: 20. */
function rubrica(): Rubric {
  return {
    criteria: [
      {
        id: 'montaje',
        label: 'Montaje',
        levels: [
          { label: 'Completo y firme', points: 12, description: 'Todas las piezas y sin holgura.' },
          { label: 'Completo con holguras', points: 7 },
          { label: 'Incompleto', points: 0 },
        ],
      },
      {
        id: 'cableado',
        label: 'Cableado',
        levels: [
          { label: 'Ordenado', points: 6 },
          { label: 'Funciona pero suelto', points: 3 },
          { label: 'Mal conectado', points: 0 },
        ],
      },
      {
        id: 'explicacion',
        label: 'Explicacion',
        levels: [
          { label: 'Clara', points: 2 },
          { label: 'No la escribio', points: 0 },
        ],
      },
    ],
  };
}

function retoConRubrica(points = 20): Assessment {
  const assessment = Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.GLEXCO,
    institutionId: null,
    authorId: AUTHOR,
    kind: ASSESSMENT_TYPES.PRACTICAL,
    title: 'Monta el brazo',
    passingScore: 60,
    now: NOW,
  });

  assessment.addQuestion(
    {
      id: 'q-1',
      type: QUESTION_TYPES.FILE_UPLOAD,
      prompt: 'Sube una foto de tu montaje.',
      options: [],
      correctOptionIds: [],
      points,
      explanation: null,
      rubric: rubrica(),
    },
    NOW,
  );

  assessment.publish(NOW);
  return assessment;
}

function entregaAbierta(assessment: Assessment): Submission {
  const submission = Submission.start({
    id: SubmissionId.create(),
    assessment,
    studentId: STUDENT,
    institutionId: INSTITUTION,
    classroomId: null,
    attemptNumber: 1,
    now: NOW,
  });

  submission.answer({ questionId: 'q-1', text: 'Aqui esta mi robot.', now: NOW });
  submission.submit(assessment, NOW);
  return submission;
}

describe('Rubrica: cuenta lo elegido', () => {
  it('suma los niveles que el docente eligio', () => {
    const puntos = scoreRubric(rubrica(), [
      { criterionId: 'montaje', levelIndex: 0 },
      { criterionId: 'cableado', levelIndex: 1 },
      { criterionId: 'explicacion', levelIndex: 0 },
    ]);

    expect(puntos).toBe(12 + 3 + 2);
  });

  it('un criterio SIN elegir vale cero, no se ignora', () => {
    // Ignorarlo haria que corregir media rubrica diera la misma nota que
    // corregirla entera bien, y el docente no veria la diferencia.
    const puntos = scoreRubric(rubrica(), [{ criterionId: 'montaje', levelIndex: 0 }]);
    expect(puntos).toBe(12);
  });

  it('un nivel fuera de rango no suma nada inventado', () => {
    // Llega de un formulario manipulado o de una rubrica que cambio a mitad de
    // correccion: sumar cero es lo unico defendible.
    const puntos = scoreRubric(rubrica(), [{ criterionId: 'montaje', levelIndex: 99 }]);
    expect(puntos).toBe(0);
  });

  it('un criterio que no existe se descarta', () => {
    const puntos = scoreRubric(rubrica(), [{ criterionId: 'inventado', levelIndex: 0 }]);
    expect(puntos).toBe(0);
  });

  it('el maximo es la suma de los mejores niveles', () => {
    expect(rubricMaxPoints(rubrica())).toBe(20);
  });
});

describe('Rubrica: se comprueba al capturarla', () => {
  it('exige que su maximo COINCIDA con los puntos de la pregunta', () => {
    // Si diera menos, la pregunta seria imposible de sacar entera y nadie sabria
    // por que. Si diera mas, el dominio rechazaria la correccion al pasarse y el
    // docente se quedaria sin poder cerrar la nota despues de puntuar todo.
    expect(() => assertRubricIsUsable(rubrica(), 20)).not.toThrow();
    expect(() => assertRubricIsUsable(rubrica(), 25)).toThrow(/coincidir/i);
    expect(() => assertRubricIsUsable(rubrica(), 15)).toThrow(/coincidir/i);
  });

  it('rechaza una rubrica sin criterios', () => {
    expect(() => assertRubricIsUsable({ criteria: [] }, 20)).toThrow(BusinessRuleError);
  });

  it('rechaza un criterio con un solo nivel', () => {
    // Con un solo nivel no hay nada que elegir: es un numero fijo disfrazado.
    expect(() =>
      assertRubricIsUsable(
        { criteria: [{ id: 'a', label: 'A', levels: [{ label: 'Bien', points: 20 }] }] },
        20,
      ),
    ).toThrow(/niveles/i);
  });

  it('rechaza dos criterios con el mismo identificador', () => {
    const repetido: Rubric = {
      criteria: [
        { id: 'a', label: 'Uno', levels: [{ label: 'Si', points: 10 }, { label: 'No', points: 0 }] },
        { id: 'a', label: 'Otro', levels: [{ label: 'Si', points: 10 }, { label: 'No', points: 0 }] },
      ],
    };
    expect(() => assertRubricIsUsable(repetido, 20)).toThrow(/identificador/i);
  });

  it('rechaza un nivel que quita puntos', () => {
    expect(() =>
      assertRubricIsUsable(
        {
          criteria: [
            { id: 'a', label: 'A', levels: [{ label: 'Bien', points: 20 }, { label: 'Mal', points: -5 }] },
          ],
        },
        20,
      ),
    ).toThrow(/quitar puntos/i);
  });

  it('la evaluacion la rechaza al anadir la pregunta, no despues', () => {
    const assessment = Assessment.create({
      id: AssessmentId.create(),
      kitId: KIT,
      origin: ASSESSMENT_ORIGIN.GLEXCO,
      institutionId: null,
      authorId: AUTHOR,
      kind: ASSESSMENT_TYPES.PRACTICAL,
      title: 'Mal capturada',
      passingScore: 60,
      now: NOW,
    });

    expect(() =>
      assessment.addQuestion(
        {
          id: 'q-1',
          type: QUESTION_TYPES.FILE_UPLOAD,
          prompt: 'Sube tu montaje.',
          options: [],
          correctOptionIds: [],
          // La rubrica suma 20 y la pregunta dice 30.
          points: 30,
          explanation: null,
          rubric: rubrica(),
        },
        NOW,
      ),
    ).toThrow(/coincidir/i);
  });
});

describe('Corregir con rubrica: los puntos los calcula el DOMINIO', () => {
  it('la nota sale de los niveles elegidos', () => {
    const assessment = retoConRubrica();
    const submission = entregaAbierta(assessment);
    const question = assessment.findQuestion('q-1')!;

    submission.gradeQuestion({
      questionId: 'q-1',
      points: 0,
      question,
      rubric: [
        { criterionId: 'montaje', levelIndex: 1 },
        { criterionId: 'cableado', levelIndex: 0 },
        { criterionId: 'explicacion', levelIndex: 1 },
      ],
    });

    const answer = submission.snapshot().answers.find((a) => a.questionId === 'q-1');
    expect(answer?.awardedPoints).toBe(7 + 6 + 0);
  });

  it('y guarda el DESGLOSE, no solo el total', () => {
    // Es lo unico que convierte una nota en algo que el alumno puede arreglar.
    const assessment = retoConRubrica();
    const submission = entregaAbierta(assessment);

    submission.gradeQuestion({
      questionId: 'q-1',
      points: 0,
      question: assessment.findQuestion('q-1')!,
      rubric: [{ criterionId: 'montaje', levelIndex: 0 }],
    });

    const answer = submission.snapshot().answers.find((a) => a.questionId === 'q-1');
    expect(answer?.rubricSelections).toEqual([{ criterionId: 'montaje', levelIndex: 0 }]);
  });

  it('UN TOTAL MANIPULADO NO OTORGA NADA', () => {
    // La prueba que sostiene la rubrica entera. Con `points` mandando, un
    // formulario tocado otorgaria mas de lo que la rubrica permite y la
    // comprobacion de "no mas del maximo" no lo notaria mientras cupiera.
    const assessment = retoConRubrica();
    const submission = entregaAbierta(assessment);

    submission.gradeQuestion({
      questionId: 'q-1',
      points: 20,
      question: assessment.findQuestion('q-1')!,
      // Lo peor de cada criterio.
      rubric: [
        { criterionId: 'montaje', levelIndex: 2 },
        { criterionId: 'cableado', levelIndex: 2 },
        { criterionId: 'explicacion', levelIndex: 1 },
      ],
    });

    const answer = submission.snapshot().answers.find((a) => a.questionId === 'q-1');
    expect(answer?.awardedPoints).toBe(0);
  });

  it('sin rubrica sigue valiendo el numero libre', () => {
    // Las preguntas abiertas de siempre no cambian: una rubrica es opcional.
    const assessment = Assessment.create({
      id: AssessmentId.create(),
      kitId: KIT,
      origin: ASSESSMENT_ORIGIN.GLEXCO,
      institutionId: null,
      authorId: AUTHOR,
      kind: ASSESSMENT_TYPES.PROJECT,
      title: 'Explica tu robot',
      passingScore: 60,
      now: NOW,
    });

    assessment.addQuestion(
      {
        id: 'q-1',
        type: QUESTION_TYPES.SHORT_ANSWER,
        prompt: 'Explica que hace.',
        options: [],
        correctOptionIds: [],
        points: 20,
        explanation: null,
      },
      NOW,
    );
    assessment.publish(NOW);

    const submission = entregaAbierta(assessment);
    submission.gradeQuestion({
      questionId: 'q-1',
      points: 14,
      question: assessment.findQuestion('q-1')!,
    });

    const answer = submission.snapshot().answers.find((a) => a.questionId === 'q-1');
    expect(answer?.awardedPoints).toBe(14);
  });
});

describe('El desglose que ve el alumno', () => {
  it('dice el criterio, el nivel y por que', () => {
    const explicacion = explainRubric(rubrica(), [
      { criterionId: 'montaje', levelIndex: 0 },
      { criterionId: 'cableado', levelIndex: 2 },
    ]);

    expect(explicacion[0]).toEqual({
      criterion: 'Montaje',
      level: 'Completo y firme',
      points: 12,
      description: 'Todas las piezas y sin holgura.',
    });
    expect(explicacion[1]?.points).toBe(0);
  });

  it('un criterio sin puntuar se dice, no se esconde', () => {
    const explicacion = explainRubric(rubrica(), []);
    expect(explicacion).toHaveLength(3);
    // `null` y no un texto: el texto visible lo pone la pantalla con su clave de
    // traduccion. Un "Sin puntuar" devuelto por el backend saldria en espanol
    // en el portal en ingles.
    expect(explicacion[2]?.level).toBeNull();
    expect(explicacion[2]?.points).toBe(0);
  });

  it('NO lleva los otros niveles que no se eligieron', () => {
    // Saber que existia un "excelente" que no alcanzo no le dice nada mas que ya
    // sabe, y llena la pantalla de opciones que no eligio nadie.
    const explicacion = explainRubric(rubrica(), [{ criterionId: 'montaje', levelIndex: 1 }]);
    expect(JSON.stringify(explicacion)).not.toContain('Completo y firme');
  });
});
