export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export interface ValidationProblemError {
  field: string;
  message: string;
}

export interface ValidationProblemDetail extends ProblemDetail {
  status: 422;
  errors: ValidationProblemError[];
}
