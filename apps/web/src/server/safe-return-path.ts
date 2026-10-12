export function safeReturnPath(value: string | string[] | undefined): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('\\')
  ) {
    return '/';
  }

  try {
    const origin = 'http://playlarr.local';
    const destination = new URL(value, origin);

    if (
      destination.origin !== origin ||
      destination.pathname === '/login' ||
      destination.pathname.startsWith('/login/')
    ) {
      return '/';
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}
