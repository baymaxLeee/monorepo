"""Trusted, root-owned supervisor inside an ephemeral sandbox, never on the host."""

import hashlib
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
from contextlib import suppress


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

    def read(self, offset):
        end = self.base + len(self.data)
        if offset < 0 or offset > end:
            raise ValueError("invalid output cursor")
        data = bytes(self.data[max(0, offset - self.base) :])
        return data.decode("utf-8", errors="replace"), end, offset < self.base


class Process:
    def __init__(self, request, root, uid, gid, output_limit, max_timeout, expire, pids):
        self.id = uuid.uuid4().hex
        self.request = {k: request.get(k) for k in ("command", "workdir", "env", "tty", "timeout_ms")}
        self.condition = threading.Condition()
        self.stdin_lock = threading.Lock()
        self.writes = {}
        self.stdout = Output(output_limit)
        self.stderr = Output(output_limit)
        self.exit_code = None
        self.timed_out = False
        self.expire = expire
        self.pty_fd = None
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
        env.update(request.get("env") or {})
        # Only configured outbound proxies cross into the guest environment.
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            if key in os.environ:
                env[key] = os.environ[key]
        options = {"cwd": cwd, "env": env, "start_new_session": True}
        argv = [sys.executable, "-I", str(pathlib.Path(__file__).resolve()), "guest", str(pids), request["command"]]
        if os.getuid() == 0:
            options.update(user=uid, group=gid, extra_groups=[])
        if request.get("tty"):
            master, slave = pty.openpty()
            self.pty_fd = master
            try:
                self.process = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, **options)
            except BaseException:
                os.close(master)
                raise
            finally:
                os.close(slave)
            readers = [(master, self.stdout)]
        else:
            self.process = subprocess.Popen(
                argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options
            )
            readers = [(self.process.stdout.fileno(), self.stdout), (self.process.stderr.fileno(), self.stderr)]
        self.readers = [threading.Thread(target=self.collect, args=pair, daemon=True) for pair in readers]
        for thread in self.readers:
            thread.start()
        timeout = min(max_timeout, request.get("timeout_ms", 120000)) / 1000
        self.waiter = threading.Thread(target=self.wait, args=(timeout,), daemon=True)
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
        with suppress(ProcessLookupError, PermissionError):
            os.killpg(self.process.pid, signal.SIGKILL)

    def wait(self, timeout):
        try:
            code = self.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.timed_out = True
            self.kill()
            self.expire()
            code = self.process.wait()
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
        with self.condition:
            self.exit_code = code
            self.condition.notify_all()

    def snapshot(self, request):
        with self.condition:
            self.condition.wait_for(
                lambda: self.exit_code is not None, timeout=min(10000, request.get("yield_time_ms", 0)) / 1000
            )
            out, out_cursor, out_truncated = self.stdout.read(request.get("stdout_offset", 0))
            err, err_cursor, err_truncated = self.stderr.read(request.get("stderr_offset", 0))
            return {
                "session_id": self.id,
                "stdout": out,
                "stderr": err,
                "exitCode": self.exit_code,
                "stdout_offset": out_cursor,
                "stderr_offset": err_cursor,
                "timed_out": self.timed_out,
                "truncated": out_truncated or err_truncated,
            }

    def write(self, request):
        chars = request.get("chars", "")
        if not chars:
            return
        key = request["request_id"]
        with self.stdin_lock:
            if key in self.writes:
                if self.writes[key] != chars:
                    raise ValueError("stdin request ID was reused with different input")
                return
            if self.exit_code is not None:
                raise ValueError("process already exited")
            # Mark before writing: an ambiguous/partial write must never be replayed.
            self.writes[key] = chars
            fd = self.pty_fd if self.pty_fd is not None else self.process.stdin.fileno()
            if chars == "\x03":
                os.killpg(self.process.pid, signal.SIGINT)
                return
            data = chars.encode()
            deadline = time.monotonic() + 5
            while data:
                if time.monotonic() >= deadline:
                    raise TimeoutError("stdin did not drain; input was not retried")
                _, ready, _ = select.select([], [fd], [], 0.1)
                if ready:
                    data = data[os.write(fd, data[:1024]) :]


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
        self.processes, self.requests = {}, {}
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
                    if not any(process.exit_code is None for process in self.processes.values()):
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
                if self.closed:
                    raise ValueError("sandbox is closing")
                if self.workspace_edit is not None:
                    raise ValueError("workspace edit in progress")
                key = request["request_id"]
                if key in self.requests:
                    process = self.processes[self.requests[key]]
                    if process.request != {k: request.get(k) for k in process.request}:
                        raise ValueError("command request ID was reused with different input")
                else:
                    if len(self.processes) >= self.max_processes:
                        raise ValueError("sandbox command capacity exceeded")
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
            process = self.processes.get(request.get("session_id"))
            if process is None:
                raise ValueError("unknown process session")
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
    for directory in (root / "work", root / "outputs"):
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
    proxy = None
    if os.environ.get("SANDBOX_PROXY_SOCKET"):
        proxy = subprocess.Popen(
            ["socat", "TCP-LISTEN:3128,bind=127.0.0.1,reuseaddr,fork", "UNIX-CONNECT:/run/egress/proxy.sock"],
            env={"PATH": "/usr/bin:/bin"},
        )

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            try:
                data = self.rfile.readline(262145)
                if len(data) > 262144:
                    raise ValueError("request too large")
                result = runtime.request(json.loads(data))
                if proxy is not None and proxy.poll() is not None:
                    raise RuntimeError("sandbox egress forwarder unavailable")
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
        os.execv("/bin/bash", ["bash", "--noprofile", "--norc", "-c", sys.argv[3]])
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
    elif sys.argv[1] in ("read", "write", "stat"):
        operation, name, limit = sys.argv[1:4]
        limit = int(limit)
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
