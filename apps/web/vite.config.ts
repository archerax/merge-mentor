import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const sharedSrc = fileURLToPath(new URL("../../libs/shared/src", import.meta.url));
const domainSrc = fileURLToPath(new URL("../../libs/domain/src", import.meta.url));
const configSrc = fileURLToPath(new URL("../../libs/config/src", import.meta.url));
const coreSrc = fileURLToPath(new URL("../../libs/core/src", import.meta.url));
const platformsSrc = fileURLToPath(new URL("../../libs/platforms/src", import.meta.url));
const brandAssets = fileURLToPath(new URL("../../assets", import.meta.url));

const runtimeExternals = [
  "@github/copilot-sdk",
  "@octokit/rest",
  "@opencode-ai/sdk",
  "azure-devops-node-api",
  "diff",
  "dotenv",
  "isomorphic-git",
  "picomatch",
  "pino",
  "zod",
].map((pkg) => new RegExp(`^${pkg}(/|$)`));

export default defineConfig(({ command }) => ({
  publicDir: brandAssets,
  environments: {
    client: {
      build: {
        copyPublicDir: true,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^@merge-mentor\/shared\/(.*)\.js$/, replacement: `${sharedSrc}/$1.ts` },
      { find: /^@merge-mentor\/domain\/(.*)\.js$/, replacement: `${domainSrc}/$1.ts` },
      { find: /^@merge-mentor\/config\/(.*)\.js$/, replacement: `${configSrc}/$1.ts` },
      { find: /^@merge-mentor\/core\/(.*)\.js$/, replacement: `${coreSrc}/$1.ts` },
      { find: /^@merge-mentor\/platforms\/(.*)\.js$/, replacement: `${platformsSrc}/$1.ts` },
    ],
  },
  plugins: [
    tanstackStart(),
    ...(command === "build" ? [nitro({ rollupConfig: { external: runtimeExternals } })] : []),
    viteReact(),
  ],
}));
