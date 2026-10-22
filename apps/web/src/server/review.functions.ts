import { createServerFn } from "@tanstack/react-start";

import { getPRCacheStatus } from "./review.server.js";
import type { ReviewStreamInput } from "./review.types.js";

/** Server function that reports whether a PR already has cached review state. */
export const getReviewCacheStatus = createServerFn({
  method: "POST",
  strict: { output: false },
})
  .validator((data: ReviewStreamInput) => data)
  .handler(async ({ data }) => getPRCacheStatus(data));
