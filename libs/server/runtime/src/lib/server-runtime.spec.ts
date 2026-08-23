import { serverRuntime } from './server-runtime.js';

describe('serverRuntime', () => {
  it('should work', () => {
    expect(serverRuntime()).toEqual('server-runtime');
  })
})
