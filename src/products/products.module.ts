import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Injectable()
class ProductsAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role !== UserRole.MANAGER) return;
      can('create', 'Product');
      can('update', 'Product');
    });
  }
}

@Module({
  imports: [AuthorizationModule, PrismaModule],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsAbilityRegistrar],
})
export class ProductsModule {}
