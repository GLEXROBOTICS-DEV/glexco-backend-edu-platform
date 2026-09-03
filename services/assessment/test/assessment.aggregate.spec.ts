import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ForbiddenError } from '@glexco/kernel';
import { ASSESSMENT_TYPES, QUESTION_TYPES } from '@glexco/contracts';
import {
  ASSESSMENT_ORIGIN,
  Assessment,
  AssessmentId,
  type Question,
} from '../src/domain/assessment.aggregate';

const NOW = new Date('2026-09-03T12:00:00Z');
const KIT = '11111111-1111-4111-8111-111111111111';
const INSTITUTION_A = '22222222-2222-4222-8222-222222222222';
const INSTITUTION_B = '33333333-3333-4333-8333-333333333333';
const AUTHOR = '44444444-4444-4444-8444-444444444444';

const GLEXCO_STAFF = { userId: AUTHOR, institutionId: null, isPlatformStaff: true };
const TEACHER_A = { userId: 'teacher-a', institutionId: INSTITUTION_A, isPlatformStaff: false };
const TEACHER_B = { userId: 'teacher-b', institutionId: INSTITUTION_B, isPlatformStaff: false };

function glexcoAssessment(): Assessment {
  return Assessment.create({
    id: AssessmentId.create(),
    kitId: KIT,
    origin: ASSESSMENT_ORIGIN.GLEXCO,
    institutionId: null,
    authorId: AUTHOR,
    kind: ASSESSMENT_TYPES.QUIZ,
    title: 'Piezas del uKit',
    now: NOW,
  });
}

function choiceQuestion(overrides: Partial<Question> = {}): Question & { id: string } {
  return {
    id: 'q-1',
    type: QUESTION_TYPES.SINGLE_CHOICE,
    prompt: 'Cual de estas piezas es un servomotor?',
    options: [
      { id: 'o-1', text: 'El bloque' },
      { id: 'o-2', text: 'El servo' },
    ],
    correctOptionIds: ['o-2'],
    points: 10,
    explanation: 'El servo lleva tres cables.',
    ...overrides,
  } as Question & { id: string };
}

describe('Assessment: la clave de correccion', () => {
  it('no sale hacia el alumno por ningun campo', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);

    const [question] = assessment.forStudent();

    // La comprobacion se hace sobre las CLAVES del objeto y no solo sobre los
    // dos campos que hoy existen: si alguien anade manana un campo con la
    // respuesta -un `answerHint`, un `solution`- esta prueba lo caza igual.
    expect(Object.keys(question!).sort()).toEqual(
      ['id', 'options', 'points', 'prompt', 'type'].sort(),
    );
    // El id de la opcion SI viaja -sin el no se puede responder-; lo que no
    // viaja es cual de ellas es la correcta, ni la explicacion, que se muestra
    // despues de corregir.
    const serialized = JSON.stringify(assessment.forStudent());
    expect(serialized).not.toContain('correctOptionIds');
    expect(serialized).not.toContain('tres cables');
  });

  it('si llega completa a quien corrige', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);

    const [question] = assessment.forAuthor();

    expect(question?.correctOptionIds).toEqual(['o-2']);
    expect(question?.explanation).toBe('El servo lleva tres cables.');
  });

  it('devuelve copias: mutar lo que sale no toca el agregado', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);

    const copy = assessment.forAuthor();
    copy[0]!.points = 999;

    expect(assessment.totalPoints).toBe(10);
  });
});

describe('Assessment: un docente no modifica el banco de GLEXCO', () => {
  it('rechaza la edicion con un mensaje que dice que se puede duplicar', () => {
    const assessment = glexcoAssessment();

    expect(() => assessment.assertEditableBy(TEACHER_A)).toThrowError(ForbiddenError);
    try {
      assessment.assertEditableBy(TEACHER_A);
    } catch (error) {
      expect((error as ForbiddenError).code).toBe('ASSESSMENT_IS_GLEXCO_CONTENT');
      expect((error as ForbiddenError).message).toContain('Duplicala');
    }
  });

  it('el equipo de GLEXCO si la edita', () => {
    expect(() => glexcoAssessment().assertEditableBy(GLEXCO_STAFF)).not.toThrow();
  });

  it('una evaluacion de institucion solo la edita su institucion', () => {
    const own = Assessment.create({
      id: AssessmentId.create(),
      kitId: KIT,
      origin: ASSESSMENT_ORIGIN.INSTITUTION,
      institutionId: INSTITUTION_A,
      authorId: TEACHER_A.userId,
      kind: ASSESSMENT_TYPES.PROJECT,
      title: 'Reto del salon',
      now: NOW,
    });

    expect(() => own.assertEditableBy(TEACHER_A)).not.toThrow();
    expect(() => own.assertEditableBy(TEACHER_B)).toThrowError(ForbiddenError);

    // Ni el personal de GLEXCO: puede verla para dar soporte, pero cambiarle el
    // examen a un docente sin que se entere es peor que no poder ayudarle.
    expect(() => own.assertEditableBy(GLEXCO_STAFF)).toThrowError(ForbiddenError);
  });

  it('no se puede crear una de institucion sin institucion, ni una de GLEXCO con ella', () => {
    expect(() =>
      Assessment.create({
        id: AssessmentId.create(),
        kitId: KIT,
        origin: ASSESSMENT_ORIGIN.INSTITUTION,
        institutionId: null,
        authorId: AUTHOR,
        kind: ASSESSMENT_TYPES.QUIZ,
        title: 'Sin dueno',
        now: NOW,
      }),
    ).toThrowError(BusinessRuleError);

    expect(() =>
      Assessment.create({
        id: AssessmentId.create(),
        kitId: KIT,
        origin: ASSESSMENT_ORIGIN.GLEXCO,
        institutionId: INSTITUTION_A,
        authorId: AUTHOR,
        kind: ASSESSMENT_TYPES.QUIZ,
        title: 'Comun pero de uno',
        now: NOW,
      }),
    ).toThrowError(BusinessRuleError);
  });
});

describe('Assessment: validacion de preguntas al capturarlas', () => {
  it('exige marcar la respuesta correcta en una pregunta de marcar', () => {
    const assessment = glexcoAssessment();

    // Es el error de captura mas comun, y sin esta regla solo se descubre
    // cuando la clase entera ha sacado cero.
    expect(() =>
      assessment.addQuestion(choiceQuestion({ correctOptionIds: [] }), NOW),
    ).toThrowError(/Marca cual es la respuesta correcta/);
  });

  it('rechaza una respuesta correcta que no esta entre las opciones', () => {
    const assessment = glexcoAssessment();

    expect(() =>
      assessment.addQuestion(choiceQuestion({ correctOptionIds: ['o-9'] }), NOW),
    ).toThrowError(/no esta entre las opciones/);
  });

  it('rechaza dos respuestas correctas en una pregunta de una sola', () => {
    const assessment = glexcoAssessment();

    expect(() =>
      assessment.addQuestion(choiceQuestion({ correctOptionIds: ['o-1', 'o-2'] }), NOW),
    ).toThrowError(/una sola respuesta correcta/);
  });

  it('no exige opciones ni clave en una pregunta abierta', () => {
    const assessment = glexcoAssessment();

    expect(() =>
      assessment.addQuestion(
        {
          id: 'q-open',
          type: QUESTION_TYPES.SHORT_ANSWER,
          prompt: 'Explica que hace tu robot.',
          options: [],
          correctOptionIds: [],
          points: 20,
          explanation: null,
        },
        NOW,
      ),
    ).not.toThrow();
  });

  it('rechaza una pregunta que no vale puntos', () => {
    const assessment = glexcoAssessment();

    expect(() => assessment.addQuestion(choiceQuestion({ points: 0 }), NOW)).toThrowError(
      /mas de cero puntos/,
    );
  });
});

describe('Assessment: publicacion y congelado', () => {
  it('no publica una evaluacion sin preguntas', () => {
    expect(() => glexcoAssessment().publish(NOW)).toThrowError(/sin preguntas/);
  });

  it('publicar dos veces no emite dos eventos ni marca cambios', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);
    assessment.publish(NOW);
    assessment.pullDomainEvents();

    const republished = Assessment.rehydrate(assessment.id, assessment.snapshot(), 5);
    republished.publish(NOW);

    // Sin esta salida temprana, una operacion idempotente no avanza la version,
    // el UPDATE ... WHERE version < :nueva no encuentra fila y se lanza un
    // conflicto de concurrencia inventado.
    expect(republished.pullDomainEvents()).toHaveLength(0);
    expect(republished.hasChanges).toBe(false);
  });

  it('con entregas hechas ya no se cambian las preguntas', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);
    assessment.publish(NOW);
    assessment.registerSubmission(NOW);

    expect(() => assessment.addQuestion(choiceQuestion({ id: 'q-2' }), NOW)).toThrowError(
      /invalidaria sus notas/,
    );
    expect(() => assessment.removeQuestion('q-1', NOW)).toThrowError(/invalidaria sus notas/);
  });

  it('pero si se corrige el enunciado o se mueve la fecha de entrega', () => {
    const assessment = glexcoAssessment();
    assessment.addQuestion(choiceQuestion(), NOW);
    assessment.publish(NOW);
    assessment.registerSubmission(NOW);

    const later = new Date('2026-10-01T12:00:00Z');
    expect(() =>
      assessment.updateDetails({ title: 'Piezas del uKit (revisado)', dueAt: later }, NOW),
    ).not.toThrow();

    expect(assessment.title).toBe('Piezas del uKit (revisado)');
    expect(assessment.dueAt).toEqual(later);
  });
});

describe('Assessment: intentos por defecto', () => {
  it('un cuestionario admite reintentos y un entregable no', () => {
    expect(glexcoAssessment().maxAttempts).toBe(3);

    const project = Assessment.create({
      id: AssessmentId.create(),
      kitId: KIT,
      origin: ASSESSMENT_ORIGIN.GLEXCO,
      institutionId: null,
      authorId: AUTHOR,
      kind: ASSESSMENT_TYPES.PROJECT,
      title: 'Construye tu robot',
      now: NOW,
    });

    // Un cuestionario es para aprender -reintentar es parte de eso- y un
    // entregable se entrega una vez.
    expect(project.maxAttempts).toBe(1);
  });
});
