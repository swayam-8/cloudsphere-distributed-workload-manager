# Security boundary and remaining hardening

This is a single-operator development application. Multi-user ownership, SSO,
RBAC, rate limits, token rotation/revocation and audit retention remain pending.

Separate operator, enrollment and per-worker credentials protect application
routes. Health reveals readiness/mode only. Worker token digests never appear
in listing/detail endpoints. Browser authentication uses tab session storage;
HTTPS and an appropriate deployment CSP are required. Keep enrollment credentials
private. Configuration, artifacts and identity files are ignored/private.

Workers are trusted hosts: Docker daemon access is effectively host-root access.
Jobs receive no socket, credentials or network. Containers use UID 65534, dropped
capabilities, no-new-privileges, a read-only root, fixed image, bounded CPU/RAM/PIDs,
tmpfs and timeout. Input/config mounts are read-only. User code, shells and images
are never accepted. Patch the host/runtime and pin/scan images before deployment.

Authenticated uploads are capped at 10 MB. Templates verify parsing, CSV
columns/rows/groups, finite bounded numbers, image pixels, ZIP member counts
and expanded size. ZIP paths are never extracted. Output is bounded; CSV group
labels get formula guards. Extension validation alone does not claim safety.

Local MongoDB is unauthenticated but bound to 127.0.0.1, never a public/shared
deployment configuration. Use authenticated TLS MongoDB/Atlas, network isolation,
backups and multiple replica members for deployment. Local replication has no HA.

AWS uses the standard SDK credential chain and IAM roles, never frontend keys.
EC2 metadata during enrollment is trusted operator configuration, not signed
instance-identity attestation. Verify tags/worker mappings for demonstrations.

Artifact transfers use the authenticated backend in both modes, so workers need
no direct S3 permissions. Block public access, restrict the backend role's object
prefix, configure encryption and lifecycle retention. Unreferenced uploads and
metrics currently need manual retention maintenance; garbage collection is pending.
