#!/usr/bin/env npx tsx
import { config as loadEnv } from 'dotenv';
loadEnv();

import { listProperties, type HospitableConfig } from './src/revenue-engine/hospitable-client';
import { generateReport } from './src/revenue-engine/main';

const HOSPITABLE_CONFIG: HospitableConfig = {
  apiKey: process.env.HOSPITABLE_API_KEY ?? '',
  baseUrl: process.env.HOSPITABLE_BASE_URL ?? 'https://public.api.hospitable.com/v2',
};

async function main() {
  console.log('Fetching all properties from Hospitable...\n');
  const properties = await listProperties(HOSPITABLE_CONFIG);
  console.log(`Found ${properties.length} properties.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    const header = `[${ i + 1}/${properties.length}] ${p.name} (${p.id})`;
    console.log('='.repeat(80));
    console.log(header);
    console.log('='.repeat(80));

    try {
      const report = await generateReport({ hospitablePropertyId: p.id });
      console.log(report);
      success++;
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      failed++;
    }

    console.log();
  }

  console.log('='.repeat(80));
  console.log(`COMPLETE: ${success} succeeded, ${failed} failed out of ${properties.length} properties.`);
  console.log('='.repeat(80));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
