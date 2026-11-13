# The Node service runs these standard-library tests without a Python package install.
# ruff: noqa: PT009, PT027
import os
import pathlib
import tempfile
import time
import unittest

from runner import Runtime, safe_open, workspace_files


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.runtime = Runtime(self.root, uid=os.getuid(), gid=os.getgid(), output_limit=128, workspace_edit_wait=0)

    def tearDown(self):
        self.runtime.close()
        self.temp.cleanup()

    def start(self, command, **kw):
        return self.runtime.request(
            {"op": "start", "request_id": str(time.time_ns()), "command": command, "yield_time_ms": 1000, **kw}
        )

    def test_exit_output_and_shared_files(self):
        result = self.start("printf hello > notes; printf error >&2; exit 7")
        self.assertEqual(result["exitCode"], 7)
        self.assertEqual(result["stderr"], "error")
        self.assertEqual(self.start("cat notes")["stdout"], "hello")

    def test_live_process_stdin_and_offsets(self):
        first = self.start("read line; printf '%s' \"$line\"", yield_time_ms=0)
        self.assertIsNone(first["exitCode"])
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

    def test_timeout_keeps_partial_output_and_kills_background(self):
        result = self.start("printf before; sleep 10 & wait", timeout_ms=100)
        self.assertTrue(result["timed_out"])
        self.assertEqual(result["stdout"], "before")
        self.assertIsNotNone(result["exitCode"])

    def test_output_is_bounded_at_collection(self):
        result = self.start("python3 -c 'print(\"x\" * 10000)' ")
        self.assertLessEqual(len(result["stdout"].encode()), 128)
        self.assertTrue(result["truncated"])

    def test_command_deduplication_and_conflict(self):
        request = {"op": "start", "request_id": "once", "command": "echo x >> count", "yield_time_ms": 1000}
        self.runtime.request(request)
        self.runtime.request(request)
        self.assertEqual((self.root / "count").read_text(), "x\n")
        with self.assertRaises(ValueError):
            self.runtime.request({**request, "command": "echo y >> count"})

    def test_file_transfer_rejects_escape_symlink_and_fifo(self):
        (self.root / "escape").symlink_to("/etc/passwd")
        os.mkfifo(self.root / "pipe")
        for name in ["../outside", "/etc/passwd", "escape", "pipe"]:
            with self.subTest(name=name), self.assertRaises((ValueError, OSError)):
                safe_open(self.root, name, write=False)

    def test_teardown_stops_pending_process(self):
        first = self.start("sleep 30", yield_time_ms=0)
        self.runtime.close()
        result = self.runtime.request({"op": "poll", "session_id": first["session_id"]})
        self.assertIsNotNone(result["exitCode"])

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
