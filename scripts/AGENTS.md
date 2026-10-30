# Repository tooling

Root `justfile` is the public CLI; scripts implement it. Read
[README.md](README.md) for script ownership. Project discovery belongs in
`repository.mjs`; reuse manifests instead of adding package allowlists.

- Preserve argument boundaries with subprocess argument arrays. Read-only
  discovery/context commands must not execute package scripts or print env data.
- Missing/ambiguous owners and incomplete dependency information must not produce
  a falsely narrow affected selection. Keep conservative fallback tests.
- Test CLI behavior using temporary repositories and observable runner arguments,
  exit codes and output. Run `just test tooling`; changes to test infrastructure
  additionally require root `just test` per root policy.
- When changing shared script imports, update every affected CI path filter.
  Run `just check-repo` and root `just lint`. These Node scripts need no build.
