import { config } from "dotenv";
import chalk from "chalk";

// Load .env from project root
config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error(chalk.red("GEMINI_API_KEY is not set. Check your .env file."));
  process.exit(1);
}

const MODEL = "gemini-2.0-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const PROMPT = "Explain in one sentence why you are excited to be part of the OpenClaw project.";

const response = await fetch(`${BASE_URL}/models/${MODEL}:generateContent`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-goog-api-key": API_KEY,
  },
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: PROMPT }] }],
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(chalk.red(`API error ${response.status}: ${body}`));
  process.exit(1);
}

const payload = await response.json();
const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;

if (text) {
  console.log(chalk.green(text.trim()));
} else {
  console.error(chalk.red("No text in response:"), JSON.stringify(payload, null, 2));
  process.exit(1);
}
