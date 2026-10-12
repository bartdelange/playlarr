import { AuthenticationSettings } from '@playlarr/auth-web';

import { getAuthConfiguration } from '@playlarr/auth-web/server';

export default async function SettingsPage() {
  return (
    <AuthenticationSettings
      initialConfiguration={await getAuthConfiguration()}
    />
  );
}
