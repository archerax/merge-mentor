/**
 * Resolves after the given number of milliseconds.
 *
 * @param ms - Milliseconds to wait before resolving.
 * @returns A promise that resolves after the delay.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
