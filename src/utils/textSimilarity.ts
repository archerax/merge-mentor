/**
 * Calculates the similarity between two strings using bigram (Dice) coefficient.
 *
 * Normalizes both inputs (lowercase, punctuation stripped) and returns 1.0 for
 * identical strings, 0.0 for very short inputs, otherwise the Dice coefficient
 * of shared character bigrams in the range 0.0 - 1.0.
 *
 * @param str1 - First string to compare
 * @param str2 - Second string to compare
 * @returns Similarity score between 0.0 (no overlap) and 1.0 (identical)
 */
export function calculateTextSimilarity(str1: string, str2: string): number {
  const norm1 = str1
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
  const norm2 = str2
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();

  if (norm1 === norm2) return 1.0;
  if (norm1.length < 2 || norm2.length < 2) return 0.0;

  const getBigrams = (str: string): Set<string> => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const bg1 = getBigrams(norm1);
  const bg2 = getBigrams(norm2);

  let intersection = 0;
  for (const bg of bg1) {
    if (bg2.has(bg)) intersection++;
  }

  return (2 * intersection) / (bg1.size + bg2.size);
}
