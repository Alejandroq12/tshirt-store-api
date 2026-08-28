import { HttpException } from '@nestjs/common';

import { PROBLEM_TYPE } from './problem.constants';
import {
  ProblemDetail,
  ValidationProblemDetail,
  ValidationProblemError,
} from './problem.types';

export class ProblemException extends HttpException {
  constructor(readonly problem: ProblemDetail) {
    super(problem, problem.status);
  }
}

export class ValidationProblemException extends HttpException {
  readonly problem: ValidationProblemDetail;

  constructor(errors: ValidationProblemError[]) {
    const problem: ValidationProblemDetail = {
      type: PROBLEM_TYPE.BLANK,
      title: 'Unprocessable Content',
      status: 422,
      errors:
        errors.length > 0
          ? errors
          : [{ field: '', message: 'Invalid request body.' }],
    };

    super(problem, 422);
    this.problem = problem;
  }
}
