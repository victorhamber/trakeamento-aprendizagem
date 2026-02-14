let cachedSecret: string | null = null;

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!cachedSecret) cachedSecret = 'dev_' + Math.random().toString(36).slice(2) + Date.now();
  return cachedSecret;
};

