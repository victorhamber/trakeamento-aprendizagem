let cachedSecret: string | null = null;

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is missing in production. Refusing to start with ephemeral secret.');
  }
  if (!cachedSecret) {
    console.warn('WARNING: Using ephemeral JWT secret in development. Tokens will invalidate on restart.');
    cachedSecret = 'dev_' + Math.random().toString(36).slice(2) + Date.now();
  }
  return cachedSecret;
};

