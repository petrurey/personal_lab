import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { accessDecision } from "./authorization.mjs";

const origin = "http://localhost:4300";
const redirectUri = `${origin}/callback`;
const encode = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function createLabServer({ tenantId, config, oidc, fetchGraph = fetch }) {
  const sessions = new Map();
  const cookie = id => `app_lab=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900`;
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    const json = (status, body) => response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
    if (request.headers.host !== "localhost:4300") {
      json(400, { error: "Use http://localhost:4300, not another host or port." });
      return;
    }
    if (request.method !== "GET") {
      json(405, { error: "Only GET requests are supported." });
      return;
    }
    const url = new URL(request.url, origin);
    for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id);
    const id = /(?:^|;\s*)app_lab=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || "")?.[1];
    const session = sessions.get(id);
    try {
      if (url.pathname === "/login") {
        if (id) sessions.delete(id);
        const sid = randomBytes(32).toString("hex");
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        sessions.set(sid, { verifier, state, nonce, expires: Date.now() + 300_000 });
        const authorizationUrl = oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirectUri,
          scope: "openid profile https://graph.microsoft.com/User.Read",
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
          state, nonce, prompt: "select_account"
        });
        response.writeHead(302, { Location: authorizationUrl.href, "Set-Cookie": cookie(sid) }).end();
      } else if (url.pathname === "/callback") {
        if (!session?.verifier) {
          json(400, { error: "Missing or expired login transaction. Start a new sign-in." });
          return;
        }
        sessions.delete(id);
        const tokens = await oidc.authorizationCodeGrant(config, url, {
          pkceCodeVerifier: session.verifier, expectedState: session.state, expectedNonce: session.nonce
        });
        const claims = tokens.claims();
        if (!claims || claims.tid !== tenantId || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
          throw new Error("The validated ID token has the wrong tenant or has expired.");
        }
        const sid = randomBytes(32).toString("hex");
        sessions.set(sid, { claims, accessToken: tokens.access_token, expires: Math.min(Date.now() + 900_000, claims.exp * 1000) });
        response.writeHead(302, { Location: "/protected", "Set-Cookie": cookie(sid) }).end();
      } else if (url.pathname === "/protected" || url.pathname === "/profile") {
        const decision = accessDecision(session?.claims, tenantId);
        if (decision.status !== 200) {
          json(decision.status, { result: decision.reason });
          return;
        }
        if (url.pathname === "/profile") {
          const graph = await fetchGraph("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", {
            headers: { Authorization: `Bearer ${session.accessToken}` }
          });
          if (!graph.ok) {
            console.error("Graph /me failed with HTTP", graph.status);
            json(502, { error: "Graph /me failed. Check delegated User.Read consent and sign in again.", graphStatus: graph.status });
            return;
          }
          json(200, await graph.json());
        } else {
          json(200, { result: decision.reason, name: session.claims.name, tenant: session.claims.tid, roles: session.claims.roles });
        }
      } else if (url.pathname === "/logout") {
        if (id) sessions.delete(id);
        response.writeHead(302, { Location: "/", "Set-Cookie": "app_lab=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }).end();
      } else if (url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APP-ACCESS-LAB</title><body style="font:18px/1.6 system-ui;max-width:760px;margin:60px auto;padding:24px;color:#17243a;background:#f4f6fb"><h1>APP-ACCESS-LAB</h1><p>Account: ${encode(session?.claims?.name || "not signed in")}</p><p><a href="/login">Sign in / choose another account</a></p><p><a href="/protected">Test protected access</a> &middot; <a href="/profile">Call Graph /me</a> &middot; <a href="/logout">Clear local session</a></p><p>Loopback-only teaching sample. Logout clears this app session, not Microsoft's SSO session. Use separate browser profiles for comparison.</p></body></html>`);
      } else json(404, { error: "Page not found." });
    } catch (error) {
      console.error("App sign-in or request failed:", error.name, error.code || "validation_error");
      json(403, { error: "Sign-in could not be completed. Check assignment, consent, redirect URI and the Entra sign-in log. No protected data was returned." });
    }
  });
}

export async function start() {
  const { TENANT_ID, CLIENT_ID, CLIENT_SECRET } = process.env;
  const guid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  if (!guid.test(TENANT_ID || "") || !guid.test(CLIENT_ID || "") || !CLIENT_SECRET) {
    throw new Error("Set TENANT_ID and CLIENT_ID to lab GUIDs and CLIENT_SECRET to the lab-only secret value.");
  }
  const tenantId = TENANT_ID.toLowerCase();
  const oidc = await import("openid-client");
  const config = await oidc.discovery(new URL(`https://login.microsoftonline.com/${tenantId}/v2.0`), CLIENT_ID, CLIENT_SECRET);
  oidc.enableNonRepudiationChecks(config);
  createLabServer({ tenantId, config, oidc }).listen(4300, "127.0.0.1", () => console.log(`APP-ACCESS-LAB ready: ${origin}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(error => { console.error("Cannot start APP-ACCESS-LAB:", error.message); process.exitCode = 1; });
}
