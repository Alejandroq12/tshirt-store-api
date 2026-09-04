import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { PrismaModule } from '../prisma/prisma.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Injectable()
class CartAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role !== UserRole.CLIENT) return;
      can('manage', 'Cart');
    });
  }
}

@Module({
  imports: [AuthorizationModule, PrismaModule],
  controllers: [CartController],
  providers: [CartService, CartAbilityRegistrar],
})
export class CartModule {}
