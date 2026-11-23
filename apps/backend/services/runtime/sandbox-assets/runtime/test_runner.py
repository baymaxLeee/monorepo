# The Node service runs these standard-library tests without a Python package install.
# ruff: noqa: PT009, PT027
import base64
import os
import pathlib
import socket
import tempfile
import time
import unittest
from unittest import mock

from runner import (
    SCMP_CMP_EQ,
    SCMP_CMP_NE,
    Runtime,
    bwrap_argv,
    command_seccomp_rules,
    safe_open,
    safe_unlink,
    workspace_files,
)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.runtime = Runtime(self.root, uid=os.getuid(), gid=os.getgid(), output_limit=128, workspace_edit_wait=0)
        self.sandbox = {
            "attempt": 1,
            "sandboxed": False,
            "permission_profile": {"type": "disabled"},
            "process": {"process_id": 1, "entry_id": "runner-test"},
        }

    def tearDown(self):
        self.runtime.close()
        self.temp.cleanup()

    def start(self, command, **kw):
        return self.runtime.request(
            {
                "op": "start",
                "request_id": str(time.time_ns()),
                "command": command,
                "yield_time_ms": 1000,
                "sandbox": self.sandbox,
                **kw,
            }
        )

    def test_exit_output_and_shared_files(self):
        result = self.start("printf hello > notes; printf error >&2; exit 7")
        self.assertEqual(result["termination"], {"type": "exit", "exit_code": 7})
        self.assertEqual(result["stderr"], "error")
        self.assertEqual(self.start("cat notes")["stdout"], "hello")

    def test_rejects_commands_without_an_explicit_sandbox_attempt(self):
        with self.assertRaisesRegex(ValueError, "sandbox attempt is required"):
            self.runtime.request({"op": "start", "request_id": "missing", "command": "true"})

    def test_bubblewrap_profile_uses_read_only_root_and_specific_mounts(self):
        sources = self.root / "sources"
        sources.mkdir()
        request = {
            "command": "true",
            "workdir": str(self.root),
            "sandbox": {
                "attempt": 1,
                "sandboxed": True,
                "permission_profile": {
                    "type": "managed",
                    "file_system": {
                        "type": "restricted",
                        "entries": [
                            {"path": "/", "access": "read"},
                            {"path": str(self.root), "access": "write"},
                            {"path": str(sources), "access": "read"},
                        ],
                    },
                    "network": {"type": "restricted", "allowed_hosts": []},
                },
            },
        }
        with mock.patch("pathlib.Path.is_file", return_value=True):
            argv = bwrap_argv(request, self.root, os.getuid(), os.getgid(), 32)
        mounts = [argv[index : index + 3] for index in range(len(argv) - 2)]
        self.assertEqual(mounts.count(["--ro-bind", "/", "/"]), 1)
        self.assertIn(["--bind", "/tmp", "/tmp"], mounts)
        self.assertIn(
            ["--bind", str(self.root), str(self.root)],
            mounts,
        )
        self.assertIn(
            ["--ro-bind", str(sources), str(sources)],
            mounts,
        )
        self.assertIn("--unshare-net", argv)

    def test_bubblewrap_installs_root_write_before_fixed_and_denied_mounts(self):
        denied = self.root / "secret"
        denied.write_text("secret")
        request = {
            "command": "true",
            "workdir": str(self.root),
            "sandbox": {
                "attempt": 2,
                "sandboxed": True,
                "permission_profile": {
                    "type": "managed",
                    "file_system": {
                        "type": "restricted",
                        "entries": [
                            {"path": "/", "access": "write"},
                            {"path": str(denied), "access": "deny"},
                        ],
                    },
                    "network": {"type": "enabled"},
                },
            },
        }
        with mock.patch("pathlib.Path.is_file", return_value=True):
            argv = bwrap_argv(request, self.root, os.getuid(), os.getgid(), 32)
        mounts = [argv[index : index + 3] for index in range(len(argv) - 2)]
        root_index = mounts.index(["--bind", "/", "/"])
        tmp_index = mounts.index(["--bind", "/tmp", "/tmp"])
        deny_index = mounts.index(["--ro-bind", "/dev/null", str(denied)])
        self.assertLess(root_index, tmp_index)
        self.assertLess(tmp_index, deny_index)
        self.assertNotIn(["--ro-bind", "/", "/"], mounts)

    def test_bubblewrap_rejects_a_missing_denied_path(self):
        request = {
            "command": "true",
            "workdir": str(self.root),
            "sandbox": {
                "attempt": 1,
                "sandboxed": True,
                "permission_profile": {
                    "type": "managed",
                    "file_system": {
                        "type": "restricted",
                        "entries": [
                            {"path": "/", "access": "read"},
                            {"path": str(self.root), "access": "write"},
                            {"path": str(self.root / "missing-secret"), "access": "deny"},
                        ],
                    },
                    "network": {"type": "restricted", "allowed_hosts": []},
                },
            },
        }
        with (
            mock.patch("pathlib.Path.is_file", return_value=True),
            self.assertRaisesRegex(RuntimeError, "denied sandbox path does not exist"),
        ):
            bwrap_argv(request, self.root, os.getuid(), os.getgid(), 32)

    def test_command_seccomp_rules_keep_proxy_on_ip_and_socketpairs_on_unix(self):
        proxy_rule_list = command_seccomp_rules("proxy")
        proxy_rules = dict(proxy_rule_list)
        socket_denials = [conditions for name, conditions in proxy_rule_list if name == "socket"]
        self.assertIn(((0, SCMP_CMP_EQ, socket.AF_UNIX),), socket_denials)
        self.assertNotIn(((0, SCMP_CMP_EQ, socket.AF_INET),), socket_denials)
        self.assertNotIn(((0, SCMP_CMP_EQ, socket.AF_INET6),), socket_denials)
        self.assertEqual(proxy_rules["socketpair"], ((0, SCMP_CMP_NE, socket.AF_UNIX),))
        for syscall in ("ptrace", "process_vm_readv", "request_key", "io_uring_setup"):
            self.assertIn(syscall, proxy_rules)

        restricted_rules = dict(command_seccomp_rules("restricted"))
        self.assertEqual(restricted_rules["socket"], ((0, SCMP_CMP_NE, socket.AF_UNIX),))
        self.assertIn("connect", restricted_rules)

    def test_live_process_stdin_and_offsets(self):
        first = self.start("read line; printf '%s' \"$line\"", yield_time_ms=0)
        self.assertIsNone(first["termination"])
        result = self.runtime.request(
            {
                "op": "write",
                "session_id": first["session_id"],
                "request_id": "input1",
                "chars": "world\n",
                "yield_time_ms": 1000,
            }
        )
        self.assertEqual(result["stdout"], "world")
        replay = self.runtime.request(
            {"op": "poll", "session_id": first["session_id"], "stdout_offset": result["stdout_offset"]}
        )
        self.assertEqual(replay["stdout"], "")

    def test_binary_pipe_preserves_bytes_and_eof_with_idempotent_input(self):
        child = self.start("cat", binary_io=True, pipe_stdin=True, yield_time_ms=0)
        write = {
            "op": "write",
            "session_id": child["session_id"],
            "request_id": "binary",
            "stdin_base64": base64.b64encode(b"\x03\xff\x00").decode(),
        }
        self.runtime.request(write)
        self.runtime.request(write)
        eof = {
            "op": "write",
            "session_id": child["session_id"],
            "request_id": "eof",
            "close_stdin": True,
            "yield_time_ms": 1000,
        }
        result = self.runtime.request(eof)
        self.assertEqual(result["termination"], {"type": "exit", "exit_code": 0})
        self.assertEqual(base64.b64decode(result["stdout"]), b"\x03\xff\x00")
        self.assertEqual(self.runtime.request(eof)["stdout"], result["stdout"])

    def test_failed_stdin_write_cannot_replay_as_success(self):
        child = self.start("cat", pipe_stdin=True, binary_io=True, yield_time_ms=0)
        request = {
            "op": "write",
            "session_id": child["session_id"],
            "request_id": "partial",
            "stdin_base64": base64.b64encode(b"abc").decode(),
        }
        process = self.runtime.processes[child["session_id"]]
        with mock.patch("os.write", side_effect=[1, BrokenPipeError("pipe closed")]) as write:
            with self.assertRaises(BrokenPipeError):
                process.write(request)
            with self.assertRaisesRegex(ValueError, "previous stdin write failed"):
                process.write(request)
            self.assertEqual(write.call_count, 2)

    def test_timeout_keeps_partial_output_and_kills_background(self):
        result = self.start("printf before; sleep 10 & wait", timeout_ms=100)
        self.assertEqual(result["termination"]["type"], "timeout")
        self.assertEqual(result["stdout"], "before")

    def test_output_is_bounded_at_collection(self):
        result = self.start("python3 -c 'import sys; sys.stdout.write(\"x\" * 10000)'", retain_output=True)
        self.assertLessEqual(len(result["stdout"].encode()), 128)
        self.assertTrue(result["truncated"])
        self.assertTrue(result["stdout_truncated"])
        self.assertFalse(result["stderr_truncated"])
        retained = pathlib.Path(result["retained_output_path"])
        self.assertEqual(retained.read_bytes(), b"x" * 10000)

    def test_retained_output_failure_kills_the_command_and_never_publishes_an_incomplete_reference(self):
        first = self.start("sleep 0.1; printf complete", retain_output=True, yield_time_ms=0)
        process = self.runtime.processes[first["session_id"]]
        process.retained_output.close()
        process.retained_output = mock.Mock()
        process.retained_output.write.side_effect = OSError("disk full")

        result = self.runtime.request({"op": "poll", "session_id": first["session_id"], "yield_time_ms": 1000})

        self.assertEqual(result["termination"]["type"], "start-error")
        self.assertIn("failed to retain complete command output", result["termination"]["message"])
        self.assertNotIn("retained_output_path", result)

    def test_exited_sessions_make_room_and_evicted_start_never_reexecutes(self):
        self.runtime.max_processes = 2
        first = self.start("echo first >> calls", request_id="first")
        active = self.start("sleep 10", yield_time_ms=0)
        last = self.start("printf next")
        self.assertEqual(last["stdout"], "next")
        with self.assertRaisesRegex(ValueError, "expired"):
            self.start("echo first >> calls", request_id="first")
        self.assertEqual((self.root / "calls").read_text(), "first\n")
        self.assertNotIn(first["session_id"], self.runtime.processes)
        self.assertIn(active["session_id"], self.runtime.processes)

    def test_command_deduplication_and_conflict(self):
        request = {
            "op": "start",
            "request_id": "once",
            "command": "echo x >> count",
            "yield_time_ms": 1000,
            "sandbox": self.sandbox,
        }
        self.runtime.request(request)
        self.runtime.request(request)
        self.assertEqual((self.root / "count").read_text(), "x\n")
        with self.assertRaises(ValueError):
            self.runtime.request({**request, "command": "echo y >> count"})

    def test_completed_command_retry_survives_workspace_edit_and_close(self):
        request = {
            "op": "start",
            "request_id": "once",
            "command": "echo x >> count",
            "yield_time_ms": 1000,
            "sandbox": self.sandbox,
        }
        first = self.runtime.request(request)
        self.runtime.request({"op": "begin_workspace_edit", "token": "edit"})
        self.assertEqual(self.runtime.request(request)["session_id"], first["session_id"])
        self.runtime.request({"op": "end_workspace_edit", "token": "edit"})
        self.runtime.close()
        self.assertEqual(self.runtime.request(request)["session_id"], first["session_id"])
        with self.assertRaisesRegex(ValueError, "different input"):
            self.runtime.request({**request, "command": "echo y >> count"})
        self.assertEqual((self.root / "count").read_text(), "x\n")

    def test_file_transfer_rejects_escape_symlink_and_fifo(self):
        (self.root / "escape").symlink_to("/etc/passwd")
        os.mkfifo(self.root / "pipe")
        for name in ["../outside", "/etc/passwd", "escape", "pipe"]:
            with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                safe_open(self.root, name, write=False)

    def test_safe_unlink_requires_the_exact_current_content(self):
        target = self.root / "notes.txt"
        target.write_text("first")
        with self.assertRaisesRegex(ValueError, "file changed"):
            safe_unlink(self.root, "notes.txt", "0" * 64)
        self.assertTrue(target.exists())
        safe_unlink(self.root, "notes.txt", "a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e")
        self.assertFalse(target.exists())

    def test_teardown_stops_pending_process(self):
        first = self.start("sleep 30", yield_time_ms=0)
        self.runtime.close()
        result = self.runtime.request({"op": "poll", "session_id": first["session_id"]})
        self.assertIsNotNone(result["termination"])

    def test_workspace_edit_fences_processes_and_is_idempotent(self):
        token = "edit-1"
        self.assertEqual(self.runtime.request({"op": "begin_workspace_edit", "token": token}), {"token": token})
        self.assertEqual(self.runtime.request({"op": "begin_workspace_edit", "token": token}), {"token": token})
        with self.assertRaisesRegex(ValueError, "workspace edit in progress"):
            self.start("true")
        with self.assertRaisesRegex(ValueError, "token mismatch"):
            self.runtime.request({"op": "end_workspace_edit", "token": "other"})
        self.assertEqual(self.runtime.request({"op": "end_workspace_edit", "token": token}), {"released": True})
        self.assertEqual(self.start("printf resumed")["stdout"], "resumed")

    def test_workspace_edit_rejects_an_active_process(self):
        first = self.start("sleep 30", yield_time_ms=0)
        with self.assertRaisesRegex(ValueError, "active process"):
            self.runtime.request({"op": "begin_workspace_edit", "token": "edit-1"})
        self.runtime.request({"op": "cancel", "session_id": first["session_id"]})

    def test_workspace_edit_waits_for_an_admitted_process(self):
        runtime = Runtime(self.root, uid=os.getuid(), gid=os.getgid(), output_limit=128, workspace_edit_wait=1)
        try:
            runtime.request(
                {
                    "op": "start",
                    "request_id": "short",
                    "command": "sleep 0.1",
                    "yield_time_ms": 0,
                    "sandbox": self.sandbox,
                }
            )
            self.assertEqual(
                runtime.request({"op": "begin_workspace_edit", "token": "edit-1"}),
                {"token": "edit-1"},
            )
            runtime.request({"op": "end_workspace_edit", "token": "edit-1"})
        finally:
            runtime.close()

    def test_snapshot_waits_for_workspace_edit_release(self):
        self.runtime.request({"op": "begin_workspace_edit", "token": "edit-1"})
        with self.assertRaisesRegex(ValueError, "workspace edit in progress"):
            self.runtime.request({"op": "snapshot"})
        self.assertTrue(self.runtime.request({"op": "health"})["ready"])
        self.runtime.request({"op": "end_workspace_edit", "token": "edit-1"})
        self.assertEqual(self.runtime.request({"op": "snapshot"}), {"files": []})

    def test_workspace_manifest_is_sorted_hashed_and_excludes_sources(self):
        (self.root / "b.txt").write_bytes(b"two")
        (self.root / "a.txt").write_bytes(b"one")
        (self.root / "sources").mkdir()
        (self.root / "sources" / "attachment.txt").write_text("external")
        self.assertEqual([item["path"] for item in workspace_files(self.root)], ["a.txt", "b.txt"])
        self.assertEqual(
            workspace_files(self.root)[0]["sha256"], "7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed"
        )

    def test_workspace_manifest_rejects_symlinks(self):
        (self.root / "link").symlink_to("/etc/passwd")
        with self.assertRaises(ValueError):
            workspace_files(self.root)


if __name__ == "__main__":
    unittest.main()
