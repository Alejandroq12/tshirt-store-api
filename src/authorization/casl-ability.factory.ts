import { AbilityBuilder } from '@casl/ability';
import { createPrismaAbility } from '@casl/prisma';
import { Injectable } from '@nestjs/common';

import type { SessionPrincipal } from '../auth/types/session-principal';
import type { AbilityRuleContributor, AppAbility } from './ability.types';

@Injectable()
export class CaslAbilityFactory {
  private readonly contributors: AbilityRuleContributor[] = [];

  register(contributor: AbilityRuleContributor): void {
    this.contributors.push(contributor);
  }

  createForUser(user: SessionPrincipal): AppAbility {
    const builder = new AbilityBuilder<AppAbility>(createPrismaAbility);

    for (const contribute of this.contributors) {
      contribute(user, builder);
    }

    return builder.build();
  }
}
