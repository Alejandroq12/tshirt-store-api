import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { AuthorizationModule } from '../authorization/authorization.module';
import { CaslAbilityFactory } from '../authorization/casl-ability.factory';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';

@Injectable()
class ImagesAbilityRegistrar implements OnModuleInit {
  constructor(private readonly abilities: CaslAbilityFactory) {}

  onModuleInit(): void {
    this.abilities.register((user, { can }) => {
      if (user.role === UserRole.MANAGER) can('create', 'ProductImage');
    });
  }
}

@Module({
  imports: [AuthorizationModule, PrismaModule, StorageModule],
  controllers: [ImagesController],
  providers: [ImagesService, ImagesAbilityRegistrar],
})
export class ImagesModule {}
