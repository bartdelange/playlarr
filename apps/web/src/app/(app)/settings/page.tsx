import { AuthenticationSettings } from '@playlarr/auth-web';

import { getAuthConfiguration } from '../../../server/auth-api';

export default async function SettingsPage() {
  return (
    <AuthenticationSettings
      initialConfiguration={await getAuthConfiguration()}
    />
  );
}
