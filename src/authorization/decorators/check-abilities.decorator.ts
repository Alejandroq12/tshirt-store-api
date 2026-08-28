import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import type { AppAction, AppSubjects } from '../ability.types';
import { AbilitiesGuard } from '../guards/abilities.guard';

export const REQUIRED_ABILITIES = 'casl:required-abilities';

export interface RequiredAbility {
  action: AppAction;
  subject: AppSubjects;
}

export const CheckAbilities = (
  ...abilities: RequiredAbility[]
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    SetMetadata(REQUIRED_ABILITIES, abilities),
    UseGuards(AbilitiesGuard),
  );
