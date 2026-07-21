import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { secureProviderFetch } from "@backend/transport-ts/provider-url";

import { getSettings } from "../../bootstrap/config.js";
import type { VideoOutputConfig } from "./output-config.js";

function buildNormalizeVf(config: Pick<VideoOutputConfig, "width" | "height" | "fps">): string {
  return [
    `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease`,
    `pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
    `fps=${config.fps}`,
    "format=yuv420p",
  ].join(",");
}

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  const bin = getSettings().ffmpegPath;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["-y", "-hide_banner", "-loglevel", "error", ...args], {
      signal,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error) =>
      reject(new Error(`ffmpeg spawn failed (${bin}): ${String(error).slice(0, 300)}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

function ffprobePath(): string {
  const ffmpeg = getSettings().ffmpegPath;
  if (ffmpeg === "ffmpeg") return "ffprobe";
  return ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
}

function probeVideo(path: string, signal?: AbortSignal): Promise<{
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  const bin = ffprobePath();
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path],
      { signal, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-500)}`));
      const parsed = JSON.parse(stdout) as {
        format?: { duration?: string };
        streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      };
      const video = parsed.streams?.find((stream) => stream.codec_type === "video");
      resolve({
        duration: Number(parsed.format?.duration ?? 0),
        width: video?.width ?? 0,
        height: video?.height ?? 0,
        hasAudio: Boolean(parsed.streams?.some((stream) => stream.codec_type === "audio")),
      });
    });
  });
}

function detectVisualAnomalies(
  path: string,
  signal?: AbortSignal,
): Promise<{ blackFrames: boolean; repeatedFrames: boolean; detail: string }> {
  const bin = getSettings().ffmpegPath;
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        "-hide_banner",
        "-i",
        path,
        "-vf",
        "blackdetect=d=0.5:pic_th=0.98,freezedetect=n=-50dB:d=2",
        "-an",
        "-f",
        "null",
        "-",
      ],
      { signal, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 100_000) stderr = stderr.slice(-100_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg visual QA exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const blackFrames = /black_duration:/u.test(stderr);
      const repeatedFrames = /freeze_start:/u.test(stderr);
      resolve({
        blackFrames,
        repeatedFrames,
        detail: [
          blackFrames ? "black interval >= 0.5s" : "no black interval >= 0.5s",
          repeatedFrames ? "frozen interval >= 2s" : "no frozen interval >= 2s",
        ].join("; "),
      });
    });
  });
}

function hasAudioStream(path: string, signal?: AbortSignal): Promise<boolean> {
  const bin = ffprobePath();
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
      { signal, stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.on("error", () => resolve(true));
    child.on("close", () => resolve(stdout.trim().length > 0));
  });
}

async function normalizeClip(
  src: string,
  norm: string,
  normalizeVf: string,
  signal?: AbortSignal,
): Promise<void> {
  const withAudio = await hasAudioStream(src, signal);
  const args = withAudio
    ? ["-i", src, "-map", "0:v:0", "-map", "0:a:0"]
    : [
        "-i",
        src,
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-shortest",
      ];
  await runFfmpeg(
    [
      ...args,
      "-vf", normalizeVf,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      norm,
    ],
    signal,
  );
}

async function downloadTo(url: string, path: string, signal?: AbortSignal): Promise<void> {
  const bytes = await downloadVideoBytes(url, signal);
  await writeFile(path, bytes);
}

export async function downloadVideoBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await secureProviderFetch(url, { signal });
  if (!response.ok) throw new Error(`clip download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("clip download returned no bytes");
  return bytes;
}

export async function assembleClips(input: {
  urls: string[];
  outputConfig: Pick<VideoOutputConfig, "width" | "height" | "fps">;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (input.urls.length === 0) throw new Error("no clips to assemble");
  const normalizeVf = buildNormalizeVf(input.outputConfig);
  const dir = await mkdtemp(join(tmpdir(), "video-assemble-"));
  try {
    const normalized: string[] = [];
    for (const [index, url] of input.urls.entries()) {
      const src = join(dir, `src-${index}.mp4`);
      const norm = join(dir, `norm-${index}.mp4`);
      await downloadTo(url, src, input.signal);
      await normalizeClip(src, norm, normalizeVf, input.signal);
      normalized.push(norm);
    }

    const output = join(dir, "output.mp4");
    if (normalized.length === 1) {
      await runFfmpeg(["-i", normalized[0]!, "-c", "copy", output], input.signal);
    } else {
      const listPath = join(dir, "concat.txt");
      await writeFile(listPath, normalized.map((p) => `file '${p}'`).join("\n"));
      try {
        await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output], input.signal);
      } catch (copyError) {
        console.warn("[executor] concat -c copy failed, re-encoding", { error: String(copyError).slice(0, 200) });
        await runFfmpeg(
          [
            "-f", "concat", "-safe", "0", "-i", listPath,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            output,
          ],
          input.signal,
        );
      }
    }

    const bytes = await readFile(output);
    if (bytes.length === 0) throw new Error("assembled video is empty");
    return new Uint8Array(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function inspectVideoBytes(
  bytes: Uint8Array,
  expected: Pick<VideoOutputConfig, "width" | "height"> & { minimumDuration: number },
  signal?: AbortSignal,
): Promise<{ passed: boolean; checks: Array<{ name: string; passed: boolean; detail: string }> }> {
  const dir = await mkdtemp(join(tmpdir(), "video-qa-"));
  try {
    const path = join(dir, "output.mp4");
    await writeFile(path, bytes);
    const probe = await probeVideo(path, signal);
    const visual = await detectVisualAnomalies(path, signal);
    const checks = [
      { name: "non_empty", passed: bytes.length > 0, detail: `${bytes.length} bytes` },
      {
        name: "duration",
        passed: probe.duration >= expected.minimumDuration,
        detail: `${probe.duration.toFixed(2)}s (minimum ${expected.minimumDuration}s)`,
      },
      {
        name: "dimensions",
        passed: probe.width === expected.width && probe.height === expected.height,
        detail: `${probe.width}x${probe.height} (expected ${expected.width}x${expected.height})`,
      },
      { name: "audio_stream", passed: probe.hasAudio, detail: probe.hasAudio ? "present" : "missing" },
      {
        name: "black_frames",
        passed: !visual.blackFrames,
        detail: visual.detail,
      },
      {
        name: "repeated_frames",
        passed: !visual.repeatedFrames,
        detail: visual.detail,
      },
    ];
    return { passed: checks.every((check) => check.passed), checks };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
