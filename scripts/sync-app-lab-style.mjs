import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const original = await readFile(resolve(root, "labs", "pim-lab.html"), "utf8");
const css = original.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const behavior = original.match(/<script>\s*(\(\(\) => \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
if (!css || !behavior) throw new Error("Cannot locate the PIM lab visual style and controls.");
const appBehavior = behavior
  .replace("'entra-pim-field-lab-v1'", "'entra-app-access-field-lab-v1'")
  .replace("} catch { /* Local-file storage may be disabled; the lab still works. */ }", "} catch (error) { console.error('Saved lab progress could not be read.', error); announce('Saved progress could not be read. Export notes before closing this page.'); }")
  .replace("catch { announce('Browser storage unavailable. Export progress to keep your notes.'); }", "catch (error) { console.error('Lab progress could not be saved.', error); announce('Browser storage unavailable. Export progress to keep your notes.'); }")
  .replace("'pim-lab-progress.json'", "'app-access-lab-progress.json'")
  .replace("'Microsoft Entra PIM field lab'", "'Microsoft Entra app access field lab'")
  .replace("`${pre.dataset.lang === 'kql' ? 'KQL' : 'PowerShell'} / ${pre.dataset.file}`", "`${pre.dataset.lang || 'PowerShell'} / ${pre.dataset.file}`");
await writeFile(resolve(root, "assets", "app-lab.css"), css.trim() + "\n.code-bar{flex-wrap:wrap}.code-bar span{overflow-wrap:anywhere;min-width:0}.configuration>h3:first-child{margin-top:0;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:var(--brand)}.knowledge{background:var(--bg)}.knowledge>summary{color:var(--brand)}.automation>summary{font-size:.85rem}.automation-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:20px 0;align-items:start}.automation-track{min-width:0}.automation-track>h4{margin:0 0 8px;color:var(--brand)}.automation-track h5{font-size:.85rem;margin:20px 0 8px}.automation-track pre{max-width:100%}@media(max-width:1100px){.automation-grid{grid-template-columns:minmax(0,1fr)}}\n");
await writeFile(resolve(root, "assets", "app-lab.js"), appBehavior + "\n");
console.log("Apps lab style and controls derived from the unchanged PIM lab.");
