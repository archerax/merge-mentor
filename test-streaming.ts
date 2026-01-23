#!/usr/bin/env tsx
/**
 * Simple script to test streaming functionality
 */

import { CopilotSDKProvider } from "./src/ai/providers/copilotSDK.js";

async function testStreaming() {
  const provider = new CopilotSDKProvider({ model: "gpt-4.1" });

  console.log("Testing streaming output...\n");
  console.log("Starting prompt execution with streaming feedback:");
  console.log("-".repeat(60));

  const prompt = `Please provide a detailed code review for the following TypeScript function:

\`\`\`typescript
function calculateTotal(items: any[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}
\`\`\`

Please identify any issues and suggest improvements.`;

  let chunkCount = 0;
  const startTime = Date.now();

  try {
    const response = await provider.executePromptWithStreaming!(
      prompt,
      (chunk: string) => {
        chunkCount++;
        // Show progress every 10 chunks
        if (chunkCount % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          process.stdout.write(`\r⏳ Streaming... (${elapsed}s, ${chunkCount} chunks)`);
        }
      }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\r✅ Complete! (${elapsed}s, ${chunkCount} total chunks)`);
    console.log("-".repeat(60));
    console.log("\nResponse preview:");
    console.log(response.raw.substring(0, 500));
    if (response.raw.length > 500) {
      console.log(`\n... (${response.raw.length - 500} more characters)`);
    }

    if (response.tokenUsage) {
      console.log("\n📊 Token Usage:");
      console.log(`  Input: ${response.tokenUsage.inputTokens}`);
      console.log(`  Output: ${response.tokenUsage.outputTokens}`);
      if (response.tokenUsage.model) {
        console.log(`  Model: ${response.tokenUsage.model}`);
      }
    }
  } catch (error) {
    console.error(`\n❌ Error: ${(error as Error).message}`);
  } finally {
    await provider.stop();
  }
}

testStreaming().catch(console.error);
