# systemd units for five RDG portal instances

On the intranet host (research / DEV only):

```sh
sudo cp deploy/systemd/dsh-superagent@.service /etc/systemd/system/
sudo systemctl daemon-reload
for p in aihub-site rdg-promotion-console aihub-doc aihub-service aihub-admin; do
  sudo systemctl enable --now dsh-superagent@$p
done
```

Create `/etc/dsh/<profile>.env` per instance with non-secret paths only (wrapper paths, `GITLAB_HOST`, brand). Keep tokens in the wrappers or a root-only file the wrapper sources.
