# systemd units for RDG portal dsh-superagent

## Phase-1 default: single instance (multi-repo)

One process, one `stateDir` (`/var/dsh/rdg-portal`), all five product repos via
portal-feedback `source` → GitLab path routing (docs/011).

```sh
sudo cp deploy/systemd/dsh-superagent-rdg-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dsh-superagent-rdg-portal
```

Create `/etc/dsh/rdg-portal.env` with non-secret paths only (wrapper paths, `GITLAB_HOST`, brand).
Keep tokens in the wrappers or a root-only file the wrapper sources.

Profile overlay: `examples/rdg-portal-single.cordis.patch.yml`.

## Legacy: templated five instances

`dsh-superagent@.service` still supports one unit per product profile. Prefer the single
unit above unless you need process isolation.

```sh
sudo cp deploy/systemd/dsh-superagent@.service /etc/systemd/system/
sudo systemctl daemon-reload
for p in aihub-site rdg-promotion-console aihub-doc aihub-service aihub-admin; do
  sudo systemctl enable --now dsh-superagent@$p
done
```
