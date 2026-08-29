import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_OPTIONAL_AUTH } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';

const bearerToken = (request: Request): string | undefined => {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;

  const [scheme, ...rest] = header.split(' ');
  const value = rest.join(' ').trim();

  if (scheme?.toLowerCase() !== 'bearer' || value === '') return undefined;
  return value;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);

    if (token === undefined) {
      const optional =
        this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH, targets) ===
        true;

      if (optional) return true;
      throw new UnauthorizedException();
    }

    const claims = await this.tokens.verifyAccessToken(token);
    const user = { id: claims.sub, role: claims.role, sessionId: claims.sid };

    if (!(await this.auth.isSessionActive(user))) {
      throw new UnauthorizedException();
    }

    request.user = user;

    return true;
  }
}
