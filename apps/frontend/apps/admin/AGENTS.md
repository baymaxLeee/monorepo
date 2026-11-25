# Admin workspace configuration MFE

Admin owns workspace-scoped providers, Skills, integrations and application
configuration under `/platform/admin/*`. It does not expose an Agent assembly
surface; conversations select reasoning models and reuse workspace capabilities.

- This remote exposes only its relative `./routes` tree. It has no supported
  standalone page or status shell.
- Admin owns its second-column menu, sub-routes and local state. Platform discovers
  the route tree but does not know Admin business capabilities.
- Keep page-specific components and transforms with their route. Promote a
  component to `src/components/` only when unrelated Admin pages reuse it; promote
  across MFEs only to the matching public UI capability package.
- Use generated `@repo/api/admin` clients. Provider/Skill/application contract
  changes start at the backend owner and regenerate clients with root `just sync`.

Run `just test frontend/admin`, affected typechecks and the Admin build when routes,
federation exports or emitted assets change.
