// TypeScript port of codex-rs/utils/head-tail-buffer. The tail is a circular byte buffer.
export class HeadTailBuffer {
  private data?: Buffer;
  private tailOffset = 0;
  private bytes = 0;
  private newlines = 0;
  private endsWithNewline = false;

  constructor(private readonly capacity: number) {}

  push(text: string) {
    if (!text) return;
    const chunk = Buffer.from(text);
    const data = (this.data ??= Buffer.allocUnsafe(this.capacity));
    const headSize = Math.floor(this.capacity / 2);
    const tailSize = this.capacity - headSize;
    const headBytes = Math.min(chunk.length, Math.max(0, headSize - this.bytes));
    if (headBytes) chunk.copy(data, this.bytes, 0, headBytes);
    const tail = chunk.subarray(headBytes);
    if (tail.length >= tailSize) {
      tail.copy(data, headSize, tail.length - tailSize);
      this.tailOffset = 0;
    } else if (tail.length) {
      const first = Math.min(tail.length, tailSize - this.tailOffset);
      tail.copy(data, headSize + this.tailOffset, 0, first);
      tail.copy(data, headSize, first);
      this.tailOffset = (this.tailOffset + tail.length) % tailSize;
    }
    this.bytes += chunk.length;
    for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, i + 1)) this.newlines++;
    this.endsWithNewline = chunk.at(-1) === 10;
  }

  drain(maxTokens: number) {
    const originalTokens = Math.ceil(this.bytes / 4);
    const limit = Math.min(maxTokens * 4, this.capacity);
    const retained = this.retained();
    const truncated = this.bytes > limit;
    let output: string;
    if (!truncated) {
      output = retained.toString("utf8");
    } else {
      let headEnd = Math.floor(limit / 2);
      let tailStart = retained.length - (limit - headEnd);
      if (headEnd > 0) {
        let start = headEnd - 1;
        while (start > 0 && (retained[start]! & 0xc0) === 0x80) start--;
        const byte = retained[start]!;
        const width = byte < 128 ? 1 : byte < 224 ? 2 : byte < 240 ? 3 : 4;
        if (start + width > headEnd) headEnd = start;
      }
      while (tailStart < retained.length && (retained[tailStart]! & 0xc0) === 0x80) tailStart++;
      const omitted = Math.ceil((this.bytes - headEnd - retained.length + tailStart) / 4);
      const lines = this.newlines + Number(!this.endsWithNewline);
      output =
        `Warning: truncated output (original token count: ${originalTokens})\nTotal output lines: ${lines}\n\n` +
        retained.toString("utf8", 0, headEnd) +
        `…${omitted} tokens truncated…` +
        retained.toString("utf8", tailStart);
    }
    this.data = undefined;
    this.bytes = this.tailOffset = this.newlines = 0;
    this.endsWithNewline = false;
    return { output, originalTokens, truncated };
  }

  private retained() {
    const data = this.data;
    if (!data) return Buffer.alloc(0);
    if (this.bytes <= this.capacity) return data.subarray(0, this.bytes);
    const head = Math.floor(this.capacity / 2);
    return Buffer.concat([
      data.subarray(0, head),
      data.subarray(head + this.tailOffset),
      data.subarray(head, head + this.tailOffset),
    ]);
  }
}
