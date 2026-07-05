# ADR 0027: Platform ⟂ organization two-dimensional RBAC

## Status

Accepted. Supersedes the identity/tenancy decisions in
[ADR-0026](0026-oncall-agent-org-knowledge-sharing.md) that this ADR names
explicitly; builds on the edge-auth boundary of
[ADR-0002](0002-iam-auth-boundary.md); subsumes and closes the plan
`docs/plans/org-rbac-header-identity.md`.

## Context

ADR-0026 delivered the minimum multi-tenancy needed for the oncall agent:
`organizations` + `organization_members`, `org_id` on every admin/knowledge
resource, and org propagated as a trusted `X-Auth-Org-ID` edge header. It was
deliberately minimal and left four load-bearing decisions in a shape that does
not survive contact with real multi-user usage:

1. **Implicit "primary org".** Login/refresh resolved the caller's org by
   picking a `PrimaryOrgForUser` (effectively "the first membership"). The DB
   chose the tenant scope on the user's behalf — wrong the moment a user
   belongs to more than one org.
2. **A flat platform `admin` role next to `super_admin`.** Downstream services
   treated `{super_admin, admin}` as an equivalence class. A plain org-level
   admin capability and a platform-wide capability were conflated into one
   privilege-escalation path.
3. **Register had no usable waiting state.** A pending applicant could not use
   the product before approval, while unconditional admission to a business
   org would bypass that org's policy.
4. **Flat identity DTO** (`user.type: admin|normal`, flat `orgId/orgName`) and
   no org/member management API or UI at all — ADR-0026 explicitly deferred the
   org-switcher, org CRUD, and member-management UI.

The product requirement that forced the rework: **super_admin creates orgs and
may appoint/create org_admins; every user can immediately use the guest org,
while a business-org application remains unusable until an org_admin approves
it.** That is a membership *state machine* and two *orthogonal* authority
scopes — neither expressible in the ADR-0026 shape.

The demo phase permits destructive, non-backward-compatible change
(root `AGENTS.md` "Future-first" rule), so this is a direct refactor with no
compatibility shims.

## Decision

### 1. Two orthogonal authority dimensions, not a 3-level role enum

- **Platform role** lives in `user_roles`; the only platform role is
  `super_admin` (org lifecycle, platform-role management, the global `apps`
  registry, the full telemetry board). A normal user has *no* platform role.
- **Org role** is `organization_members.role ∈ {org_admin, member}`, effective
  only inside the caller's currently-active org.
- **Membership status** is `organization_members.status ∈
  {pending, active, rejected}`; only `active` can bind a session and reach org
  resources.

The legacy flat `admin` platform role is **deleted** (IAM migration
`v1.2.0.sql` drops its `user_roles` rows then the `roles` row); `IsAdmin` /
`requireAdmin` collapse to `IsSuperAdmin` / `requireSuperAdmin`, and the org
side gets a distinct `requireOrgAdmin(orgID)` that requires the actor to be an
**active `org_admin` of that org**, verified from the DB (never from a request
body or a stale JWT). A platform `super_admin` is deliberately *not*
auto-granted org-admin power (see §5).

### 2. Explicit active-org session (no implicit "first org")

`refresh_tokens` gains a nullable `active_org_id`: a session binds **exactly
one** active org. A user with several active memberships must choose explicitly
(`POST /session/active-org`, which re-verifies active membership, rotates the
refresh token, and re-signs the access token). Refresh carries the bound org
forward only while that membership is still `active`; a
revoked/downgraded/rejected membership drops the scope on the next refresh.
`PrimaryOrgForUser` is removed.

### 3. System guest org plus approval-based business organizations

Bootstrap guarantees one `system_managed/open` guest organization with stable
ID, slug, and system key `guest-org`, and the preconfigured super-admin as
owner. Every account atomically receives an `active/member` membership in this
org. `POST /register` may additionally take a target `orgId`, creating a
separate `member/pending` application:

```text
none ──apply──> pending ──approve──> active
                    └──reject──> rejected ──reapply──> pending
```

`approve` accepts only `pending`; `reject` keeps the row plus
reviewer/time/reason (so the user can reapply) rather than deleting it. Every
transition is a conditional update — a concurrent loser gets a conflict, never
last-write-wins.

The v1.3 migration constrains the system shape and uniquely keys the guest org;
bootstrap supplies the existence guarantee and backfills missing guest
memberships. The guest org is omitted from the application directory and its
owner/system policy cannot be changed through normal organization APIs.

### 4. Identity DTO, JWT, and gateway

`UserResponse` becomes `roles: string[]` + `activeOrg: Membership | null` +
`memberships: Membership[]`; the flat `type` / `orgId` / `orgName` fields and
the frontend `UserType` / `PlatformUserType` are deleted with no fallback. The
access JWT keeps platform `roles[]` and adds `org_role` (signed only when the
session is bound to a still-active membership). The gateway strips inbound
`X-Auth-Org-Role` and injects it from the verified token, exactly like the
other `X-Auth-*` headers.

Gateway public paths stay closed by default: only `GET /api/iam-server/orgs`
is public, via a **method-aware exact** match (not a prefix), so the register
page can list applyable orgs while `POST /orgs` and `/orgs/{id}/...` management
routes remain authenticated.

### 5. Org & member management (API + admin MFE)

The platform role is a **control plane**, not a standing god-mode over tenants.
This follows GitHub's enterprise-owner model — an enterprise owner manages
enterprise settings/members/policies but *"does not have access to organization
content by default … can gain access by joining any organization"* — and the
multi-tenant-SaaS least-privilege consensus (WorkOS/SuperTokens/Pigment: *"never
grant standing cross-tenant access"*; a platform operator acts inside a tenant
only via an explicit membership or an audited break-glass session). Concretely
`super_admin` gets no automatic write over an org's members or data:

- **super_admin — control plane, any org:** `POST /orgs` (org + first active
  org_admin/owner in one transaction; exactly one of an existing owner or an
  inline owner account — the caller is not auto-joined), `GET /orgs/admin`,
  `POST /orgs/{id}/admins`, `PUT /orgs/{id}/owner`, and platform-role
  assign/remove. It may additionally **read** any org's roster
  (`GET /orgs/{id}/members?status=`, guarded by `requireOrgViewer`) for
  oversight and to look up a user id for owner transfer or a platform-role
  grant — the enterprise "People" view. Reading the roster is metadata, not
  access to org business data.
- **active org_admin of that org only — org plane:** approve/reject and
  `PUT /orgs/{id}/members/{userId}/role` go through `requireOrgAdmin(orgID)`,
  which grants **no** super_admin bypass. To manage a specific org's members a
  super_admin must first become an active org_admin of it (appoint one via
  `POST /orgs/{id}/admins`, or be promoted). Org business data
  (knowledge/chat/config) likewise requires a session bound to the org — the
  platform role never reaches it.

The admin MFE gains Organizations, Members, and Platform-Roles pages, gated by
a shared `useAdminIdentity` hook (platform role + active org role). It mirrors
the split: a super_admin may browse any org's roster read-only, but the
approve/reject/role controls render only where the caller is an active
`org_admin` of its *active* org. Frontend gating is UX only; the backend
authorization is the security boundary and every `403` flows through the shared
API error path. The IAM client lives in `packages/api` and is exported from its
public entry — MFEs never fetch IAM directly.

### 6. Downstream authorization

`super_admin` (platform) and `org_admin` (org) are split in every service's
`AuthContext`. The global `apps` registry is writable only by `super_admin`
(and its single-row `get` visibility was reconciled with `list`). Knowledge
document deletion — single and batch — is `org_admin` (any doc in the org) or
the uploader (their own); a batch containing one forbidden item fails whole
(`403`), never partial-silent. Telemetry keeps the full board for `super_admin`
only. Chat conversations/messages/memories stay user-private with no org_admin
bypass; `X-Internal-Token` proves service identity only and never grants
cross-tenant authorization.

### 7. Invariants (enforced in transactions)

1. Every org keeps ≥1 `active/org_admin`.
2. `organizations.owner_user_id` must be an `active/org_admin` of that org; the
   owner can't be demoted via the role API (transfer first).
3. Owner transfer is one locked transaction: promote the new owner to
   `active/org_admin`, then repoint ownership.
4. The platform keeps ≥1 `super_admin`; revoking the last one is a conflict.
5. Member-state writes require an active `org_admin` of the URL org — **no**
   `super_admin` bypass — verified against the DB; `super_admin` gets only
   read-only roster oversight (`requireOrgViewer`).
6. All status transitions are conditional updates; concurrent losers conflict.

### 8. Audit

High-value IAM operations (bootstrap, org create, org-admin create, owner
transfer, member apply/approve/reject, member role change, active-org switch,
platform-role assign/remove) append
to an immutable `iam_audit_events` table:
`action / actor_user_id / target_user_id / org_id / before_json / after_json /
result / reason / trace_id / created_at`. Successful audit writes share the
business transaction, so an audit failure rolls back the mutation. Failed
attempts are recorded separately with a bounded background context. Writes
never store passwords, tokens, or credentials. IAM owns its append-only table
rather than writing cross-service into admin's DB.

## Consequences

- **Supersedes ADR-0026** on exactly these points: the implicit
  `PrimaryOrgForUser` selection (→ explicit active-org session), register
  auto-joining an ordinary org (→ guest-org active + optional pending
  application), the flat
  `type`/`orgId`/`orgName` identity DTO (→ roles + memberships + activeOrg), and
  the "no org-switcher / no org CRUD / no member-management UI" deferral (→ all
  three shipped). ADR-0026's org-scoping of knowledge/bots/scenes/intentions/
  providers and the trusted-header propagation remain in force.
- **Closes `docs/plans/org-rbac-header-identity.md`**: its Phase 1/2 (role in
  JWT → gateway `X-Auth-Roles` header, downstream role-based `is_admin`,
  removal of hard-coded email checks, admin write-gating, `/internal` header
  identity) are implemented; its Phase 3 (skills/mcps config storage) remains
  out of scope. That plan is marked superseded.
- **super_admin is control-plane-only over tenants** (grounded in GitHub
  Enterprise's enterprise-owner model and the multi-tenant-SaaS least-privilege
  consensus): it can create orgs, appoint the first admin, transfer owner, and
  read any roster, but member-state writes *and* org business data require an
  actual active `org_admin` membership in that org. This drops the earlier
  draft's standing super_admin bypass on member writes (`requireOrgAdmin` no
  longer short-circuits for `super_admin`; a read-only `requireOrgViewer` guards
  the roster). The only operational cost: a super_admin fixing an org must first
  appoint or become an `org_admin` there (`POST /orgs/{id}/admins`), which is
  itself audited — no silent cross-tenant member writes.
- Migrations are demo-phase destructive: IAM `v1.2.0.sql` backfills existing
  members to `active`, collapses legacy `owner/admin` org roles to `org_admin`,
  and removes the platform `admin` role and its assignments; `v1.3.0.sql` adds
  the constrained guest-org shape. No compatibility branch.
- Bootstrap runs before the IAM server starts in every environment, does not
  overwrite an existing credential, and production requires explicit
  super-admin credentials. Authorization-changing mutations revoke refresh
  sessions; the remaining signed access-token revocation window is bounded by
  the five-minute access-token TTL.
- Per ADR-0016, a post-implementation review pass was run after functional
  work: repo-wide greps for callers of every removed/renamed symbol
  (`PrimaryOrgForUser`, `IsAdmin`/`requireAdmin`, `adminRoleNames`,
  `createRole`, `UserType`/`PlatformUserType`, flat `user.orgId/orgName/type`)
  found no dangling references in either stack; `just lint` (backend) and the
  frontend typecheck are green; the gateway public-path change is documented in
  its `.env.example`. Full-stack `just up`/`just dev` smoke against shared local
  infra was intentionally not run in this pass.
