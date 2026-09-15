import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@glexco/kernel';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
  type GroupWork,
} from '../src/domain/assessment.aggregate';
import { Submission, SubmissionId } from '../src/domain/submission.aggregate';

const NOW = new Date('2026-09-15T12:00:00Z');
const KIT = '11111111-1111-4111-8111-111111111111';
const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const TEACHER = '44444444-4444-4444-8444-444444444444';

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRUNO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARLA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DIEGO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function actividad(groupWork: GroupWork | null): Assessment {
  const assessment = Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.INSTITUTION,
    institutionId: INSTITUTION,
    authorId: TEACHER,
    kind: ASSESSMENT_TYPES.PRACTICAL,
    title: 'Montar el brazo robotico',
    groupWork,
    now: NOW,
  });

  assessment.addQuestion(
    {
      id: 'q-1',
      type: QUESTION_TYPES.OPEN_TEXT,
      prompt: 'Explica como repartisteis el montaje.',
      options: [],
      correctOptionIds: [],
      points: 20,
    },
    NOW,
  );
  assessment.publish(NOW);

  return assessment;
}

function empezar(assessment: Assessment, studentId: string, groupmateIds?: string[]): Submission {
  return Submission.start({
    id: SubmissionId.create(),
    assessment,
    studentId,
    institutionId: INSTITUTION,
    classroomId: null,
    attemptNumber: 1,
    groupmateIds,
    now: NOW,
  });
}

describe('Actividades en grupo: como se declara el tamano', () => {
  it('un grupo de uno no es un grupo: para eso esta no marcarla como grupal', () => {
    expect(() => actividad({ minSize: 1, maxSize: 4 })).toThrow(BusinessRuleError);
  });

  it('rechaza un maximo por debajo del minimo, que no lo cumpliria ningun grupo', () => {
    expect(() => actividad({ minSize: 4, maxSize: 2 })).toThrow(BusinessRuleError);
  });

  it('rechaza un tamano sin tope: una peticion podria declarar mil integrantes', () => {
    expect(() => actividad({ minSize: 2, maxSize: 99 })).toThrow(BusinessRuleError);
  });

  it('rechaza medios alumnos', () => {
    expect(() => actividad({ minSize: 2, maxSize: 3.5 })).toThrow(BusinessRuleError);
  });

  it('acepta un rango razonable y lo conserva', () => {
    expect(actividad({ minSize: 2, maxSize: 4 }).groupWork).toEqual({ minSize: 2, maxSize: 4 });
  });

  it('una actividad sin grupo declarado es individual', () => {
    expect(actividad(null).groupWork).toBeNull();
  });
});

describe('Actividades en grupo: formar el grupo al empezar', () => {
  it('guarda a TODOS los integrantes, incluido quien lo forma', () => {
    const submission = empezar(actividad({ minSize: 2, maxSize: 4 }), ANA, [BRUNO, CARLA]);

    expect(submission.snapshot().memberIds).toEqual([ANA, BRUNO, CARLA]);
  });

  it('rechaza un grupo por debajo del minimo', () => {
    expect(() => empezar(actividad({ minSize: 3, maxSize: 4 }), ANA, [BRUNO])).toThrow(
      BusinessRuleError,
    );
  });

  it('rechaza un grupo por encima del maximo', () => {
    expect(() =>
      empezar(actividad({ minSize: 2, maxSize: 3 }), ANA, [BRUNO, CARLA, DIEGO]),
    ).toThrow(BusinessRuleError);
  });

  it('rechaza empezar una actividad grupal sin elegir a nadie', () => {
    // Sin esto, una peticion sin companeros se colaria como entrega individual
    // y el alumno haria solo un trabajo que se califica como de grupo.
    expect(() => empezar(actividad({ minSize: 2, maxSize: 4 }), ANA)).toThrow(BusinessRuleError);
  });

  it('rechaza un companero repetido, que inflaria el grupo sin sumar a nadie', () => {
    expect(() => empezar(actividad({ minSize: 2, maxSize: 4 }), ANA, [BRUNO, BRUNO])).toThrow(
      BusinessRuleError,
    );
  });

  it('no cuenta dos veces a quien se elige a si mismo', () => {
    // El selector no deberia ofrecerlo, pero la peticion se puede escribir a
    // mano: contarlo dos veces dejaria un grupo de dos que en realidad es de uno.
    const submission = empezar(actividad({ minSize: 2, maxSize: 4 }), ANA, [ANA, BRUNO]);

    expect(submission.snapshot().memberIds).toEqual([ANA, BRUNO]);
  });

  it('rechaza companeros en una actividad individual', () => {
    expect(() => empezar(actividad(null), ANA, [BRUNO])).toThrow(BusinessRuleError);
  });

  it('una entrega individual no guarda integrantes', () => {
    expect(empezar(actividad(null), ANA).snapshot().memberIds).toEqual([]);
  });
});

describe('Actividades en grupo: el tamano no se cambia con entregas hechas', () => {
  it('rechaza pasar a individual cuando ya hay grupos formados', () => {
    const assessment = actividad({ minSize: 2, maxSize: 4 });
    assessment.registerSubmission(NOW);

    expect(() => assessment.updateDetails({ groupWork: null }, NOW)).toThrow(BusinessRuleError);
  });

  it('rechaza estrechar el rango cuando ya hay grupos formados', () => {
    const assessment = actividad({ minSize: 2, maxSize: 4 });
    assessment.registerSubmission(NOW);

    expect(() => assessment.updateDetails({ groupWork: { minSize: 2, maxSize: 3 } }, NOW)).toThrow(
      BusinessRuleError,
    );
  });

  it('sin entregas si se puede cambiar', () => {
    const assessment = actividad({ minSize: 2, maxSize: 4 });
    assessment.updateDetails({ groupWork: { minSize: 3, maxSize: 5 } }, NOW);

    expect(assessment.groupWork).toEqual({ minSize: 3, maxSize: 5 });
  });
});

describe('Actividades en grupo: la nota llega a todo el grupo', () => {
  it('emite una correccion por cada integrante, no solo para quien entrego', () => {
    const assessment = actividad({ minSize: 2, maxSize: 4 });
    const submission = empezar(assessment, ANA, [BRUNO, CARLA]);

    submission.answer({ questionId: 'q-1', text: 'Ana monto, Bruno cableo.', now: NOW });
    submission.submit(assessment, NOW);
    submission.gradeQuestion({
      questionId: 'q-1',
      points: 18,
      question: assessment.findQuestion('q-1')!,
    });
    submission.finaliseGrading(assessment, TEACHER, null, NOW);

    const correcciones = submission
      .pullDomainEvents()
      .filter((event) => event.metadata.eventName === 'assessment.submission.graded.v1');

    expect(correcciones.map((event) => (event.payload as { studentId: string }).studentId)).toEqual(
      [ANA, BRUNO, CARLA],
    );
  });

  it('los fallos por pregunta van SOLO en el evento de quien entrego', () => {
    // Repetirlos por integrante multiplicaria la muestra de "lo que mas falla
    // tu salon", que es el dato con el que el docente decide que repasar.
    const assessment = actividad({ minSize: 2, maxSize: 4 });
    const submission = empezar(assessment, ANA, [BRUNO, CARLA]);

    submission.answer({ questionId: 'q-1', text: 'Algo.', now: NOW });
    submission.submit(assessment, NOW);
    submission.gradeQuestion({
      questionId: 'q-1',
      points: 5,
      question: assessment.findQuestion('q-1')!,
    });
    submission.finaliseGrading(assessment, TEACHER, null, NOW);

    const correcciones = submission
      .pullDomainEvents()
      .filter((event) => event.metadata.eventName === 'assessment.submission.graded.v1')
      .map((event) => event.payload as { studentId: string; questionOutcomes: unknown[] });

    expect(correcciones.find((p) => p.studentId === ANA)!.questionOutcomes).toHaveLength(1);
    expect(correcciones.find((p) => p.studentId === BRUNO)!.questionOutcomes).toEqual([]);
    expect(correcciones.find((p) => p.studentId === CARLA)!.questionOutcomes).toEqual([]);
  });

  it('una entrega individual sigue emitiendo una sola correccion', () => {
    const assessment = actividad(null);
    const submission = empezar(assessment, ANA);

    submission.answer({ questionId: 'q-1', text: 'Lo hice solo.', now: NOW });
    submission.submit(assessment, NOW);
    submission.gradeQuestion({
      questionId: 'q-1',
      points: 20,
      question: assessment.findQuestion('q-1')!,
    });
    submission.finaliseGrading(assessment, TEACHER, null, NOW);

    const correcciones = submission
      .pullDomainEvents()
      .filter((event) => event.metadata.eventName === 'assessment.submission.graded.v1');

    expect(correcciones).toHaveLength(1);
  });
});
