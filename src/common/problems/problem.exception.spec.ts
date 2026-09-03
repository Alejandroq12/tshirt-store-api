import { PROBLEM_TYPE } from './problem.constants';
import {
  ProblemException,
  ValidationProblemException,
} from './problem.exception';

describe('ProblemException', () => {
  it('carries its problem body and its status onto the HTTP exception', () => {
    const problem = {
      type: PROBLEM_TYPE.EMPTY_CART,
      title: 'Cart is empty',
      status: 409,
    } as const;

    const exception = new ProblemException(problem);

    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toEqual(problem);
  });
});

describe('ValidationProblemException', () => {
  it('keeps one entry per reported field', () => {
    const exception = new ValidationProblemException([
      { field: 'email', message: 'Must be a valid email address.' },
      { field: 'password', message: 'Must be at least 12 characters.' },
    ]);

    expect(exception.getStatus()).toBe(422);
    expect(exception.problem).toEqual({
      type: PROBLEM_TYPE.BLANK,
      title: 'Unprocessable Content',
      status: 422,
      errors: [
        { field: 'email', message: 'Must be a valid email address.' },
        { field: 'password', message: 'Must be at least 12 characters.' },
      ],
    });
  });

  it('substitutes a generic entry rather than emitting an empty errors array', () => {
    // The contract's ValidationProblem declares `errors` with `minItems: 1`, so
    // an empty list would be a 422 the delivered schema rejects. A cross-field
    // rule that fails without naming a property is what reaches this path.
    const exception = new ValidationProblemException([]);

    expect(exception.problem.errors).toEqual([
      { field: '', message: 'Invalid request body.' },
    ]);
  });
});
