import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (this.requiresCsrfProtection(request) && (await this.auth.isEnabled())) {
      this.assertSameOrigin(request);
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      publicAuthRouteMetadata,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const authenticated = await this.auth.isAuthenticated(
      readCookie(request, authCookieName),
    );

    if (!authenticated) {
      throw new UnauthorizedException();
    }

    return true;
  }

  private requiresCsrfProtection(request: AuthRequest): boolean {
    return !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  }

  private assertSameOrigin(request: AuthRequest): void {
    const host = request.headers.host;
    const origin = request.headers.origin;
    const forwardedHost = request.headers['x-forwarded-host']
      ?.split(',', 1)[0]
      ?.trim();

    if ((!host && !forwardedHost) || !origin) {
      throw new ForbiddenException('A same-origin request is required');
    }

    try {
      const originHost = new URL(origin).host;

      if (originHost !== host && originHost !== forwardedHost) {
        throw new ForbiddenException('A same-origin request is required');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new ForbiddenException('A same-origin request is required');
    }
  }
}
