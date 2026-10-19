import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { SessionPrincipal } from '../types/session-principal';

export interface CurrentUserOptions {
  optional?: boolean;
}

export const resolveCurrentUser = (
  request: Pick<Request, 'user'>,
  options: CurrentUserOptions = {},
): SessionPrincipal | undefined => {
  if (!request.user && !options.optional) {
    throw new UnauthorizedException();
  }

  return request.user;
};

export const CurrentUser = createParamDecorator(
  (
    options: CurrentUserOptions | undefined,
    context: ExecutionContext,
  ): SessionPrincipal | undefined =>
    resolveCurrentUser(context.switchToHttp().getRequest<Request>(), options),
);
