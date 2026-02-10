// ═══════════════════════════════════════════════════════════════════════
//  Revenue Reporter — OpenClaw Extension
//  Command: /revenue [audit|summary|help]
//  Scheduler: Weekly (Mon 9am) & Monthly (1st 8am) → Google Chat
// ═══════════════════════════════════════════════════════════════════════

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { generateReport } from "../../src/revenue-engine/main.js";
import cron from "node-cron";

// ── Google Chat Webhook ──────────────────────────────────────────────

async function sendToGoogleChat(text: string): Promise<void> {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[Revenue Scheduler] GOOGLE_CHAT_WEBHOOK_URL not set — skipping send.");
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[Revenue Scheduler] Google Chat webhook failed [${res.status}]: ${body}`);
  }
}

// ── Extension Registration ───────────────────────────────────────────

export default function register(api: OpenClawPluginApi) {
  // Register the /revenue command
  api.registerCommand({
    name: "revenue",
    description: "Run a full Revenue Engine audit and receive the report.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = ctx.args?.trim() ?? "";
      const action = (args.split(/\s+/)[0] ?? "audit").toLowerCase();

      if (action === "help") {
        return {
          text: [
            "Revenue Engine Commands:",
            "",
            "/revenue audit   — Run full engine analysis (default)",
            "/revenue summary — Quick summary only",
            "/revenue help    — Show this help",
          ].join("\n"),
        };
      }

      try {
        const report = await generateReport();

        if (action === "summary") {
          const summaryIdx = report.indexOf("--- SUMMARY ---");
          if (summaryIdx !== -1) {
            const header = report.split("\n")[0];
            return { text: header + "\n\n" + report.slice(summaryIdx) };
          }
        }

        return { text: report };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `Revenue Engine error: ${msg}`, isError: true };
      }
    },
  });

  // ── Scheduled Jobs ───────────────────────────────────────────────

  // Job 1: Weekly Promotion Scan — Mondays at 9:00 AM
  cron.schedule("0 9 * * 1", async () => {
    console.log("[Revenue Scheduler] Running Weekly Promotion Scan...");
    try {
      const report = await generateReport();
      await sendToGoogleChat(`🚀 **Weekly Promotion Scan**\n\n${report}`);
      console.log("[Revenue Scheduler] Weekly scan sent to Google Chat.");
    } catch (err) {
      console.error("[Revenue Scheduler] Weekly scan failed:", err);
    }
  });

  // Job 2: Monthly Stabilization Audit — 1st of month at 8:00 AM
  cron.schedule("0 8 1 * *", async () => {
    console.log("[Revenue Scheduler] Running Monthly Stabilization Audit...");
    try {
      const report = await generateReport();
      await sendToGoogleChat(`⚖️ **Monthly Stabilization Audit**\n\n${report}`);
      console.log("[Revenue Scheduler] Monthly audit sent to Google Chat.");
    } catch (err) {
      console.error("[Revenue Scheduler] Monthly audit failed:", err);
    }
  });

  console.log("📅 Revenue Scheduler Active: Weekly (Mon 9am) & Monthly (1st 8am)");
}
