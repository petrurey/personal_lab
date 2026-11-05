import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] || homedir());
for (const directory of ["labs", "info", "assets", ".private"]) {
  await mkdir(resolve(root, directory), { recursive: true });
}
for (const [input, output] of [
  ["pim-lab/pim_lab.html", "labs/pim-lab.html"],
  ["entra-roles.html", "info/entra-roles.html"]
]) {
  const original = await readFile(resolve(source, input), "utf8");
  if (!original.includes("</body>")) throw new Error(`Missing closing body: ${input}`);
  const imported = original.replace("</body>", '<script src="../assets/resource-nav.js?v=2" defer></script>\n</body>');
  await writeFile(resolve(root, output), imported);
  console.log(`Imported ${output}; original content retained with dashboard navigation.`);
}
const originalPlanPath = resolve(source, "identity-development-plan.html");
const plan = await readFile(originalPlanPath, "utf8");
const start = plan.indexOf('    const learnModule = ');
const end = plan.indexOf('    const escapeHTML = ', start);
if (start < 0 || end < 0) throw new Error("Cannot locate the public study roadmap in the original plan.");
const publicData = plan.slice(start, end);
if (/eng\.ms|sharepoint\.com|teams\.microsoft|learningplayer|esxp|deliveryRecords|const offerings/.test(publicData)) {
  throw new Error("The study data contains non-public content; import stopped.");
}
await writeFile(resolve(root, "assets", "study-data.js"), `"use strict";\n${publicData}`);
await copyFile(originalPlanPath, resolve(root, ".private", "identity-development-plan.html"));
console.log("Extracted public study roadmap. Full original saved in .private (excluded from Git and deployment).");
