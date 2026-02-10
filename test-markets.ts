import { config as loadEnv } from 'dotenv';
loadEnv();

const k = process.env.KEYDATA_API_KEY!;
const base = 'https://api-beta.keydatadashboard.com';

async function main() {
  // Fetch user's subscribed markets
  const res = await fetch(`${base}/v1/markets/my`, {
    method: 'GET',
    headers: { 'x-api-key': k, 'Accept': 'application/json' },
  });
  const markets = await res.json() as Array<{ id: string; title: string; level: string; lat: number; lng: number }>;
  console.log(`Total subscribed markets: ${markets.length}`);
  console.log('\nAll markets:');
  for (const m of markets) {
    console.log(`  ${m.title} (${m.level}) => ${m.id}`);
  }

  // Also search the global markets list for "Galveston"
  console.log('\n--- Searching global markets for "Galveston" ---');
  const globalRes = await fetch(`${base}/v1/markets`, {
    method: 'GET',
    headers: { 'x-api-key': k, 'Accept': 'application/json' },
  });
  const allMarkets = await globalRes.json() as Array<{ id: string; title: string; level: string }>;
  const galveston = allMarkets.filter(m => m.title.toLowerCase().includes('galveston'));
  console.log(`Found ${galveston.length} Galveston markets:`);
  for (const m of galveston) {
    console.log(`  ${m.title} (${m.level}) => ${m.id}`);
  }
}

main().catch(console.error);
