import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';

import { authCookieName } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { type AuthRequest, type AuthResponse, readCookie } from './http.js';
import { PublicAuthRoute } from './public-auth-route.decorator.js';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface ConfigurationBody {
  enabled?: unknown;
  username?: unknown;
  password?: unknown;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  @PublicAuthRoute()
  async status(@Req() request: AuthRequest) {
    const enabled = await this.auth.isEnabled();
    const authenticated = await this.auth.isAuthenticated(
      readCookie(request, authCookieName),
    );

    return {
      enabled,
      authenticated,
    };
  }

  @Get('configuration')
  configuration() {
    return this.auth.getConfiguration();
  }

  @Post('configuration')
  async configure(
    @Body() body: ConfigurationBody,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }

    if (typeof body.username !== 'string' || !body.username.trim()) {
      throw new BadRequestException('username is required');
    }

    if (body.username.trim().length > 128) {
      throw new BadRequestException('username must be 128 characters or less');
    }

    if (body.password !== undefined && typeof body.password !== 'string') {
      throw new BadRequestException('password must be a string');
    }

    if (typeof body.password === 'string' && body.password.length > 1024) {
      throw new BadRequestException('password must be 1024 characters or less');
    }

    const result = await this.auth.configure(
      {
        enabled: body.enabled,
        username: body.username.trim(),
        ...(body.password ? { password: body.password } : {}),
      },
      readCookie(request, authCookieName),
    );

    if (!result) {
      throw new BadRequestException(
        'A password is required when enabling authentication',
      );
    }

    if (result.session) {
      this.setSessionCookie(response, result.session);
    } else {
      this.clearSessionCookie(response);
    }

    return result.configuration;
  }

  @Post('login')
  @PublicAuthRoute()
  async login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    if (
      typeof body.username !== 'string' ||
      typeof body.password !== 'string'
    ) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const session = await this.auth.login(body.username, body.password);

    if (!session) {
      throw new UnauthorizedException('Invalid username or password');
    }

    this.setSessionCookie(response, session);

    return { authenticated: true };
  }

  @Post('logout')
  @PublicAuthRoute()
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    await this.auth.logout(readCookie(request, authCookieName));

    this.clearSessionCookie(response);

    return { authenticated: false };
  }

  private setSessionCookie(
    response: AuthResponse,
    session: { token: string; lifetimeMilliseconds: number },
  ): void {
    response.cookie(authCookieName, session.token, {
      httpOnly: true,
      maxAge: session.lifetimeMilliseconds,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
  }

  private clearSessionCookie(response: AuthResponse): void {
    response.clearCookie(authCookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
  }
}
