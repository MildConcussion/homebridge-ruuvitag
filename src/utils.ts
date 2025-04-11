/**
 * Calculate the hypotenuse of a 3D right-angled triangle (Euclidean distance)
 * @param a First axis distance
 * @param b Second axis distance
 * @param c Third axis distance (optional)
 * @returns The hypotenuse value (Euclidean distance)
 */
export function hypotenuse(a: number, b: number, c = 0): number {
  return Math.sqrt(Math.pow(a, 2) + Math.pow(b, 2) + Math.pow(c, 2));
}