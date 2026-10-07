import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedSrc = fileURLToPath(new URL("../../libs/shared/src", import.meta.url));
const domainSrc = fileURLToPath(new URL("../../libs/domain/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@merge-mentor\/shared\/(.*)\.js$/, replacement: `${sharedSrc}/$1.ts` },
      { find: /^@merge-mentor\/domain\/(.*)\.js$/, replacement: `${domainSrc}/$1.ts` },
    ],
  },
  plugins: [tanstackStart(), viteReact()],
});
