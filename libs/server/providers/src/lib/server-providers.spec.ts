import { serverProviders } from './server-providers.js';

describe('serverProviders', () => {
  it('should work', () => {
    expect(serverProviders()).toEqual('server-providers');
  });
});
