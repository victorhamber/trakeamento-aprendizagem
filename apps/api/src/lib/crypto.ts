import crypto from 'crypto';

let cachedEphemeralKey: Buffer | null = null;

const getEncryptionKey = (): Buffer => {
  const keyB64 = process.env.APP_ENCRYPTION_KEY;
  if (!keyB64) {
    if (!cachedEphemeralKey) {
      console.warn('WARNING: APP_ENCRYPTION_KEY is not set. Using ephemeral key. Data encrypted now will be unreadable after restart.');
      cachedEphemeralKey = crypto.randomBytes(32);
    }
    return cachedEphemeralKey;
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (base64)');
  return key;
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

