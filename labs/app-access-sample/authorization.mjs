export function accessDecision(claims, tenantId, now = Math.floor(Date.now() / 1000)) {
  if (!claims) return { status: 401, reason: "Sign in first." };
  if (claims.tid !== tenantId || !Number.isFinite(claims.exp) || claims.exp <= now) {
    return { status: 401, reason: "Wrong tenant or expired sign-in. Sign in again." };
  }
  if (!Array.isArray(claims.roles) || !claims.roles.includes("Lab.Reader")) {
    return { status: 403, reason: "Signed in, but the Lab.Reader app role is missing." };
  }
  return { status: 200, reason: "Lab.Reader access granted." };
}
