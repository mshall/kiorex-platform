/** Test helper: robots.txt must never leak an internal host or a secret-looking value. */
export const buildAasaFree = (robots: string): boolean => !/localhost|127\.0\.0\.1|secret|token/i.test(robots);
