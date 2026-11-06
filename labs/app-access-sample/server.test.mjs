import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
import { accessDecision } from "./authorization.mjs";
import { createLabServer } from "./server.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
test("protected authorization rejects anonymous, wrong-tenant, expired and no-role identities", () => {
  const base = { tid: tenantId, exp: 2000, roles: ["Lab.Reader"] };
  assert.equal(accessDecision(null, tenantId, 1000).status, 401);
  assert.equal(accessDecision({ ...base, tid: "other" }, tenantId, 1000).status, 401);
  assert.equal(accessDecision({ ...base, exp: 1000 }, tenantId, 1000).status, 401);
  for (const exp of [undefined, "2000", NaN, Infinity]) {
    assert.equal(accessDecision({ ...base, exp }, tenantId, 1000).status, 401);
  }
  assert.equal(accessDecision({ ...base, roles: ["Lab.Observer"] }, tenantId, 1000).status, 403);
  assert.equal(accessDecision({ ...base, roles: undefined }, tenantId, 1000).status, 403);
  assert.equal(accessDecision({ ...base, roles: "Lab.Reader" }, tenantId, 1000).status, 403);
  assert.equal(accessDecision(base, tenantId, 1000).status, 200);
});

test("real OIDC library rejects bad state, nonce, audience, issuer, expiry and signature", async t => {
  let oidc;
  try {
    oidc = await import("openid-client");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    t.skip("Run npm ci in the sample folder to enable the real-library test; CI installs it.");
    return;
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const issuer = "https://identity.example.test/tenant/v2.0";
  const clientId = "sample-client";
  const now = Math.floor(Date.now() / 1000);
  const valid = { iss: issuer, aud: clientId, sub: "fixture-user", tid: tenantId, iat: now, exp: now + 3600, nonce: "nonce", roles: ["Lab.Reader"] };
  const jwt = (claims, key = privateKey) => {
    const encoded = [JSON.stringify({ alg: "RS256", kid: "fixture-key" }), JSON.stringify(claims)]
      .map(part => Buffer.from(part).toString("base64url")).join(".");
    return `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), key).toString("base64url")}`;
  };
  let idToken = jwt(valid);
  let exchanges = 0;
  const config = await oidc.discovery(new URL(issuer), clientId, "fixture-secret", undefined, {
    [oidc.customFetch]: async (input, options) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://identity.example.test", "Test traffic must remain inside the mocked provider.");
      if (url.pathname.endsWith("/.well-known/openid-configuration")) {
        return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] });
      }
      if (url.pathname.endsWith("/keys")) {
        return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" }] });
      }
      assert.ok(url.pathname.endsWith("/token"));
      const params = new URLSearchParams(options.body);
      assert.equal(params.get("code_verifier"), "verifier");
      assert.equal(params.get("client_secret"), "fixture-secret");
      exchanges++;
      return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken });
    }
  });
  oidc.enableNonRepudiationChecks(config);
  const grant = state => oidc.authorizationCodeGrant(config, new URL(`http://localhost:4300/callback?code=fixture-code&state=${state}`), {
    pkceCodeVerifier: "verifier", expectedState: "state", expectedNonce: "nonce"
  });
  assert.deepEqual((await grant("state")).claims().roles, ["Lab.Reader"]);
  const before = exchanges;
  await assert.rejects(grant("incorrect-state"));
  assert.equal(exchanges, before, "Wrong state must fail before the token exchange.");
  for (const changes of [{ nonce: "wrong" }, { aud: "another-app" }, { iss: "https://untrusted.example.test" }, { exp: now - 3600 }]) {
    idToken = jwt({ ...valid, ...changes });
    await assert.rejects(grant("state"));
  }
  idToken = jwt(valid, wrongKey);
  await assert.rejects(grant("state"));
});

test("HTTP sample uses checked OIDC flow, rotates sessions and enforces role on both resources", async () => {
  let claims = { tid: tenantId, exp: Math.floor(Date.now() / 1000) + 3600, roles: ["Lab.Reader"], name: "Lab user" };
  let expectedChecks;
  const oidc = {
    randomPKCECodeVerifier: () => "verifier",
    randomState: () => "state",
    randomNonce: () => "nonce",
    calculatePKCECodeChallenge: async () => "challenge",
    buildAuthorizationUrl: (_, params) => { assert.equal(params.code_challenge_method, "S256"); return new URL("https://example.com/authorize"); },
    authorizationCodeGrant: async (_, url, checks) => { expectedChecks = checks; assert.equal(url.pathname, "/callback"); return { claims: () => claims, access_token: "test-only" }; }
  };
  const server = createLabServer({ tenantId, config: {}, oidc, fetchGraph: async () => new Response(JSON.stringify({ displayName: "Lab user" })) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, cookie = "", extra = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method: extra.method || "GET", headers: { Host: "localhost:4300", Cookie: cookie, ...extra.headers } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
  try {
    assert.equal((await request("/protected")).status, 401);
    assert.equal((await request("/profile")).status, 401);
    const login = await request("/login");
    const loginCookie = login.headers.get("set-cookie").split(";")[0];
    const callback = await request("/callback?code=test&state=state", loginCookie);
    assert.deepEqual(expectedChecks, { pkceCodeVerifier: "verifier", expectedState: "state", expectedNonce: "nonce" });
    const signedIn = callback.headers.get("set-cookie").split(";")[0];
    assert.notEqual(signedIn, loginCookie);
    assert.equal((await request("/protected", signedIn)).status, 200);
    assert.equal((await request("/profile", signedIn)).status, 200);
    assert.equal((await request("/callback?code=replay", loginCookie)).status, 400);
    await request("/logout", signedIn);
    assert.equal((await request("/protected", signedIn)).status, 401);
    claims = { ...claims, roles: ["Lab.Observer"] };
    const observerLogin = await request("/login");
    const observerCallback = await request("/callback?code=test", observerLogin.headers.get("set-cookie").split(";")[0]);
    const observerCookie = observerCallback.headers.get("set-cookie").split(";")[0];
    assert.equal((await request("/protected", observerCookie)).status, 403);
    assert.equal((await request("/profile", observerCookie)).status, 403);
    assert.equal((await request("/", "", { headers: { Host: "untrusted.example" } })).status, 400);
    assert.equal((await request("/login", "", { method: "POST" })).status, 405);
  } finally {
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});
