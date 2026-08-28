import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import type { SecretScrubber } from '../../logging/secret-scrubber';
import {
  PROBLEM_CONTENT_TYPE,
  PROBLEM_TYPE,
  ProblemDetail,
  ProblemException,
  ValidationProblemException,
} from '../problems';

const STATUS_TITLE: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const SERVER_ERROR = 500;

const titleFor = (status: number): string =>
  STATUS_TITLE[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');

const detailFrom = (body: unknown, title: string): string | undefined => {
  const candidate = ((): string | undefined => {
    if (typeof body === 'string') return body;
    if (typeof body !== 'object' || body === null) return undefined;

    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      const lines = message.filter(
        (entry): entry is string => typeof entry === 'string',
      );
      return lines.length > 0 ? lines.join('; ') : undefined;
    }
    return undefined;
  })();

  if (candidate === undefined) return undefined;
  const trimmed = candidate.trim();
  return trimmed === '' || trimmed === title ? undefined : trimmed;
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  constructor(private readonly scrub: SecretScrubber = (text) => text) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem = this.toProblem(exception, request);

    if (problem.status >= SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.path} responded ${problem.status}`,
        this.scrub(
          exception instanceof Error
            ? (exception.stack ?? exception.message)
            : String(exception),
        ),
      );
    }

    response
      .status(problem.status)
      .setHeader('Content-Type', PROBLEM_CONTENT_TYPE)
      .json(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDetail {
    const instance = request.path;

    if (
      exception instanceof ProblemException ||
      exception instanceof ValidationProblemException
    ) {
      return exception.problem.status >= SERVER_ERROR
        ? this.serverError(instance)
        : { ...exception.problem, instance };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const title = titleFor(status);

      return {
        type: PROBLEM_TYPE.BLANK,
        title,
        status,
        ...(status < SERVER_ERROR
          ? { detail: detailFrom(exception.getResponse(), title) }
          : {}),
        instance,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const status = PRISMA_STATUS[exception.code];
      if (status !== undefined) {
        return {
          type: PROBLEM_TYPE.BLANK,
          title: titleFor(status),
          status,
          instance,
        };
      }
    }

    return this.serverError(instance);
  }

  private serverError(instance: string): ProblemDetail {
    return {
      type: PROBLEM_TYPE.BLANK,
      title: titleFor(SERVER_ERROR),
      status: SERVER_ERROR,
      instance,
    };
  }
}

const PRISMA_STATUS: Readonly<Record<string, number>> = {
  P2002: HttpStatus.CONFLICT,
  P2025: HttpStatus.NOT_FOUND,
};
