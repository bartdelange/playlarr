export interface AuthRequest {
  headers: {
    cookie?: string;
    host?: string;
    origin?: string;
    'x-forwarded-host'?: string;
  };
  method: string;
}

export interface AuthResponse {
  cookie(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      maxAge: number;
      path: string;
      sameSite: 'strict';
      secure: boolean;
    },
  ): void;
  clearCookie(
    name: string,
    options: {
      httpOnly: boolean;
      path: string;
      sameSite: 'strict';
      secure: boolean;
    },
  ): void;
}

export function readCookie(request: AuthRequest, name: string): string | null {
  const pairs = request.headers.cookie?.split(';') ?? [];

  for (const pair of pairs) {
    const separator = pair.indexOf('=');

    if (separator === -1) {
      continue;
    }

    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || null;
    }
  }

  return null;
}
