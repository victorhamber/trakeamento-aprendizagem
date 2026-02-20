import crypto from 'crypto';

let ephemeralKey: Buffer | null = null; // Changed from cachedEphemeralKey to ephemeralKey

const getEncryptionKey = (): Buffer => {
  const envKey = process.env.APP_ENCRYPTION_KEY;
  if (envKey) {
    // Tenta decodificar como base64 primeiro (geralmente termina com =), senão assume hex
    const isBase64 = envKey.endsWith('=') || envKey.includes('+') || envKey.includes('/');
    const key = Buffer.from(envKey, isBase64 ? 'base64' : 'hex');
    if (key.length !== 32) {
      throw new Error(`APP_ENCRYPTION_KEY must be exactly 32 bytes. Currently it decodes to ${key.length} bytes.`);
    }
    return key;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: APP_ENCRYPTION_KEY environment variable is missing in production. Refusing to start with ephemeral key because encrypted data would be permanently lost on restart.');
  }

  if (!ephemeralKey) {
    console.warn('\nWARNING: APP_ENCRYPTION_KEY is not set.');
    console.warn('Using ephemeral key. Encrypted data WILL BE LOST on restart.');
    console.warn('Set APP_ENCRYPTION_KEY in .env for persistence.\n');
    ephemeralKey = crypto.randomBytes(32); // 256 bits
  }
  return ephemeralKey;
};

export const encryptString = (plaintext: string): string => {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
};

export const decryptString = (payload: string): string => {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload format');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
};

