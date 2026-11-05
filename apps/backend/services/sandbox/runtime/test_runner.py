# The Node service runs these standard-library tests without a Python package install.
# ruff: noqa: PT009, PT027
import os
import pathlib
import tempfile
import time
import unittest

from runner import Runtime, safe_open


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.runtime = Runtime(self.root, uid=os.getuid(), gid=os.getgid(), output_limit=128)

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


if __name__ == "__main__":
    unittest.main()
