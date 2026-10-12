const backendHost = process.env.PLAYLARR_SERVER_HOST ?? '127.0.0.1';
const backendPort = process.env.PLAYLARR_SERVER_PORT ?? '3001';
const backendOrigin = `http://${backendHost}:${backendPort}`;

function nestApiUrl(path) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('NestJS API paths must be root-relative');
  }

  return `${backendOrigin}/api${path}`;
}

module.exports = { backendOrigin, nestApiUrl };
