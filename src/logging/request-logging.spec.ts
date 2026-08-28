import { correlationId, requestLogLevel } from './request-logging';

const responseSpy = () => {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
};

describe('correlationId', () => {
  it('echoes an id the caller supplied, so a trace spans services', () => {
    const response = responseSpy();

    const id = correlationId(
      { headers: { 'x-request-id': 'abc-123_XYZ' } },
      response,
    );

    expect(id).toBe('abc-123_XYZ');
    expect(response.headers['X-Request-Id']).toBe('abc-123_XYZ');
  });

  it('generates one when the caller supplied none', () => {
    const response = responseSpy();

    const id = correlationId({ headers: {} }, response);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['X-Request-Id']).toBe(id);
  });

  it.each([
    ['a newline, which would forge a log line', 'abc\ninjected'],
    ['a space', 'abc 123'],
    ['JSON punctuation', '{"level":30}'],
    ['something longer than 64 characters', 'a'.repeat(65)],
    ['an empty value', ''],
    ['a repeated header, which arrives as an array', ['a', 'b']],
  ])(
    'ignores %s and generates its own',
    (_label, supplied: string | string[]) => {
      const response = responseSpy();

      const id = correlationId(
        { headers: { 'x-request-id': supplied } },
        response,
      );

      expect(id).not.toBe(supplied);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('always sets the header, so a client can correlate its own request', () => {
    const response = responseSpy();

    correlationId({ headers: {} }, response);

    expect(Object.keys(response.headers)).toEqual(['X-Request-Id']);
  });
});

describe('requestLogLevel', () => {
  const at = (statusCode: number) => ({ statusCode });

  it.each([200, 201, 204, 302])('logs %s as a business event', (status) => {
    expect(requestLogLevel(at(status))).toBe('info');
  });

  it.each([400, 401, 403, 404, 409, 422, 429])(
    'logs %s as a warning, because it is the caller’s problem',
    (status) => {
      expect(requestLogLevel(at(status))).toBe('warn');
    },
  );

  it.each([500, 502, 503])('logs %s as an error', (status) => {
    expect(requestLogLevel(at(status))).toBe('error');
  });

  it('logs an error as an error even when the status looks fine', () => {
    expect(requestLogLevel(at(200), new Error('socket hang up'))).toBe('error');
  });
});
