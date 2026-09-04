import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Injectable()
class OrdersAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role === UserRole.CLIENT) {
        can('create', 'Order');
        can('update', 'Order');
        return;
      }
      if (user.role !== UserRole.MANAGER) return;
      can('read', 'Order');
      can('update', 'Order');
    });
  }
}

@Module({
  imports: [AuthorizationModule, PrismaModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersAbilityRegistrar],
})
export class OrdersModule {}
