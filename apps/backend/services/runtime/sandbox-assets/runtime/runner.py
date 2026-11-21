"""Trusted, root-owned supervisor inside an ephemeral sandbox, never on the host."""

import base64
import ctypes
import errno
import hashlib
import ipaddress
import json
import os
import pathlib
import pty
import resource
import select
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import suppress
from urllib.parse import urlsplit

DENIAL_SIGNATURES = (b"permission denied", b"operation not permitted", b"read-only file system")
BWRAP_FAILURE_SIGNATURES = (
    b"bwrap:",
    b"creating new namespace failed",
    b"namespace not permitted",
    b"sandbox hardening failed:",
)
SCMP_ACT_ALLOW = 0x7FFF0000
SCMP_ACT_ERRNO = 0x00050000
SCMP_CMP_NE = 1
SCMP_CMP_EQ = 4
SCMP_CMP_GE = 5
PR_SET_NO_NEW_PRIVS = 38


class ScmpArgCmp(ctypes.Structure):
    _fields_ = [
        ("arg", ctypes.c_uint),
        ("op", ctypes.c_int),
        ("datum_a", ctypes.c_uint64),
        ("datum_b", ctypes.c_uint64),
    ]


def command_seccomp_rules(mode):
    if mode not in ("restricted", "proxy"):
        raise ValueError("invalid command seccomp mode")
    rules = [
        (name, ())
        for name in (
            "ptrace",
            "process_vm_readv",
            "process_vm_writev",
            "request_key",
            "io_uring_setup",
            "io_uring_enter",
            "io_uring_register",
        )
    ]
    if mode == "restricted":
        rules.extend(
            (name, ())
            for name in (
                "connect",
                "accept",
                "accept4",
                "bind",
                "listen",
                "getpeername",
                "getsockname",
                "shutdown",
                "sendto",
                "sendmmsg",
                "recvmmsg",
                "getsockopt",
                "setsockopt",
            )
        )
        rules.extend(
            [
                ("socket", ((0, SCMP_CMP_NE, socket.AF_UNIX),)),
                ("socketpair", ((0, SCMP_CMP_NE, socket.AF_UNIX),)),
            ]
        )
    else:
        # libseccomp rejects two comparisons on the same argument in one rule,
        # so express Codex's `domain != INET && domain != INET6` rule as exact
        # denials for the complete Linux address-family range. Unknown values
        # in this bounded range remain denied as the kernel adds families.
        rules.extend(
            ("socket", ((0, SCMP_CMP_EQ, family),))
            for family in range(64)
            if family not in (socket.AF_INET, socket.AF_INET6)
        )
        rules.append(("socket", ((0, SCMP_CMP_GE, 64),)))
        rules.append(("socketpair", ((0, SCMP_CMP_NE, socket.AF_UNIX),)))
    return rules


def apply_command_seccomp(mode):
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))

    seccomp = ctypes.CDLL("libseccomp.so.2")
    seccomp.seccomp_init.argtypes = [ctypes.c_uint32]
    seccomp.seccomp_init.restype = ctypes.c_void_p
    seccomp.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    seccomp.seccomp_syscall_resolve_name.restype = ctypes.c_int
    seccomp.seccomp_rule_add_array.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
        ctypes.POINTER(ScmpArgCmp),
    ]
    seccomp.seccomp_rule_add_array.restype = ctypes.c_int
    seccomp.seccomp_load.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_load.restype = ctypes.c_int
    seccomp.seccomp_release.argtypes = [ctypes.c_void_p]
    seccomp.seccomp_release.restype = None

    context = seccomp.seccomp_init(SCMP_ACT_ALLOW)
    if not context:
        raise RuntimeError("libseccomp could not create a filter")
    deny = SCMP_ACT_ERRNO | errno.EPERM
    try:
        for name, conditions in command_seccomp_rules(mode):
            syscall = seccomp.seccomp_syscall_resolve_name(name.encode())
            if syscall < 0:
                raise RuntimeError(f"libseccomp does not know syscall {name}")
            comparisons = (ScmpArgCmp * len(conditions))(
                *(ScmpArgCmp(argument, operator, value, 0) for argument, operator, value in conditions)
            )
            result = seccomp.seccomp_rule_add_array(
                context,
                deny,
                syscall,
                len(conditions),
                comparisons if conditions else None,
            )
            if result < 0:
                raise OSError(-result, f"libseccomp rejected rule for {name}")
        result = seccomp.seccomp_load(context)
        if result < 0:
            raise OSError(-result, "libseccomp could not load the command filter")
    finally:
        seccomp.seccomp_release(context)


def normalized_host(value):
    value = value.strip().lower().rstrip(".")
    if not value or len(value) > 253 or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for char in value):
        raise ValueError("invalid sandbox network host")
    if value == "localhost" or value.endswith(".localhost") or value == "metadata.google.internal":
        raise ValueError("sandbox network target is not public")
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return value
    if not address.is_global:
        raise ValueError("sandbox network target is not public")
    return value


class CommandProxy:
    def __init__(self, policy, upstream):
        self.policy = policy
        self.upstream = upstream
        self.token = uuid.uuid4().hex
        self.violation = None
        self.lock = threading.Lock()
        owner = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                owner.handle(self.request)

        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler, bind_and_activate=True)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return f"http://sandbox:{self.token}@127.0.0.1:{self.server.server_address[1]}"

    def deny(self, connection, host, port, protocol):
        with self.lock:
            self.violation = {"type": "network", "host": host, "port": port, "protocol": protocol}
        connection.sendall(b"HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")

    def handle(self, connection):
        connection.settimeout(10)
        data = bytearray()
        while b"\r\n\r\n" not in data:
            chunk = connection.recv(4096)
            if not chunk:
                return
            data.extend(chunk)
            if len(data) > 65536:
                return
        head, tail = bytes(data).split(b"\r\n\r\n", 1)
        lines = head.split(b"\r\n")
        try:
            method, target, version = lines[0].decode("ascii").split(" ", 2)
            headers = {}
            forwarded = []
            for line in lines[1:]:
                name, value = line.split(b":", 1)
                key = name.decode("ascii").lower()
                headers[key] = value.strip().decode("latin1")
                if key != "proxy-authorization":
                    forwarded.append(line)
            expected = "Basic " + base64.b64encode(f"sandbox:{self.token}".encode()).decode()
            if headers.get("proxy-authorization") != expected:
                self.deny(connection, "unauthorized.invalid", 80, "http")
                return
            if method.upper() == "CONNECT":
                host_text, port_text = target.rsplit(":", 1)
                port, protocol = int(port_text), "https"
            else:
                parsed = urlsplit(target)
                host_text = parsed.hostname or headers.get("host", "").split(":", 1)[0]
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                protocol = "https" if parsed.scheme == "https" else "http"
            try:
                host = normalized_host(host_text)
            except ValueError:
                self.deny(connection, host_text.lower().rstrip(".") or "invalid", port, protocol)
                return
            allowed = self.policy["type"] == "enabled" or host in self.policy.get("allowed_hosts", [])
            if not allowed or not 1 <= port <= 65535:
                self.deny(connection, host, port, protocol)
                return
            with socket.socket(socket.AF_UNIX) as upstream:
                upstream.settimeout(10)
                upstream.connect(self.upstream)
                upstream.sendall(
                    b"\r\n".join([f"{method} {target} {version}".encode(), *forwarded]) + b"\r\n\r\n" + tail
                )
                sockets = [connection, upstream]
                while sockets:
                    readable, _, _ = select.select(sockets, [], [], 30)
                    if not readable:
                        return
                    for source in readable:
                        chunk = source.recv(16384)
                        if not chunk:
                            return
                        (upstream if source is connection else connection).sendall(chunk)
        except OSError, UnicodeError, ValueError:
            with suppress(OSError):
                connection.sendall(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


def bwrap_argv(request, root, uid, gid, pids):
    sandbox = request["sandbox"]
    profile = sandbox["permission_profile"]
    if not sandbox["sandboxed"]:
        if profile["type"] != "disabled":
            raise RuntimeError("sandbox bypass requires a disabled permission profile")
        return [
            sys.executable,
            "-I",
            str(pathlib.Path(__file__).resolve()),
            "guest",
            str(pids),
            "none",
            request["command"],
        ]
    if profile["type"] != "managed":
        raise RuntimeError("cloud executor cannot enforce the requested permission profile")
    bwrap = "/usr/bin/bwrap"
    if not pathlib.Path(bwrap).is_file():
        raise RuntimeError("bubblewrap is unavailable")
    file_system = profile["file_system"]
    priority = {"read": 0, "write": 1, "deny": 2}
    entries = []
    root_access = "write" if file_system["type"] == "unrestricted" else "read"
    if file_system["type"] == "restricted":
        for entry in file_system["entries"]:
            path = pathlib.Path(entry["path"])
            if not path.is_absolute() or "\x00" in entry["path"]:
                raise RuntimeError("permission profile contains an invalid path")
            normalized = pathlib.Path(os.path.normpath(path))
            normalized_entry = {**entry, "path": str(normalized)}
            entries.append(normalized_entry)
            if normalized == pathlib.Path("/") and priority[entry["access"]] > priority[root_access]:
                root_access = entry["access"]
        if root_access == "deny":
            raise RuntimeError("permission profile cannot deny the sandbox root")
        entries.sort(
            key=lambda entry: (len(pathlib.PurePosixPath(entry["path"]).parts), priority[entry["access"]]),
        )
    argv = [
        bwrap,
        "--die-with-parent",
        "--new-session",
        "--unshare-user",
        "--uid",
        str(uid),
        "--gid",
        str(gid),
        "--unshare-pid",
        "--unshare-uts",
        "--unshare-ipc",
        "--cap-drop",
        "ALL",
        "--bind" if root_access == "write" else "--ro-bind",
        "/",
        "/",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--bind",
        "/tmp",
        "/tmp",
    ]
    if file_system["type"] == "restricted":
        writable_paths = [pathlib.Path(entry["path"]) for entry in entries if entry["access"] == "write"]
        for entry in entries:
            normalized = pathlib.Path(entry["path"])
            # Root authority is installed once as the base mount before the
            # fresh procfs, devfs and writable /tmp. Repeating any root bind here
            # would cover those safer, more specific mounts again.
            if normalized == pathlib.Path("/"):
                continue
            if not normalized.exists():
                if entry["access"] == "deny" and any(normalized.is_relative_to(root) for root in writable_paths):
                    raise RuntimeError(f"denied sandbox path does not exist: {normalized}")
                continue
            if entry["access"] == "write":
                argv.extend(["--bind", str(normalized), str(normalized)])
            elif entry["access"] == "read":
                argv.extend(["--ro-bind", str(normalized), str(normalized)])
            elif normalized.is_dir():
                argv.extend(["--tmpfs", str(normalized)])
            else:
                argv.extend(["--ro-bind", "/dev/null", str(normalized)])
    network = profile["network"]
    network_mode = "proxy" if network["type"] == "enabled" or network["allowed_hosts"] else "restricted"
    if network_mode == "restricted":
        argv.append("--unshare-net")
    argv.extend(
        [
            "--chdir",
            request.get("workdir") or str(root),
            "--",
            sys.executable,
            "-I",
            str(pathlib.Path(__file__).resolve()),
            "guest",
            str(pids),
            network_mode,
            request["command"],
        ]
    )
    return argv


def safe_open(root, name, *, write=False, owner=None):
    parts = pathlib.PurePosixPath(name).parts
    if not parts or name.startswith("/") or any(p in ("..", ".") for p in parts):
        raise ValueError("file path must be relative to the workspace")
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if write:
                with suppress(FileExistsError):
                    os.mkdir(part, mode=0o755, dir_fd=directory)
                if owner is not None:
                    os.chown(part, *owner, dir_fd=directory, follow_symlinks=False)
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        flags = os.O_NOFOLLOW | os.O_NONBLOCK | (os.O_WRONLY | os.O_CREAT if write else os.O_RDONLY)
        fd = os.open(parts[-1], flags, 0o644, dir_fd=directory)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd)
            raise ValueError("only regular, unlinked workspace files may be transferred")
        if write:
            os.ftruncate(fd, 0)
            if owner is not None:
                os.fchown(fd, *owner)
        return fd
    finally:
        os.close(directory)


def sha256_fd(fd):
    digest = hashlib.sha256()
    position = os.lseek(fd, 0, os.SEEK_CUR)
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        digest.update(chunk)
    os.lseek(fd, position, os.SEEK_SET)
    return digest.hexdigest()


def safe_unlink(root, name, expected_sha256):
    fd = safe_open(root, name)
    try:
        before = os.fstat(fd)
        if sha256_fd(fd) != expected_sha256:
            raise ValueError("file changed; reread it before deleting")
    finally:
        os.close(fd)
    parts = pathlib.PurePosixPath(name).parts
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        current = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError("file changed during delete")
        os.unlink(parts[-1], dir_fd=directory)
    finally:
        os.close(directory)


class Output:
    def __init__(self, limit):
        self.limit = limit
        self.data = bytearray()
        self.base = 0

    def append(self, chunk):
        self.data.extend(chunk)
        excess = max(0, len(self.data) - self.limit)
        if excess:
            del self.data[:excess]
            self.base += excess

    def read(self, offset, binary):
        end = self.base + len(self.data)
        if offset < 0 or offset > end:
            raise ValueError("invalid output cursor")
        data = bytes(self.data[max(0, offset - self.base) :])
        payload = base64.b64encode(data).decode("ascii") if binary else data.decode("utf-8", errors="replace")
        return payload, end, offset < self.base


class Process:
    def __init__(self, request, root, uid, gid, output_limit, max_timeout, expire, pids):
        self.id = uuid.uuid4().hex
        self.request = {
            k: request.get(k)
            for k in (
                "command",
                "workdir",
                "env",
                "tty",
                "binary_io",
                "pipe_stdin",
                "timeout_ms",
                "sandbox",
                "violation_hint",
            )
        }
        self.condition = threading.Condition()
        self.stdin_lock = threading.Lock()
        self.writes = {}
        self.stdout = Output(output_limit)
        self.stderr = Output(output_limit)
        self.termination = None
        self.expire = expire
        self.pty_fd = None
        self.process = None
        self.proxy = None
        workdir = request.get("workdir") or "/workspace"
        relative = pathlib.PurePosixPath(workdir).relative_to("/workspace")
        cwd = (root / str(relative)).resolve()
        if not cwd.is_relative_to(root.resolve()) or not cwd.is_dir():
            raise ValueError("workdir must be an existing workspace directory")
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": str(root / ".home"),
            "LANG": "C.UTF-8",
            "TERM": "xterm-256color",
            "PYTHONUNBUFFERED": "1",
        }
        protected_env = {
            "HOME",
            "PATH",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "http_proxy",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
            "NO_PROXY",
            "no_proxy",
        }
        for key, value in (request.get("env") or {}).items():
            if key in protected_env or key.startswith(("LD_", "DYLD_")):
                continue
            env[key] = value
        sandbox = request.get("sandbox")
        if not isinstance(sandbox, dict):
            raise ValueError("sandbox attempt is required")
        profile = sandbox.get("permission_profile")
        if not isinstance(profile, dict):
            raise ValueError("permission profile is required")
        network = profile.get("network") if profile.get("type") in ("managed", "external") else None
        if sandbox.get("sandboxed") and network and (network.get("type") == "enabled" or network.get("allowed_hosts")):
            upstream = os.environ.get("SANDBOX_PROXY_SOCKET")
            if not upstream:
                self.finish_start_error("sandbox-unavailable", "sandbox network broker is unavailable")
                return
            try:
                if network.get("type") == "restricted":
                    network = {**network, "allowed_hosts": [normalized_host(host) for host in network["allowed_hosts"]]}
                self.proxy = CommandProxy(network, upstream)
                for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
                    env[key] = self.proxy.url
                env["NO_PROXY"] = env["no_proxy"] = ""
            except (OSError, ValueError) as error:
                self.finish_start_error("sandbox-unavailable", f"sandbox network broker failed: {error}")
                return
        options = {"cwd": cwd, "env": env, "start_new_session": True}
        try:
            argv = bwrap_argv(request, root, uid, gid, pids)
        except RuntimeError as error:
            if self.proxy:
                self.proxy.close()
            self.finish_start_error("sandbox-unavailable", str(error))
            return
        # Enter bubblewrap as the workspace owner so its user namespace maps
        # outer UID 1000 to inner UID 1000. Starting bwrap as root would leave
        # the workspace owner unmapped and make the authorized bind read-only.
        if os.getuid() == 0:
            options.update(user=uid, group=gid, extra_groups=[])
        if request.get("tty"):
            master, slave = pty.openpty()
            self.pty_fd = master
            try:
                self.process = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, **options)
            except BaseException as error:
                os.close(master)
                if self.proxy:
                    self.proxy.close()
                self.finish_start_error("start-error", str(error))
                return
            finally:
                os.close(slave)
            readers = [(master, self.stdout)]
        else:
            try:
                pipe = not request.get("binary_io") or request.get("pipe_stdin")
                self.process = subprocess.Popen(
                    argv,
                    stdin=subprocess.PIPE if pipe else subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    **options,
                )
            except BaseException as error:
                if self.proxy:
                    self.proxy.close()
                self.finish_start_error("start-error", str(error))
                return
            readers = [(self.process.stdout.fileno(), self.stdout), (self.process.stderr.fileno(), self.stderr)]
        self.readers = [threading.Thread(target=self.collect, args=pair, daemon=True) for pair in readers]
        for thread in self.readers:
            thread.start()
        timeout = min(max_timeout, request.get("timeout_ms", 120000)) / 1000
        self.waiter = threading.Thread(target=self.wait, args=(timeout,), daemon=True)
        self.waiter.start()

    def finish_start_error(self, kind, message):
        self.termination = {"type": kind, "message": message[:4096] or kind}
        self.readers = []
        self.waiter = threading.Thread(target=lambda: None, daemon=True)
        self.waiter.start()

    def collect(self, fd, output):
        while True:
            try:
                chunk = os.read(fd, 16384)
            except OSError:
                break
            if not chunk:
                break
            with self.condition:
                output.append(chunk)

    def kill(self):
        # The leader can already be a zombie when the final cleanup races its
        # successful timeout kill. macOS may report EPERM for that dead process
        # group instead of ESRCH; cleanup is already complete in that state.
        if self.process is not None:
            with suppress(ProcessLookupError, PermissionError):
                os.killpg(self.process.pid, signal.SIGKILL)

    def wait(self, timeout):
        try:
            code = self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.kill()
            # A managed command has a private PID namespace with a parent-death signal.
            # Bypassed commands share the guest namespace and require guest-wide cleanup.
            if not self.request["sandbox"]["sandboxed"]:
                self.expire()
            code = self.process.wait()
            termination = {"type": "timeout", "timeout_ms": int(timeout * 1000)}
        finally:
            # A completed shell must not leave descendants holding pipes or running
            # without a live session. Long-lived programs run as foreground commands.
            self.kill()
        for reader in self.readers:
            reader.join(timeout=2)
        if self.pty_fd is not None:
            os.close(self.pty_fd)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream:
                stream.close()
        stderr = bytes(self.stderr.data).lower()
        if "termination" not in locals():
            if code != 0 and any(signature in stderr for signature in BWRAP_FAILURE_SIGNATURES):
                termination = {
                    "type": "sandbox-unavailable",
                    "message": bytes(self.stderr.data).decode("utf-8", errors="replace")[:4096] or "bubblewrap failed",
                }
            else:
                violation = self.proxy.violation if self.proxy else None
                hint = self.request.get("violation_hint")
                network_error = any(
                    signature in stderr
                    for signature in (
                        b"could not resolve",
                        b"failed to connect",
                        b"network is unreachable",
                        b"proxy connect aborted",
                    )
                )
                if code != 0 and not violation and hint and hint.get("type") == "network" and network_error:
                    violation = hint
                if code != 0 and not violation and any(signature in stderr for signature in DENIAL_SIGNATURES):
                    denied = next(
                        (
                            entry
                            for entry in self.request["sandbox"]["permission_profile"]
                            .get("file_system", {})
                            .get("entries", [])
                            if entry["access"] == "deny" and entry["path"].encode() in stderr
                        ),
                        None,
                    )
                    violation = {
                        "type": "file-system",
                        "operation": "read" if denied else "write",
                        "path": denied["path"] if denied else self.request.get("workdir") or "/workspace",
                    }
                termination = (
                    {"type": "sandbox-violation", "violation": violation}
                    if violation
                    else {"type": "exit", "exit_code": code}
                )
        if self.proxy:
            self.proxy.close()
        with self.condition:
            self.termination = termination
            self.condition.notify_all()

    def snapshot(self, request):
        with self.condition:
            self.condition.wait_for(
                lambda: self.termination is not None, timeout=min(10000, request.get("yield_time_ms", 0)) / 1000
            )
            binary = self.request["binary_io"]
            out, out_cursor, out_truncated = self.stdout.read(request.get("stdout_offset", 0), binary)
            err, err_cursor, err_truncated = self.stderr.read(request.get("stderr_offset", 0), binary)
            return {
                "session_id": self.id,
                "stdout": out,
                "stderr": err,
                "termination": self.termination,
                "stdout_offset": out_cursor,
                "stderr_offset": err_cursor,
                "stdout_truncated": out_truncated,
                "stderr_truncated": err_truncated,
                "truncated": out_truncated or err_truncated,
            }

    def write(self, request):
        chars = request.get("chars", "")
        binary = request.get("stdin_base64")
        eof = request.get("close_stdin", False)
        if not chars and binary is None and not eof:
            return
        if (binary is not None or eof) and (
            not self.request["pipe_stdin"] or self.pty_fd is not None or chars or (eof and binary is not None)
        ):
            raise ValueError("invalid binary stdin operation")
        data = base64.b64decode(binary, validate=True) if binary is not None else chars.encode()
        key = request["request_id"]
        identity = (eof, binary is not None, hashlib.sha256(data).digest())
        with self.stdin_lock:
            if key in self.writes:
                previous, complete = self.writes[key]
                if previous != identity:
                    raise ValueError("stdin request ID was reused with different input")
                if not complete:
                    raise ValueError("previous stdin write failed; input may have been partially delivered")
                return
            if self.termination is not None:
                raise ValueError("process already exited")
            # Mark before writing: an ambiguous/partial write must never be replayed.
            self.writes[key] = (identity, False)
            if eof:
                self.process.stdin.close()
            elif chars == "\x03":
                os.killpg(self.process.pid, signal.SIGINT)
            else:
                if self.pty_fd is None and self.process.stdin is None:
                    raise ValueError("process stdin is closed")
                fd = self.pty_fd if self.pty_fd is not None else self.process.stdin.fileno()
                deadline = time.monotonic() + 5
                while data:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("stdin did not drain; input was not retried")
                    _, ready, _ = select.select([], [fd], [], 0.1)
                    if ready:
                        data = data[os.write(fd, data[:1024]) :]
            self.writes[key] = (identity, True)


class Runtime:
    def __init__(
        self,
        root,
        *,
        uid=1000,
        gid=1000,
        output_limit=65536,
        max_timeout=1800000,
        max_processes=64,
        pids=0,
        workspace_edit_wait=10,
    ):
        self.root = pathlib.Path(root)
        self.uid, self.gid = uid, gid
        self.output_limit, self.max_timeout, self.max_processes = output_limit, max_timeout, max_processes
        self.processes, self.requests = OrderedDict(), {}
        self.lock = threading.Lock()
        self.closed = False
        self.workspace_edit = None
        self.workspace_edit_wait = workspace_edit_wait
        self.pids = pids
        (self.root / ".home").mkdir(exist_ok=True)
        if os.getuid() == 0:
            os.chown(self.root / ".home", uid, gid)

    def request(self, request):
        op = request["op"]
        if op == "health":
            return {"ready": not self.closed}
        if op == "snapshot":
            self.close(reject_workspace_edit=True)
            return {"files": workspace_files(self.root)}
        if op == "begin_workspace_edit":
            with self.lock:
                if self.closed:
                    raise ValueError("sandbox is closing")
                token = request["token"]
                if self.workspace_edit not in (None, token):
                    raise ValueError("workspace edit already in progress")
                self.workspace_edit = token
            deadline = time.monotonic() + self.workspace_edit_wait
            while True:
                with self.lock:
                    if not any(process.termination is None for process in self.processes.values()):
                        return {"token": token}
                    if time.monotonic() >= deadline:
                        if self.workspace_edit == token:
                            self.workspace_edit = None
                        raise ValueError("workspace has an active process")
                time.sleep(0.05)
        if op == "end_workspace_edit":
            with self.lock:
                token = request["token"]
                if self.workspace_edit not in (None, token):
                    raise ValueError("workspace edit token mismatch")
                self.workspace_edit = None
            return {"released": True}
        if op == "start":
            with self.lock:
                key = request["request_id"]
                if key in self.requests:
                    process = self.processes.get(self.requests[key])
                    if process is None:
                        raise ValueError("command result has expired")
                    self.processes.move_to_end(process.id)
                    if process.request != {k: request.get(k) for k in process.request}:
                        raise ValueError("command request ID was reused with different input")
                else:
                    if self.closed:
                        raise ValueError("sandbox is closing")
                    if self.workspace_edit is not None:
                        raise ValueError("workspace edit in progress")
                    if len(self.processes) >= self.max_processes:
                        expired = next((p.id for p in self.processes.values() if p.termination is not None), None)
                        if expired is None:
                            raise ValueError("sandbox command capacity exceeded")
                        # Keep the start request identity until guest teardown. Losing output must
                        # never cause a retried command to run twice.
                        del self.processes[expired]
                    process = Process(
                        request,
                        self.root,
                        self.uid,
                        self.gid,
                        self.output_limit,
                        self.max_timeout,
                        self.expire,
                        self.pids,
                    )
                    self.processes[process.id] = process
                    self.requests[key] = process.id
        else:
            with self.lock:
                process = self.processes.get(request.get("session_id"))
                if process is None:
                    raise ValueError("unknown process session")
                self.processes.move_to_end(process.id)
            if op == "write":
                process.write(request)
            elif op == "cancel":
                process.kill()
            elif op != "poll":
                raise ValueError("unsupported operation")
        return process.snapshot(request)

    def close(self, *, reject_workspace_edit=False):
        with self.lock:
            if reject_workspace_edit and self.workspace_edit is not None:
                raise ValueError("workspace edit in progress")
            self.closed = True
            processes = list(self.processes.values())
        for process in processes:
            process.kill()
        for process in processes:
            process.waiter.join(timeout=5)

    def expire(self):
        with self.lock:
            self.closed = True
        if os.getpid() == 1 and sys.platform == "linux":
            # Signal every guest-owned process in this PID namespace, including
            # setsid/double-fork descendants. The root supervisor retains bounded
            # output for collection; guest code cannot change UID or signal root.
            try:
                subprocess.run(
                    [sys.executable, "-I", "-c", "import os,signal; os.kill(-1,signal.SIGKILL)"],
                    user=self.uid,
                    group=self.gid,
                    extra_groups=[],
                    env={"PATH": "/usr/bin:/bin"},
                    timeout=2,
                    check=True,
                )
            except BaseException:
                os._exit(124)


def workspace_files(root):
    """Return a stable business-file manifest after all writers have stopped."""
    root = pathlib.Path(root)
    result = []
    for directory, names, filenames in os.walk(root, topdown=True, followlinks=False):
        current = pathlib.Path(directory)
        if current == root:
            names[:] = [name for name in names if name not in {".home", "sources"}]
        for name in [*names, *filenames]:
            info = (current / name).lstat()
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise ValueError("workspace contains a symlink or special file")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise ValueError("workspace contains a multiply-linked file")
        for name in filenames:
            path = current / name
            digest = hashlib.sha256()
            size = 0
            with path.open("rb") as file:
                while chunk := file.read(65536):
                    size += len(chunk)
                    digest.update(chunk)
            result.append({"path": path.relative_to(root).as_posix(), "size": size, "sha256": digest.hexdigest()})
    result.sort(key=lambda item: item["path"].encode("utf-8"))
    return result


SOCKET = "/run/control/runner.sock"


def serve():
    root = pathlib.Path("/workspace")
    root.mkdir(exist_ok=True)
    # Set permissions while root still owns the directory: the runtime drops CAP_FOWNER.
    os.chmod(root, 0o755)
    os.chown(root, 1000, 1000)
    for directory in (root / "work", root / "outputs", root / ".home"):
        directory.mkdir(exist_ok=True)
        os.chown(directory, 1000, 1000)
    # Source attachments are imported by the trusted transfer helper and remain
    # read-only. The rest of /workspace is the stable writable business tree.
    (root / "sources").mkdir(exist_ok=True)
    runtime = Runtime(
        root,
        output_limit=int(os.environ.get("OUTPUT_BYTES", "65536")),
        max_timeout=int(os.environ.get("COMMAND_TIMEOUT_MS", "1800000")),
        max_processes=int(os.environ.get("MAX_COMMANDS", "64")),
        pids=int(os.environ.get("PIDS_LIMIT", "128")),
    )
    pathlib.Path(SOCKET).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(pathlib.Path(SOCKET).parent, 0o700)
    # Deadline enforcement survives manager/Chat loss. Exiting PID 1 terminates
    # the entire container, including setsid/double-forked guest processes.
    deadline = threading.Timer(int(os.environ.get("SANDBOX_TTL_SECONDS", "1800")), lambda: os._exit(124))
    deadline.daemon = True
    deadline.start()

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            try:
                data = self.rfile.readline(262145)
                if len(data) > 262144:
                    raise ValueError("request too large")
                result = runtime.request(json.loads(data))
                self.wfile.write(json.dumps({"result": result}).encode() + b"\n")
            except Exception as error:
                self.wfile.write(json.dumps({"error": str(error)}).encode() + b"\n")

    with socketserver.ThreadingUnixStreamServer(SOCKET, Handler) as server:
        server.daemon_threads = True

        def stop(_signum, _frame):
            runtime.close()
            os._exit(0)

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.serve_forever()


def main():
    if len(sys.argv) == 1:
        serve()
    elif sys.argv[1] == "guest":
        pids = int(sys.argv[2])
        if pids:
            resource.setrlimit(resource.RLIMIT_NPROC, (pids, pids))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if sys.argv[3] != "none":
            try:
                apply_command_seccomp(sys.argv[3])
            except Exception as error:
                print(f"sandbox hardening failed: {error}", file=sys.stderr, flush=True)
                raise SystemExit(125) from error
        os.execv("/bin/bash", ["bash", "--noprofile", "--norc", "-c", sys.argv[4]])
    elif sys.argv[1] == "request":
        data = sys.stdin.buffer.read(262145)
        if len(data) > 262144:
            raise ValueError("request too large")
        with socket.socket(socket.AF_UNIX) as client:
            client.settimeout(20)
            client.connect(SOCKET)
            client.sendall(data + b"\n")
            with client.makefile("rb") as stream:
                sys.stdout.buffer.write(stream.readline(1048576))
    elif sys.argv[1] == "delete":
        _, name, expected_sha256 = sys.argv[1:4]
        safe_unlink(pathlib.Path("/workspace"), name, expected_sha256)
    elif sys.argv[1] in ("read", "write", "stat"):
        operation, name, limit = sys.argv[1:4]
        limit = int(limit)
        mode = sys.argv[4] if operation == "write" and len(sys.argv) > 4 else "upsert"
        expected_sha256 = sys.argv[5] if operation == "write" and len(sys.argv) > 5 else "-"
        if mode not in ("upsert", "create", "overwrite"):
            raise ValueError("invalid file write mode")
        if mode == "overwrite" and (
            len(expected_sha256) != 64 or any(c not in "0123456789abcdef" for c in expected_sha256)
        ):
            raise ValueError("conditional overwrite requires expected SHA-256")
        root = pathlib.Path("/workspace")
        if operation == "write" and (name == ".home" or name.startswith(".home/")):
            raise ValueError("imports cannot target runtime state")
        temporary = (
            str(pathlib.PurePosixPath(name).with_name(".upload-" + uuid.uuid4().hex)) if operation == "write" else None
        )
        writable_guest_file = not name.startswith("sources/")
        fd = safe_open(
            root,
            temporary or name,
            write=operation == "write",
            owner=(1000, 1000) if writable_guest_file else None,
        )
        with os.fdopen(fd, "wb" if operation == "write" else "rb") as file:
            before = os.fstat(file.fileno())
            if operation == "stat":
                size = os.fstat(file.fileno()).st_size
                if size > limit:
                    raise ValueError("file exceeds transfer limit")
                print(json.dumps({"size": size}))
                return
            source, destination = (sys.stdin.buffer, file) if operation == "write" else (file, sys.stdout.buffer)
            total = 0
            while True:
                if operation == "write":
                    header = source.read(4)
                    if len(header) != 4:
                        raise ValueError("file import ended before commit")
                    size = struct.unpack("!I", header)[0]
                    if size == 0:
                        break
                    if size > 65536:
                        raise ValueError("invalid file transfer frame")
                    chunk = source.read(size)
                    if len(chunk) != size:
                        raise ValueError("incomplete file transfer frame")
                else:
                    chunk = source.read(65536)
                    if not chunk:
                        break
                total += len(chunk)
                if total > limit:
                    raise ValueError("file exceeds transfer limit")
                destination.write(chunk)
            if operation == "write":
                file.flush()
                os.fsync(file.fileno())
                existing = None
                with suppress(FileNotFoundError):
                    existing = safe_open(root, name)
                if mode == "create" and existing is not None:
                    os.close(existing)
                    raise ValueError("file already exists; use overwrite with its current SHA-256")
                if mode == "overwrite" and existing is None:
                    raise ValueError("file does not exist; use create")
                if existing is not None:
                    try:
                        info = os.fstat(existing)
                        if mode == "overwrite" and sha256_fd(existing) != expected_sha256:
                            raise ValueError("file changed; reread it before overwriting")
                        os.fchmod(file.fileno(), stat.S_IMODE(info.st_mode))
                    finally:
                        os.close(existing)
                # sources/ stays root-owned; SDK writes under work/outputs remain
                # editable by the unprivileged guest user.
                # A failed import leaves the previous complete snapshot intact.
                os.replace(root / temporary, root / name)
            if operation == "read":
                after = os.fstat(file.fileno())
                if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_size,
                    after.st_mtime_ns,
                    after.st_ctime_ns,
                ):
                    raise ValueError("file changed during export; finish writing before publication")
    else:
        raise ValueError("unsupported helper operation")


if __name__ == "__main__":
    main()
