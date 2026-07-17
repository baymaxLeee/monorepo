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
  const response = await secureProviderFetch(url, { signal });
  if (!response.ok) throw new Error(`clip download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("clip download returned no bytes");
  await writeFile(path, bytes);
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
