export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32 || secret === 'dev-secret') {
    throw new Error(
      'JWT_SECRET debe configurarse con una clave segura de al menos 32 caracteres'
    );
  }

  return secret;
}
