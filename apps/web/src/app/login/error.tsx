'use client';

import { LoginUnavailable } from '@playlarr/auth-web';

export default function LoginError({ reset }: { reset: () => void }) {
  return <LoginUnavailable reset={reset} />;
}
