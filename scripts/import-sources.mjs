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
await copyFile(originalPlanPath, resolve(root, ".private", "identity-development-plan.html"));
console.log("Full original saved unchanged in .private (excluded from Git and deployment). No replacement roadmap generated.");
