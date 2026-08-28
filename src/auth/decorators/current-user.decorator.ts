import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../authenticated-user';

export interface CurrentUserOptions {
  optional?: boolean;
}

export const resolveCurrentUser = (
  request: Pick<Request, 'user'>,
  options: CurrentUserOptions = {},
): AuthenticatedUser | undefined => {
  if (!request.user && !options.optional) {
    throw new UnauthorizedException();
  }

  return request.user;
};

export const CurrentUser = createParamDecorator(
  (
    options: CurrentUserOptions | undefined,
    context: ExecutionContext,
  ): AuthenticatedUser | undefined =>
    resolveCurrentUser(context.switchToHttp().getRequest<Request>(), options),
);
