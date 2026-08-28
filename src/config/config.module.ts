import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { EnvironmentVariables, validateEnvironment } from './env.validation';

export type AppConfigService = ConfigService<EnvironmentVariables, true>;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: process.env.NODE_ENV === 'test' ? ['.env.test'] : ['.env'],
      validate: validateEnvironment,
    }),
  ],
})
export class AppConfigModule {}
