#!/usr/bin/env node

import path from "node:path";
import dotenv from "dotenv";

// Load .env from current working directory (supports both local and global usage)
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

import { program } from "./program.js";

program.parse();
