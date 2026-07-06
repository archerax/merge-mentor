export type MoSCoWTag = "Must" | "Should" | "Could" | "Won't";

/**
 * Extracts a single MoSCoW tag from a list of raw tag/label strings.
 * Filters and maps tags/labels to strictly capture MoSCoW priorities.
 * Returns the first matched MoSCoW tag, or undefined if none match.
 */
export function extractMoSCoWTag(tags: readonly string[]): MoSCoWTag | undefined {
  const moscowRegex =
    /^(?:(?:prio(?:rity)?|moscow)[:/\\\-\s]+)?(must|should|could|won'?t)(?:[\s-]*have)?$/i;
  for (const rawTag of tags) {
    const match = moscowRegex.exec(rawTag.trim());
    if (match) {
      const value = match[1].toLowerCase();
      if (value === "must") return "Must";
      if (value === "should") return "Should";
      if (value === "could") return "Could";
      if (value === "won't" || value === "wont") return "Won't";
    }
  }
  return undefined;
}
