import { cp, mkdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL("../apps/web/.output/", import.meta.url);
const destUrl = new URL("../dist/web/", import.meta.url);

async function main() {
  try {
    const info = await stat(sourceUrl);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(
      "apps/web/.output is missing. Run `pnpm --filter @merge-mentor/web build` first."
    );
  }

  await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
  await rm(destUrl, { recursive: true, force: true });
  await cp(sourceUrl, destUrl, { recursive: true });

  console.log(`✓ Bundled web dashboard into ${fileURLToPath(destUrl)}`);
}

main().catch((error) => {
  console.error(`✗ Failed to bundle web dashboard: ${error.message}`);
  process.exit(1);
});
