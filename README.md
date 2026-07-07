# fsituations

`fsituations` is a LastDB app for current operational posture: active
situations, phase/set breakdowns, scope, links, and agent-facing preflight
policy.

It fills the gap between F-Brain and F-Kanban:

- F-Brain stores durable rationale and decisions.
- F-Kanban stores work items.
- F-Situations stores current shared reality that agents must respect before
  mutating shared systems.

## Commands

```bash
bun run src/cli.ts schema
bun run src/cli.ts init --schema-hash <loaded-fsituations-situation-hash>
bun run src/cli.ts put examples/forge-ci-containment.json
bun run src/cli.ts list
bun run src/cli.ts preflight --action enable-ci --repo EdgeVector/fold
```

`preflight` exits `0` when the action is allowed and `3` when an active
situation blocks the action or requires human clearance.

## Schema

The app owns `fsituations/Situation`. Print the schema payload with:

```bash
bun run src/cli.ts schema --json
```

The schema follows the same published-out-of-band pattern as F-Kanban: the CLI
does not register schemas itself. Publish/load the schema on the node, then run
`init` so the CLI records the canonical hash in `~/.fsituations/config.json`.
