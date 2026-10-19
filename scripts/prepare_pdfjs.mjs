import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(project, "public", "pdfjs");
mkdirSync(target, { recursive: true });
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  cpSync(join(source, directory), join(target, directory), { recursive: true });
}
cpSync(join(source, "web", "images"), join(target, "images"), {
  recursive: true,
});
