# Sandbox execution service

Internal-only, stateless control plane for run-scoped Docker/gVisor containers and Kubernetes Pods. Chat owns the run and file publication. This service owns execution resources, deadlines and cleanup; it has no business database or model/provider credentials and never runs model commands on its host.

- Only authenticated Chat calls may create or access a sandbox. Every operation binds tenant, IAM workspace, user, conversation and run to the resource labels.
- Runtime images, network, mounts, limits and executable paths are operator configuration. The model cannot choose them. Never fall back to host execution or a less isolated runtime when provisioning fails.
- Host subprocesses use fixed executables and argv arrays. Commands reach Bash only inside the sandbox. No service environment is inherited by guest code. The only Docker mount is the read-only egress Unix socket directory; never mount business files or Docker sockets in guests.
- Run teardown and expiry delete compute, never conversation assets. No automatic retries of command submission; request IDs deduplicate an ambiguous response.
- File transfers reject symlinks and special files and are streamed with byte limits. Control sockets and execution metadata are inaccessible to guest users.
- Run `just test backend/sandbox`, `just build sandbox`, affected Chat/transport tests, and the real Docker integration check before reporting runtime behavior. A missing runtime or cluster is an unverified integration, not a passing test.
