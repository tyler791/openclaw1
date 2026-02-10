import { config } from "dotenv";
import chalk from "chalk";

config();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error(chalk.red("GEMINI_API_KEY is not set. Check your .env file."));
  process.exit(1);
}

// Try both API versions
for (const version of ["v1beta", "v1"]) {
  console.log(chalk.yellow(`\n=== ${version} models ===\n`));

  const url = `https://generativelanguage.googleapis.com/${version}/models?key=${API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) {
    console.error(chalk.red(`${version} error ${response.status}: ${(await response.text()).slice(0, 200)}`));
    continue;
  }

  const data = await response.json();
  for (const model of data.models ?? []) {
    const methods = (model.supportedGenerationMethods ?? []).join(", ");
    console.log(`${chalk.green(model.name)}  ${chalk.gray(model.displayName ?? "")}  [${methods}]`);
  }
}
