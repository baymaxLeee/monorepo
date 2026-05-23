# 0003 Platform Register Route

## Status

Accepted

## Context

Platform owns authentication routes and shell routing. Registration previously
lived inside the login page tabs, which made `/register` unavailable as a stable
public route and made account-name validation depend on final form submission.

## Decision

Add `/register` as a platform-owned public route. Platform routes are registered
through a single router list that records each route's path, component, access
mode, and element. Pathless guard/layout routes render nested pages with
`Outlet`, so route matching stays declarative and the shell layout does not
manually render child route trees.

Add `GET /api/iam-server/account-availability?account=<name>` as a public IAM
check. The platform registration form maps `name` to IAM `account` and
`displayName`, validates the account format client-side, then checks
availability before submit.

The registration payload also accepts `avatarUrl` and `phoneNumber`, matching
the existing IAM user model fields.

## Consequences

- Public auth routes are now `/login` and `/register`.
- The API gateway public path list includes account availability checks.
- Account uniqueness is checked before submit, with the final register call still
  acting as the authoritative conflict guard.
