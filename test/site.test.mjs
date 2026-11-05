import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { once } from "node:events";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFile(resolve(root, file), "utf8");
const resources = ["plans/development-plan.html", "labs/pim-lab.html", "info/entra-roles.html"];
const categories = ["plans", "labs", "info"];
const pages = ["index.html", ...categories.map(category => `${category}/index.html`), ...resources];

test("landing page has compact category headings and isolated scrollable page lists", async () => {
  const html = await read("index.html");
  for (const category of categories) assert.ok(html.includes(`href="${category}/"`));
  assert.equal((html.match(/class="category-link"/g) || []).length, 3);
  assert.equal((html.match(/class="category-scroll" role="region" aria-label="[^"]+ pages" tabindex="0"/g) || []).length, 3);
  for (const [index, category] of categories.entries()) {
    const column = html.match(new RegExp(`<section class="category-column ${category}"[\\s\\S]*?</section>`))?.[0];
    assert.ok(column, `Missing ${category} column`);
    assert.ok(column.includes(`href="${resources[index]}"`));
    assert.equal((column.match(/data-resource/g) || []).length, 1);
    for (const other of resources.filter((_, position) => position !== index)) assert.ok(!column.includes(other));
  }
  assert.doesNotMatch(html, /class="hero|workspace-heading|workspace-note|site-footer|Your workspace\.|Choose where|Small steps|A place for what/);
});

test("category pages contain only their own cards and mark current navigation", async () => {
  for (const [index, category] of categories.entries()) {
    const html = await read(`${category}/index.html`);
    assert.equal((html.match(/data-resource /g) || []).length, 1);
    assert.ok(html.includes(`href="${resources[index].split("/")[1]}"`));
    assert.ok(html.includes(`href="../${category}/" aria-current="page"`));
    assert.ok(html.includes(`<body class="category-page ${category}">`));
    assert.match(html, /dashboard\.css\?v=4/);
    for (const other of resources.filter((_, position) => position !== index)) {
      assert.ok(!html.includes(other.split("/")[1]), `${category} contains a card from another category`);
    }
  }
});

test("resource navigation returns to category pages instead of homepage fragments", async () => {
  for (const file of ["assets/resource-nav.js", "plans/development-plan.html"]) {
    const content = await read(file);
    for (const category of categories) assert.ok(content.includes(`href="../${category}/"`));
    assert.doesNotMatch(content, /index\.html#(?:plans|labs|info)/);
  }
});

test("every local HTML asset and page link resolves, including fragments", async () => {
  for (const page of pages) {
    const html = await read(page);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const link = match[1];
      if (/^(https?:|data:|mailto:)/.test(link) || link.includes("${")) continue;
      const [target, fragment] = link.split("#");
      const path = target.split("?")[0];
      let destination = path ? resolve(dirname(resolve(root, page)), path) : resolve(root, page);
      if (path.endsWith("/")) destination = resolve(destination, "index.html");
      const content = await readFile(destination, "utf8");
      if (fragment && extname(destination) === ".html") {
        assert.ok(content.includes(`id="${fragment}"`) || content.includes(`id='${fragment}'`), `${page}: missing ${link}`);
      }
    }
  }
});

test("imported pages retain original controls and gain dashboard navigation", async () => {
  for (const page of resources.slice(1)) assert.match(await read(page), /src="\.\.\/assets\/resource-nav\.js\?v=2"/);
  const lab = await read("labs/pim-lab.html");
  assert.match(lab, /data-complete=/);
  assert.match(lab, /data-file=/);
  const roles = await read("info/entra-roles.html");
  assert.match(roles, /Global Administrator/);
  assert.match(roles, /type="search"/);
});

test("public roadmap retains six stages and exactly 25 distinct study items", async () => {
  const context = vm.createContext({});
  vm.runInContext(`${await read("assets/study-data.js")}\nglobalThis.result = {stages, studyItems};`, context);
  assert.equal(context.result.stages.length, 6);
  assert.equal(context.result.studyItems.length, 25);
  assert.equal(new Set(context.result.studyItems.map(item => item.key)).size, 25);
  for (const item of context.result.studyItems) assert.match(item.url, /^https:\/\/learn\.microsoft\.com\//);
});

test("published files exclude internal resources and active credentials", async () => {
  const publicFiles = [...pages, "404.html"];
  for (const name of await readdir(resolve(root, "assets"))) publicFiles.push(`assets/${name}`);
  for (const file of publicFiles) {
    const content = await read(file);
    assert.doesNotMatch(content, /eng\.ms\/|microsoft\.sharepoint\.com|teams\.microsoft\.com\/l\/channel|learningplayer\.microsoft|esxp\.microsoft|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/, file);
  }
});

test("deployment uses an explicit public-file allowlist", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  assert.match(workflow, /cp -R assets plans labs info _site\//);
  assert.match(workflow, /path: _site/);
  assert.match(await read(".gitignore"), /^\.private\/$/m);
});

test("all shipped JavaScript parses without a build step", async () => {
  for (const name of await readdir(resolve(root, "assets"))) {
    if (name.endsWith(".js")) new vm.Script(await read(`assets/${name}`), { filename: name });
  }
});

test("preview serves public resources but never private originals or repository files", async () => {
  const server = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const failures = [];
  server.stderr.on("data", data => failures.push(data.toString()));
  try {
    const output = await Promise.race([
      once(server.stdout, "data").then(([data]) => data.toString()),
      once(server, "exit").then(([code]) => { throw new Error(`Preview exited: ${code}; ${failures.join("")}`); })
    ]);
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, "Preview must report a usable URL.");
    for (const page of pages) assert.equal((await fetch(`${url}/${page}`)).status, 200, page);
    for (const file of [".private/identity-development-plan.html", ".git/config", "package.json", "scripts/import-sources.mjs", "missing.html"]) {
      assert.equal((await fetch(`${url}/${file}`)).status, 404, file);
    }
    assert.equal(failures.length, 0);
  } finally {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
});
