# LastGit home — situations (public dual-home)

| Role | Location |
|------|----------|
| **CR / CI / merge (agents)** | `lastdb:///situations` on code node |
| **Public source** | `https://github.com/EdgeVector/situations` (`origin`) |

## Why dual-home

LastGit is a **private** forge (your lastdbd). Open-source consumers cannot
clone `lastdb://`. GitHub stays the public mirror so `git clone`, stars, and
external browsing keep working.

## Workflow

1. Agents open CRs with `lastgit cr` (venue = `lastgit`).
2. Multi-repo forge runs `.lastgit/ci.sh` → `ci-required`.
3. Auto-merge updates LastGit `main`.
4. **Mirror:** `git push origin main` (or scheduled mirror) so GitHub matches.

## Pin

```bash
export LASTGIT_SOCKET=$HOME/.lastgit/code/data/folddb.sock
export LASTGIT_SCHEMA_MAP=$HOME/.lastgit/schema-map.json
```

`fsituations` is the same product (CLI alias); one git slug: `situations`.
