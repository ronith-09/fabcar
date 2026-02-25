# BetweenNetwork Security Review

Date: 2026-02-15  
Scope: `fabric-samples/fabcar/javascript` API server + `fabric-samples/chaincode/fabcar/go/fabcar.go`

## 1) Security Controls Already Used

- Password hashing with `bcrypt` for new registrations (`fabric-samples/fabcar/javascript/fabric-server.js:1343`).
- JWT session tokens for authenticated API calls (`fabric-samples/fabcar/javascript/fabric-server.js:596`).
- Wallet-based X.509 identities (Hyperledger Fabric wallet) and chaincode-backed authorization.
- Identity anti-spoofing middleware that forces `userId` to authenticated caller (`fabric-samples/fabcar/javascript/fabric-server.js:166`).
- Some rate limiting and transfer deduplication controls (`fabric-samples/fabcar/javascript/fabric-server.js:248`).

## 2) Security Bugs / Gaps

## Critical

- Auth namespace exposed too broadly: every route under `/api/auth/*` is public because of `publicPrefixes` (`fabric-samples/fabcar/javascript/fabric-server.js:111`).  
  Impact: endpoints like `/api/auth/users` can be accessed without JWT.

- Role escalation at registration: client can submit `role` in `/api/auth/register` and it is accepted by `normalizeStoredRole` without authority check (`fabric-samples/fabcar/javascript/fabric-server.js:1341`, `fabric-samples/fabcar/javascript/fabric-server.js:547`).  
  Impact: user may self-register as `admin` or `bank`.

- `/api/auth/register-manual` accepts caller-provided `passwordHash` and returns non-JWT token format (`token-...`) (`fabric-samples/fabcar/javascript/fabric-server.js:1621`).  
  Impact: weak auth model and inconsistent trust boundary.

- Hardcoded JWT fallback secret: `process.env.JWT_SECRET || 'fabric-jwt-secret'` (`fabric-samples/fabcar/javascript/fabric-server.js:82`).  
  Impact: predictable secret if env is missing.

- Sensitive request logging: full request body is logged globally (`fabric-samples/fabcar/javascript/fabric-server.js:240`).  
  Impact: password/token/PII leak in logs.

- Chaincode admin check is too weak: `VerifyAdmin` only verifies MSP is not empty (`fabric-samples/chaincode/fabcar/go/fabcar.go:808`).  
  Impact: any valid org identity may pass admin checks.

## High

- Open CORS policy (`app.use(cors())`) allows all origins by default (`fabric-samples/fabcar/javascript/fabric-server.js:93`).  
  Impact: browser attack surface increases.

- Identity import endpoint has no explicit role gate (`/api/wallet/import-registration/:username`) (`fabric-samples/fabcar/javascript/fabric-server.js:1548`).  
  Impact: any authenticated user may import wallet identities unless blocked elsewhere.

- Legacy SHA-256 password fallback still accepted during login (`fabric-samples/fabcar/javascript/fabric-server.js:1723`).  
  Impact: weaker stored credentials remain valid.

## 3) Authority Model You Should Enforce

- `customer` role: only self data, self transfer history, self actions.
- `bank` role: only token-owner scoped data for owned token(s).
- `admin` role: platform-level operations only.
- Always enforce both:
  - API layer JWT role and ownership checks.
  - Chaincode layer MSP/attribute/owner checks.

## 4) Required Changes (Priority Order)

1. Lock public routes to exact allowlist only (`/api/auth/login`, `/api/auth/register` if needed, `/api/health`).
2. Remove public role selection. Force default `customer`; `bank/admin` assign only by secure admin flow.
3. Delete or strictly admin-protect `/api/auth/register-manual`.
4. Fail startup if `JWT_SECRET` is missing (no fallback secret).
5. Remove global request-body logging or redact fields (`password`, `token`, `authorization`, `networkAddress`).
6. Restrict CORS with explicit trusted origins and methods.
7. Enforce role checks on identity import endpoint.
8. Migrate all legacy SHA-256 password records to bcrypt and remove SHA fallback.
9. Strengthen chaincode `VerifyAdmin` to explicit MSP allowlist and/or Fabric attributes.

## 5) Data Privacy Rules (No One Sees Other Data)

- Never accept `userId`/`networkAddress` from client as authority input.
- Resolve actor from JWT + wallet identity only.
- For every read/write endpoint, enforce ownership filter before chaincode call and again in chaincode.
- Return minimal response fields (avoid exposing full customer IDs/network addresses unless required).
- Mask sensitive identifiers in logs and UI debug outputs.

## 6) Security Stack Order (as requested)

`Password policy/hash` -> `JWT/session security` -> `Wallet identity` -> `Role/ownership authorization` -> `Chaincode authorization` -> `Audit/log redaction`.

