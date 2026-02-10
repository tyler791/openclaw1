// ═══════════════════════════════════════════════════════════════════════
//  Revenue Reporter — OpenClaw Extension
//  Command: /revenue [audit|summary|help]
//  Runs the Pacific Properties Revenue Engine v4.2 and returns a
//  formatted text report suitable for Telegram, Discord, or any channel.
// ═══════════════════════════════════════════════════════════════════════

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { generateReport } from "../../src/revenue-engine/main.js";

export default function register(api: OpenClawPluginApi) {
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
          // Extract just the SUMMARY section
          const summaryIdx = report.indexOf("--- SUMMARY ---");
          if (summaryIdx !== -1) {
            const header = report.split("\n")[0]; // title line
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
}
