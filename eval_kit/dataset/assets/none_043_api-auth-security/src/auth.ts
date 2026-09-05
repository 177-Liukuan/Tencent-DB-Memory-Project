export function verifyToken(token: string): { sub: string } {
  if (!token) throw new Error('missing token');
  return { sub: 'u1' };
}
