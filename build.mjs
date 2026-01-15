import { build } from "esbuild";

const isProduction = process.env.NODE_ENV === "production";

async function buildProject() {
  try {
    console.log(`Building for ${isProduction ? "production" : "development"}...`);

    await build({
      entryPoints: ["src/cli.ts"],
      outdir: "dist",
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      minify: isProduction,
      sourcemap: !isProduction,
      keepNames: false,
      legalComments: "none",
      logLevel: "info",
      packages: "external"
    });

    console.log("✓ Build completed successfully");
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

buildProject();
