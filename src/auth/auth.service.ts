import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type User, UserRole } from '@prisma/client';

import type { EnvironmentVariables } from '../config/env.validation';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './authenticated-user';
import {
  ChangePasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
  SignUpRequest,
} from './auth.dto';
import { PasswordService } from './password.service';
import { SecretTokenService } from './secret-token.service';
import { TokenService } from './token.service';

type SessionUser = Pick<
  User,
  'id' | 'email' | 'firstName' | 'lastName' | 'role'
>;

export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'manager' | 'client';
}

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: UserResponse;
}

export interface AccessTokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
}

const UNIT_MILLISECONDS = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  y: 31_536_000_000,
} as const;

const durationMilliseconds = (duration: string): number => {
  const match = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(duration);
  if (!match) throw new Error(`Invalid duration: ${duration}`);

  const amount = Number(match[1]);
  const result =
    amount * UNIT_MILLISECONDS[match[2] as keyof typeof UNIT_MILLISECONDS];
  if (!Number.isSafeInteger(result))
    throw new Error(`Invalid duration: ${duration}`);

  return result;
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const userResponse = (user: SessionUser): UserResponse => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role === UserRole.MANAGER ? 'manager' : 'client',
});

@Injectable()
export class AuthService {
  private readonly resetTokenTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly secretTokens: SecretTokenService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.resetTokenTtl = durationMilliseconds(
      config.get('PASSWORD_RESET_TOKEN_TTL', { infer: true }),
    );
  }

  async signUp(input: SignUpRequest): Promise<AuthSessionResponse> {
    const passwordHash = await this.passwords.hash(input.password);
    const user: SessionUser = {
      id: randomUUID(),
      email: normalizeEmail(input.email),
      firstName: input.firstName,
      lastName: input.lastName,
      role: UserRole.CLIENT,
    };
    const issued = await this.issueSession(user);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.create({
        data: { ...user, passwordHash },
      });
      await transaction.session.create({ data: issued.session });
    });

    return issued.response;
  }

  async login(input: LoginRequest): Promise<AuthSessionResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(input.email) },
    });

    if (!user) {
      await this.passwords.hash(input.password);
      throw new UnauthorizedException();
    }

    if (!(await this.passwords.verify(input.password, user.passwordHash))) {
      throw new UnauthorizedException();
    }

    const issued = await this.issueSession(user);
    await this.prisma.session.create({ data: issued.session });

    return issued.response;
  }

  async logout(user: AuthenticatedUser): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: user.sessionId, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<AccessTokenResponse> {
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        refreshTokenHash: this.secretTokens.digest(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        user: {
          select: {
            id: true,
            role: true,
          },
        },
      },
    });

    if (!session) throw new UnauthorizedException();

    const access = await this.tokens.issueAccessToken({
      id: session.user.id,
      role: session.user.role,
      sessionId: claims.sid,
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
    };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true },
    });

    if (!user) return;

    const token = this.secretTokens.generate();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.secretTokens.digest(token),
        expiresAt: new Date(Date.now() + this.resetTokenTtl),
      },
    });

    await this.mail.send({
      to: user.email,
      subject: 'Reset your password',
      text: `Reset token: ${token}`,
    });
  }

  async resetPassword(input: ResetPasswordRequest): Promise<void> {
    const passwordHash = await this.passwords.hash(input.newPassword);
    const tokenHash = this.secretTokens.digest(input.resetToken);
    const now = new Date();

    const email = await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
          user: { select: { email: true } },
        },
      });

      if (!token || token.usedAt || token.expiresAt <= now) {
        throw new BadRequestException();
      }

      const claimed = await transaction.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (claimed.count !== 1) throw new BadRequestException();

      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await transaction.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      return token.user.email;
    });

    await this.sendPasswordChanged(email);
  }

  async changePassword(
    user: AuthenticatedUser,
    input: ChangePasswordRequest,
  ): Promise<void> {
    const stored = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, passwordHash: true },
    });

    if (!stored) throw new UnauthorizedException();
    if (
      !(await this.passwords.verify(input.currentPassword, stored.passwordHash))
    ) {
      throw new BadRequestException();
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    await this.sendPasswordChanged(stored.email);
  }

  async isSessionActive(user: AuthenticatedUser): Promise<boolean> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: user.sessionId,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { user: { select: { role: true } } },
    });

    return session?.user.role === user.role;
  }

  private async issueSession(user: SessionUser): Promise<{
    response: AuthSessionResponse;
    session: {
      id: string;
      userId: string;
      refreshTokenHash: string;
      expiresAt: Date;
    };
  }> {
    const sessionId = randomUUID();
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      role: user.role,
      sessionId,
    };
    const [access, refresh] = await Promise.all([
      this.tokens.issueAccessToken(authenticatedUser),
      this.tokens.issueRefreshToken(authenticatedUser),
    ]);

    return {
      response: {
        accessToken: access.token,
        refreshToken: refresh.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        user: userResponse(user),
      },
      session: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash: this.secretTokens.digest(refresh.token),
        expiresAt: refresh.expiresAt,
      },
    };
  }

  private sendPasswordChanged(email: string): Promise<void> {
    return this.mail.send({
      to: email,
      subject: 'Your password was changed',
      text: 'Your T-Shirt Store password was changed.',
    });
  }
}
