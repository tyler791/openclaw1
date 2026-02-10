import { config as loadEnv } from 'dotenv';
loadEnv();

async function main() {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('GOOGLE_CHAT_WEBHOOK_URL not set in .env');
    process.exit(1);
  }

  const text = '🔔 TEST: OpenClaw Revenue Bot is connected!';

  console.log('Sending test message to Google Chat...');
  console.log(`URL: ${webhookUrl.slice(0, 60)}...`);

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  const body = await res.text().catch(() => '');
  console.log(`Status: ${res.status}`);
  if (res.ok) {
    console.log('Message sent successfully!');
  } else {
    console.error(`Failed: ${body}`);
  }
}

main().catch(console.error);
