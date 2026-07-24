const MIN_REASONING_LENGTH = 20;

const evidencePattern =
  /line|lines|context|call|query|input|output|state|branch|path|file|diff|import|return|value|guard|validation|check|middleware|parameter|request|response|token|cache|loop|dependency|array|object|function/i;

const impactPattern =
  /crash|error|fail|incorrect|wrong|stale|leak|latency|slow|outage|risk|vulnerab|expos|bypass|break|corrupt|deadlock|race|allow|cause|impact|inconsistent|timeout/i;

export function validateReasoning(
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
  reasoning: string,
  filename: string,
  lineOrLocation: string | number
): void {
  const location = typeof lineOrLocation === "number" ? `line ${lineOrLocation}` : lineOrLocation;

  if (reasoning.length < MIN_REASONING_LENGTH) {
    logger.warn(
      {
        filename,
        location,
        reasoningLength: reasoning.length,
        reasoning: reasoning.substring(0, 100),
      },
      `Reasoning too short (need ${MIN_REASONING_LENGTH}+ chars) - finding may lack enough evidence`
    );
  }

  if (!evidencePattern.test(reasoning) || !impactPattern.test(reasoning)) {
    logger.warn(
      {
        filename,
        location,
        reasoning: reasoning.substring(0, 150),
      },
      "Reasoning should briefly cite the code evidence and the concrete impact"
    );
  }
}
