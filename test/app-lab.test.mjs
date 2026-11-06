import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(resolve(root, file), "utf8");

test("standalone apps lab has the curriculum, actual comparison and working local source links", async () => {
  const file = resolve(root, "labs", "app-access-lab.html");
  const html = await readFile(file, "utf8");
  for (const topic of [
    "plan-design-integration-of-enterprise-apps-for-sso", "implement-monitor-integration-of-enterprise-apps-for-sso",
    "implement-app-registration", "register-apps-use-microsoft-entra-id", "AD FS", "App connectors",
    "credentials/update", "SAML", "SCIM", "application proxy", "optionalClaims", "User.Read",
    "oauth2PermissionGrants", "Application (client) ID", "service principal", "app governance",
    "Collections", "SPA", "OBO", "AzureADMultipleOrgs", "AADSTS50105", "Lab.Observer", "HTTP 403",
    "401", "200", "P1", "not run", "existing", "cleanup"
  ]) assert.ok(html.toLowerCase().includes(topic.toLowerCase()), `Missing ${topic}`);
  assert.equal((html.match(/class="module" id="a\d\d"/g) || []).length, 16);
  assert.equal((html.match(/data-complete="a\d\d"/g) || []).length, 16);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const link = match[1];
    if (/^https?:/.test(link)) continue;
    const [target, fragment] = link.split("#");
    let destination = target ? resolve(dirname(file), target.split("?")[0]) : file;
    if (target.endsWith("/")) destination = resolve(destination, "index.html");
    const content = await readFile(destination, "utf8");
    if (fragment && extname(destination) === ".html") assert.ok(content.includes(`id="${fragment}"`), link);
  }
  assert.match(html, /No tenant automation or real user sign-in has been executed/);
  assert.match(html, /static documentation/);
  assert.doesNotMatch(html, /migrate-adfs-apps-to-azure|application-proxy-configure-using-powershell|configure-saml-single-sign-on|application-proxy-configure-single-sign-on-with-kcd/);
});

test("app lab preserves the PIM visual base and has separate persistent progress", async () => {
  const pim = await read("labs/pim-lab.html");
  const base = pim.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
  assert.ok((await read("assets/app-lab.css")).startsWith(base));
  const script = await read("assets/app-lab.js");
  assert.match(script, /entra-app-access-field-lab-v1/);
  assert.doesNotMatch(script, /entra-pim-field-lab-v1/);
  assert.match(script, /console\.error\('Lab progress could not be saved.'/);
  assert.match(script, /console\.error\('Saved lab progress could not be read.'/);
  assert.match(script, /app-access-lab-progress\.json/);
});

test("all authored PowerShell blocks and tenant automation parse when PowerShell is available", async t => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    t.skip("PowerShell is unavailable; Windows validation checks the parser separately.");
    return;
  }
  assert.equal(probe.status, 0, probe.stderr);
  const html = await read("labs/app-access-lab.html");
  const scripts = [...html.matchAll(/<pre data-file="[^"]+\.ps1"[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)]
    .map(match => match[1].replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&"));
  const command = `$scripts = [Console]::In.ReadToEnd() | ConvertFrom-Json; foreach ($script in $scripts) { $tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseInput($script,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 } }`;
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { input: JSON.stringify([...scripts, await read("labs/app-access-sample/tenant.ps1")]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(scripts.length >= 12);
});
