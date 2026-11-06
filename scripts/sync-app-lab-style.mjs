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
await writeFile(resolve(root, "assets", "app-lab.css"), css.trim() + "\n.code-bar{flex-wrap:wrap}.code-bar span{overflow-wrap:anywhere;min-width:0}\n");
await writeFile(resolve(root, "assets", "app-lab.js"), appBehavior + "\n");
console.log("Apps lab style and controls derived from the unchanged PIM lab.");
