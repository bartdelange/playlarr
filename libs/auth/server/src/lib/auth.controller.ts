import {
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

    response.cookie(authCookieName, session.token, {
      httpOnly: true,
      maxAge: session.lifetimeMilliseconds,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });

    return { authenticated: true };
  }

  @Post('logout')
  @PublicAuthRoute()
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    await this.auth.logout(readCookie(request, authCookieName));

    response.clearCookie(authCookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });

    return { authenticated: false };
  }
}
