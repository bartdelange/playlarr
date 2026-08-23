import { serverPersistence } from './server-persistence.js';

describe('serverPersistence', () => {
  it('should work', () => {
    expect(serverPersistence()).toEqual('server-persistence');
  });
});
