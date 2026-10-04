import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { authCookieName, publicAuthRouteMetadata } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { type AuthRequest, readCookie } from './http.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth.enabled) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      publicAuthRouteMetadata,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();

    const authenticated = await this.auth.isAuthenticated(
      readCookie(request, authCookieName),
    );

    if (!authenticated) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
