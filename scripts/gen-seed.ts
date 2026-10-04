/** Renders supabase/seed.sql from dev/seed/demo.ts:  pnpm seed:gen */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderSeed } from "../dev/seed/render.js";

const target = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
writeFileSync(target, renderSeed());
console.log(`wrote ${target}`);
