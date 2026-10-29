"""Run a filesystem probe as the Asset image user on fresh and reused Docker volumes.

ASSET_TEST_IMAGE=local/asset-volume-test python3 infra/single-vps/tests/test-asset-volume.py
"""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid


PROBE = r"""
package main
import ("fmt"; "os")
func main() {
    if os.Geteuid() != 65532 { panic("asset must remain non-root UID 65532") }
    if err := os.MkdirAll("/data/assets/staging", 0750); err != nil { panic(err) }
    path := "/data/assets/staging/volume-probe"
    previous, err := os.ReadFile(path)
    if err == nil {
        if string(previous) != "preserved" { panic("existing data changed") }
        fmt.Println("existing data preserved")
        return
    }
    if !os.IsNotExist(err) { panic(err) }
    if err := os.WriteFile(path, []byte("preserved"), 0640); err != nil { panic(err) }
    fmt.Println("fresh volume writable")
}
"""


def docker(*args):
    return subprocess.run(["docker", *args], text=True, capture_output=True)


class AssetVolumeTest(unittest.TestCase):
    def test_fresh_volume_and_recreated_container(self):
        image = os.environ["ASSET_TEST_IMAGE"]
        inspected = docker("image", "inspect", image)
        self.assertEqual(inspected.returncode, 0, inspected.stderr)
        arch = json.loads(inspected.stdout)[0]["Architecture"]
        volume = f"asset-volume-test-{uuid.uuid4().hex[:12]}"
        created = docker("volume", "create", volume)
        self.assertEqual(created.returncode, 0, created.stderr)
        self.addCleanup(docker, "volume", "rm", volume)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "probe.go").write_text(PROBE)
            subprocess.run(
                ["go", "build", "-o", str(path / "probe"), str(path / "probe.go")],
                env=dict(os.environ, GOOS="linux", GOARCH=arch, CGO_ENABLED="0"),
                check=True,
            )
            for expected in ("fresh volume writable", "existing data preserved"):
                created = docker(
                    "create",
                    "--network",
                    "none",
                    "--entrypoint",
                    "/volume-probe",
                    "--mount",
                    f"type=volume,source={volume},target=/data/assets",
                    image,
                )
                self.assertEqual(created.returncode, 0, created.stderr)
                container = created.stdout.strip()
                try:
                    copied = docker(
                        "cp", str(path / "probe"), f"{container}:/volume-probe"
                    )
                    self.assertEqual(copied.returncode, 0, copied.stderr)
                    result = docker("start", "-a", container)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    state = docker(
                        "inspect", "--format", "{{.State.ExitCode}}", container
                    )
                    self.assertEqual(
                        state.stdout.strip(), "0", result.stdout + result.stderr
                    )
                    self.assertIn(expected, result.stdout)
                finally:
                    docker("rm", "-f", container)


if __name__ == "__main__":
    unittest.main()
