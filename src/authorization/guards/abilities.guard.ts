import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CaslAbilityFactory } from '../casl-ability.factory';
import {
  REQUIRED_ABILITIES,
  RequiredAbility,
} from '../decorators/check-abilities.decorator';

@Injectable()
export class AbilitiesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilities: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<RequiredAbility[]>(REQUIRED_ABILITIES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) throw new UnauthorizedException();

    const ability = this.abilities.createForUser(user);

    for (const { action, subject } of required) {
      if (!ability.can(action, subject)) {
        throw new ForbiddenException();
      }
    }

    return true;
  }
}
