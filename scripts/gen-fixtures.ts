/** Renders dev/fixtures/*.jsonl from dev/fixtures/build.ts:  pnpm fixtures:gen */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIXTURES, renderFixture } from "../dev/fixtures/build.js";

for (const [name, build] of Object.entries(FIXTURES)) {
  const target = fileURLToPath(new URL(`../dev/fixtures/${name}`, import.meta.url));
  const lines = build();
  writeFileSync(target, renderFixture(lines));
  console.log(`wrote ${target} (${lines.length} events)`);
}
