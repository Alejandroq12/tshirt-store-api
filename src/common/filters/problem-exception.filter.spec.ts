import {
  ArgumentsHost,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  PROBLEM_TYPE,
  ProblemDetail,
  ProblemException,
  ValidationProblemException,
} from '../problems';
import { ProblemExceptionFilter } from './problem-exception.filter';

const ALLOWED_KEYS = ['type', 'title', 'status', 'detail', 'instance'];

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: ProblemDetail & Record<string, unknown>;
}

const capture = (): { host: ArgumentsHost; captured: Captured } => {
  const captured: Captured = {
    status: 0,
    headers: {},
    body: {} as Captured['body'],
  };

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    json(payload: Captured['body']) {
      captured.body = payload;
      return this;
    },
  };

  const request = { method: 'POST', path: '/v1/orders' };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, captured };
};

describe('ProblemExceptionFilter', () => {
  let filter: ProblemExceptionFilter;

  beforeEach(() => {
    filter = new ProblemExceptionFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('answers with the application/problem+json media type', () => {
    const { host, captured } = capture();

    filter.catch(new NotFoundException(), host);

    expect(captured.headers['content-type']).toBe('application/problem+json');
  });

  it('renders an ordinary Nest exception as about:blank plus its status', () => {
    const { host, captured } = capture();

    filter.catch(new ForbiddenException(), host);

    expect(captured.status).toBe(403);
    expect(captured.body).toEqual({
      type: PROBLEM_TYPE.BLANK,
      title: 'Forbidden',
      status: 403,
      instance: '/v1/orders',
    });
  });

  it('never adds a field the Problem schema does not allow', () => {
    const { host, captured } = capture();

    filter.catch(new NotFoundException('Product does not exist'), host);

    expect(
      Object.keys(captured.body).every((key) => ALLOWED_KEYS.includes(key)),
    ).toBe(true);
  });

  it('uses the contract spelling for the statuses RFC 9110 renamed', () => {
    const cases: Array<[number, string]> = [
      [HttpStatus.PAYLOAD_TOO_LARGE, 'Content Too Large'],
      [HttpStatus.UNPROCESSABLE_ENTITY, 'Unprocessable Content'],
    ];

    for (const [status, title] of cases) {
      const { host, captured } = capture();
      filter.catch(new HttpException('', status), host);
      expect(captured.body.title).toBe(title);
    }
  });

  it('passes an explicit client-safe message through as detail', () => {
    const { host, captured } = capture();

    filter.catch(new NotFoundException('Product does not exist'), host);

    expect(captured.body.detail).toBe('Product does not exist');
  });

  it('drops a message that only repeats the title', () => {
    const { host, captured } = capture();

    filter.catch(new ForbiddenException('Forbidden'), host);

    expect(captured.body.detail).toBeUndefined();
  });

  it('emits the contract URN when a problem type is thrown explicitly', () => {
    const { host, captured } = capture();

    filter.catch(
      new ProblemException({
        type: PROBLEM_TYPE.PENDING_ORDER_EXISTS,
        title: 'Pending order already exists',
        status: 409,
      }),
      host,
    );

    expect(captured.status).toBe(409);
    expect(captured.body.type).toBe(
      'urn:tshirt-store:problem:pending-order-exists',
    );
    expect(captured.body.title).toBe('Pending order already exists');
  });

  it('renders a validation failure as 422 with one entry per field', () => {
    const { host, captured } = capture();

    filter.catch(
      new ValidationProblemException([
        { field: 'email', message: 'Must be a valid email address.' },
      ]),
      host,
    );

    expect(captured.status).toBe(422);
    expect(captured.body).toMatchObject({
      type: PROBLEM_TYPE.BLANK,
      title: 'Unprocessable Content',
      status: 422,
      errors: [{ field: 'email', message: 'Must be a valid email address.' }],
    });
  });

  describe('failures that are ours, not the caller’s', () => {
    it('never leaks the message of an unexpected error', () => {
      const { host, captured } = capture();

      filter.catch(new Error('connect ECONNREFUSED 10.0.0.7:5432'), host);

      expect(captured.status).toBe(500);
      expect(captured.body).toEqual({
        type: PROBLEM_TYPE.BLANK,
        title: 'Internal Server Error',
        status: 500,
        instance: '/v1/orders',
      });
      expect(JSON.stringify(captured.body)).not.toContain('ECONNREFUSED');
    });

    it('sanitises a 500 thrown as a ProblemException', () => {
      const { host, captured } = capture();

      filter.catch(
        new ProblemException({
          type: 'urn:tshirt-store:problem:something',
          title: 'Something specific',
          status: 500,
          detail: 'connect ECONNREFUSED 10.0.0.7:5432 password=hunter2',
        }),
        host,
      );

      expect(captured.body).toEqual({
        type: PROBLEM_TYPE.BLANK,
        title: 'Internal Server Error',
        status: 500,
        instance: '/v1/orders',
      });
      expect(JSON.stringify(captured.body)).not.toContain('hunter2');
    });

    it('still emits a problem type below 500', () => {
      const { host, captured } = capture();

      filter.catch(
        new ProblemException({
          type: PROBLEM_TYPE.EMPTY_CART,
          title: 'Cart is empty',
          status: 409,
        }),
        host,
      );

      expect(captured.body.type).toBe(PROBLEM_TYPE.EMPTY_CART);
    });

    it('drops the detail of a 5xx even when one was supplied', () => {
      const { host, captured } = capture();

      filter.catch(new InternalServerErrorException('pool exhausted'), host);

      expect(captured.body.detail).toBeUndefined();
    });

    it('logs the cause it refused to return', () => {
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { host } = capture();

      filter.catch(new Error('connect ECONNREFUSED 10.0.0.7:5432'), host);

      expect(logged).toHaveBeenCalledTimes(1);
    });
  });

  describe('database constraints the design relies on', () => {
    const prismaError = (code: string): Prisma.PrismaClientKnownRequestError =>
      new Prisma.PrismaClientKnownRequestError('constraint failed', {
        code,
        clientVersion: '6.19.3',
      });

    it('translates a unique violation to the documented 409', () => {
      const { host, captured } = capture();

      filter.catch(prismaError('P2002'), host);

      expect(captured.status).toBe(409);
      expect(captured.body.title).toBe('Conflict');
    });

    it('translates a missing record to 404', () => {
      const { host, captured } = capture();

      filter.catch(prismaError('P2025'), host);

      expect(captured.status).toBe(404);
    });

    it('does not guess at a Prisma code it has no mapping for', () => {
      const { host, captured } = capture();

      filter.catch(prismaError('P2003'), host);

      expect(captured.status).toBe(500);
    });
  });
});
