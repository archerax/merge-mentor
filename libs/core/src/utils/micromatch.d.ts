// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module "micromatch" {
  export function isMatch(
    str: string,
    pattern: string | string[],
    options?: Record<string, unknown>
  ): boolean;
  export function match(
    list: string[],
    patterns: string | string[],
    options?: Record<string, unknown>
  ): string[];
  export function contains(
    str: string,
    pattern: string | string[],
    options?: Record<string, unknown>
  ): boolean;
  export function matcher(
    pattern: string | string[],
    options?: Record<string, unknown>
  ): (str: string) => boolean;
}
