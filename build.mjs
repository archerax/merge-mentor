#!/usr/bin/env node
import { build } from 'esbuild';
import { glob } from 'glob';

const isProduction = process.env.NODE_ENV === 'production';

async function buildProject() {
  try {
    console.log(`Building for ${isProduction ? 'production' : 'development'}...`);
    
    const entryPoints = await glob('src/**/*.ts', {
      ignore: ['**/*.spec.ts', '**/*.test.ts']
    });

    await build({
      entryPoints,
      outdir: 'dist',
      bundle: false,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      minify: isProduction,
      keepNames: false,
      legalComments: 'none',
      logLevel: 'info',
    });
    
    console.log('✓ Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

buildProject();


