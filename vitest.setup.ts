import { afterAll } from "vitest";
import { cleanupLogger } from "./src/logger.js";

// Clean up logger worker threads after all tests complete
afterAll(async () => {
  await cleanupLogger();
});
