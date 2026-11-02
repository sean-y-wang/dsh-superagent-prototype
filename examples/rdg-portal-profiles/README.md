# Legacy: one profile per product repo

**Phase-1 default is a single instance** — see `examples/rdg-portal-single.cordis.patch.yml`
and [docs/011-rdg-portal-ops.md](../../docs/011-rdg-portal-ops.md).

These five overlays (`aihub-site`, `rdg-promotion-console`, `aihub-doc`, `aihub-service`,
`aihub-admin`) remain for operators who still want process isolation. Prefer the single
`stateDir=/var/dsh/rdg-portal` path unless you have a concrete reason to split.
