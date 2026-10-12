export function safeReturnPath(value: string | string[] | undefined): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value === '/login' ||
    value.startsWith('/login?') ||
    value.startsWith('/login/')
  ) {
    return '/';
  }

  return value;
}
