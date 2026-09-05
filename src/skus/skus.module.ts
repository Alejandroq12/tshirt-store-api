import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';

@Injectable()
class SkusAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role !== UserRole.MANAGER) return;
      can('create', 'ProductSku');
      can('update', 'ProductSku');
    });
  }
}

@Module({
  imports: [AuthorizationModule, NotificationsModule, PrismaModule],
  controllers: [SkusController],
  providers: [SkusService, SkusAbilityRegistrar],
})
export class SkusModule {}
