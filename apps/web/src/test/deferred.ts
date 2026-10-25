/** A promise whose resolution is controlled by the test. */
export function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  const handlers: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((resolve) => {
    handlers.resolve = resolve;
  });
  return { promise, resolve: (value) => handlers.resolve?.(value) };
}
