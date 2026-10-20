declare module "picomatch" {
  function picomatch(
    pattern: string | string[],
    options?: Record<string, unknown>
  ): (str: string) => boolean;
  export default picomatch;
}
