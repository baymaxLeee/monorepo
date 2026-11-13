interface ErrorOutput {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

const closedOutputCodes = new Set(["EIO", "EPIPE"]);

export function tolerateClosedOutput(stream: ErrorOutput): void {
  stream.on("error", (error) => {
    if (error.code && closedOutputCodes.has(error.code)) return;
    throw error;
  });
}

const electronProcess = process as NodeJS.Process & { type?: string };
if (electronProcess.type === "browser") {
  tolerateClosedOutput(process.stdout);
  tolerateClosedOutput(process.stderr);
}
