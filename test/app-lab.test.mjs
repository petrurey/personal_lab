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

test("each module separates actionable configuration from collapsed knowledge", async () => {
  const html = await read("labs/app-access-lab.html");
  const modules = new Map([...html.matchAll(/<section class="module" id="(a\d\d)"[\s\S]*?<\/section>/g)]
    .map(match => [match[1], match[0]]));
  assert.equal(modules.size, 16);
  for (const [id, module] of modules) {
    assert.match(module, /<div class="configuration"><h3>Technical configuration<\/h3>/, id);
    assert.match(module, /<\/div>\s*<details class="knowledge"><summary>Knowledge &amp; context<\/summary>/, id);
    const configuration = module.slice(module.indexOf('<div class="configuration">'), module.indexOf('<details class="knowledge">'));
    assert.match(configuration, /<ol class="steps"/, `${id} requires numbered technical actions`);
    assert.match(configuration, /<strong>Verify:<\/strong>|<strong>Verify core:<\/strong>/, `${id} requires an explicit result check`);
    const knowledge = module.slice(module.indexOf('<details class="knowledge">'));
    assert.doesNotMatch(knowledge, /<ol class="steps"|<pre data-file=/, `${id} must not put configuration/code into knowledge`);
  }
  const requiredConfiguration = {
    a00: ["Users &gt; All users &gt; New user &gt; Create new user", "Account enabled: Yes", "lab-app-denied@YOUR_LAB_DOMAIN"],
    a02: ["New custom role", "Roles and administrators", "credentials/update"],
    a03: ["https://samltoolkit.azurewebsites.net/SAML/Consume", "Certificate (Raw)", "SP Initiated Login URL", "ACS URL"],
    a04: ["Internal URL", "Preauthentication", "Connector group", "Internal Application SPN", "Delegated Login Identity"],
    a05: ["Provisioning Mode: Automatic", "Tenant URL", "Secret Token", "Sync only assigned users and groups", "Provision on demand"],
    a06: ["Token type: ID", "Source attribute: user.displayname", "Who can review admin consent requests", "7 days"],
    a07: ["Redirect URI platform", "http://localhost:4300/callback", "Allow public client flows: No", "Assignment required: Yes"],
    a08: ["Delegated permissions", "Granted for YOUR_LAB_TENANT", "Scope name: access_as_user", "Applications", "requested_token_use"],
    a09: ["Select a role", "Lab.Reader", "Lab.Observer", "membership", "Assigned"],
    a10: ["Add a platform &gt; Single-page application", "http://localhost:5173", "AzureADMultipleOrgs"],
    a11: ["Threat detection &gt; Create policy &gt; OAuth app policy", "APP-ACCESS-LAB-OAuth-Alert", "unchecked"],
    a12: ["App launchers &gt; New collection", "Log Analytics workspaces &gt; Create", "Add diagnostic setting", "SignInLogs", "AuditLogs"],
    a13: ["13-set-environment.ps1", "13-run-sample.ps1", "npm ci", "HTTP 401"],
    a14: ["Lab Observer", "HTTP 200", "HTTP 403", "AADSTS50105", "Enable policy: Report-only"],
    a15: ["Stop provisioning", "Custom roles", "rg-app-access-lab", "Action Cleanup"]
  };
  for (const [id, values] of Object.entries(requiredConfiguration)) {
    const configuration = modules.get(id).split('<details class="knowledge">')[0];
    for (const value of values) assert.ok(configuration.includes(value), `${id}: missing explicit configuration ${value}`);
  }
  assert.match(html, /Core order:/);
  for (const id of ["a00", "a07", "a08", "a09", "a13", "a14", "a15"]) assert.ok(html.includes(`href="#${id}"`));
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
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { input: JSON.stringify([...scripts,
    await read("labs/app-access-sample/tenant.ps1"), await read("labs/app-access-sample/automation.ps1")]), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(scripts.length >= 12);
});

test("automation routes declare completeness and replace inventory with matching configuration", async () => {
  const html = await read("labs/app-access-lab.html");
  const modules = new Map([...html.matchAll(/<section class="module" id="(a\d\d)"[\s\S]*?<\/section>/g)]
    .map(match => [match[1], match[0]]));
  for (const [id, module] of modules) {
    if (id === "a13") continue;
    assert.match(module, /class="automation" data-parity="(?:complete|shared|manual-only)"/, id);
    if (["a01", "a05", "a11"].includes(id)) {
      assert.match(module, /data-parity="manual-only"/);
      assert.doesNotMatch(module, /<pre data-file="[^"]+\.ps1"/);
    } else {
      assert.match(module, /<strong>Result(?: after the shared steps)?:<\/strong>/, id);
      if (!["a07", "a09"].includes(id)) assert.match(module, /<strong>Shared(?:[^<]*)<\/strong>/, id);
    }
  }
  for (const [id, commands] of Object.entries({
    a00: ["Initialize-LabAutomation", "New-LabUsers"],
    a02: ["New-LabRegistration", "New-LabDirectoryRole"],
    a03: ["New-LabTemplateApp", "Set-LabSaml", "Add-LabDefaultAssignment"],
    a04: ["New-LabProxy", "Set-LabProxyKcd"],
    a06: ["Set-LabEmailClaim", "Set-LabSamlDisplayClaim", "Set-LabConsentWorkflow", "Restore-LabConsentWorkflow"],
    a07: ["New-LabRegistration", "Use-LabClient", "no consent grant, roles or user assignments"],
    a08: ["Set-LabDelegatedPermission -Consent", "New-LabApi", "Set-LabApiApplicationRole", "Set-LabApplicationPermission", "New-LabCredential"],
    a09: ["Set-LabUserRoles", "Add-LabAppAssignment", "New-LabReaderGroup"],
    a10: ["-Platform Spa", "-Audience AzureADMultipleOrgs", "second-tenant"],
    a12: ["New-LabLogExport", "30-day retention", "SignInLogs", "AuditLogs"],
    a14: ["Lab.Observer", "Remove-LabAssignment", "Remove-LabReaderMembership", "New-LabMfaPolicy", "state='enabled'"],
    a15: ["Remove-LabAutomation", "Remove-LabLogExport"]
  })) for (const command of commands) assert.ok(modules.get(id).includes(command), `${id}: ${command}`);
  assert.doesNotMatch(modules.get("a07"), /-Action Setup|Set-LabUserRoles|Add-LabAppAssignment/);
});

test("PowerShell offline contracts reproduce the portal configuration without tenant calls", t => {
  const result = spawnSync("pwsh", ["-NoProfile", "-File", resolve(root, "test", "app-automation.test.ps1")],
    { encoding: "utf8", timeout: 60_000 });
  if (result.error?.code === "ENOENT") {
    t.skip("PowerShell 7 is unavailable.");
    return;
  }
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Offline automation contracts passed/);
});
