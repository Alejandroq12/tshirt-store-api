import { randomUUID } from 'node:crypto';

import type { IncomingHttpHeaders } from 'node:http';

interface HeaderSource {
  headers: IncomingHttpHeaders;
}

interface HeaderSink {
  setHeader(name: string, value: string): unknown;
}

interface StatusSource {
  statusCode: number;
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const correlationId = (
  request: HeaderSource,
  response: HeaderSink,
): string => {
  const supplied = request.headers['x-request-id'];
  const id =
    typeof supplied === 'string' && SAFE_REQUEST_ID.test(supplied)
      ? supplied
      : randomUUID();

  response.setHeader('X-Request-Id', id);
  return id;
};

export type RequestLogLevel = 'info' | 'warn' | 'error';

export const requestLogLevel = (
  response: StatusSource,
  error?: Error,
): RequestLogLevel => {
  if (error || response.statusCode >= 500) return 'error';
  if (response.statusCode >= 400) return 'warn';
  return 'info';
};
