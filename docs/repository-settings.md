# Repository settings

- visibility: public;
- default and production branch: `main`;
- direct pushes to `main`: allowed;
- force-push and branch deletion: forbidden;
- GitHub Actions workflow: build, deploy, one production smoke;
- merge policy: irrelevant to the normal direct-push flow.

The repository contains no credentials. Cloudflare credentials stay in GitHub
Actions secrets. Public history must never contain private reference material,
PDF/STL files, upstream XML exports or unapproved generated catalog data.
