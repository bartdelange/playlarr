import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';

const keyLength = 64;
const parameters = { N: 16_384, r: 8, p: 1 } as const;

const deriveKey = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, parameters, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);

  return [
    'scrypt',
    parameters.N,
    parameters.r,
    parameters.p,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, salt, expected] =
    encodedHash.split('$');

  if (
    algorithm !== 'scrypt' ||
    cost !== String(parameters.N) ||
    blockSize !== String(parameters.r) ||
    parallelization !== String(parameters.p) ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const expectedKey = Buffer.from(expected, 'base64');

  if (expectedKey.length !== keyLength) {
    return false;
  }

  try {
    const derivedKey = await deriveKey(password, Buffer.from(salt, 'base64'));

    return timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}
