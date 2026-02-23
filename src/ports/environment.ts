/** Abstraction over environment variable access for testability. */
export interface Environment {
  get(key: string): string | undefined;
}

/** Production implementation using process.env. */
export const processEnvironment: Environment = {
  get: (key) => process.env[key],
};
