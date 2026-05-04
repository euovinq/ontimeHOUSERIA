/**
 * Force UTF-8 on stdout/stderr on Windows.
 *
 * On Windows, when stdout is captured by another process (e.g. turbo, npm, vscode),
 * libuv uses a "console mode" path that crashes with
 *   "Windows stdio in console mode does not support writing non-UTF-8 byte sequences"
 * whenever a console.log call contains accented chars (ã, ç, ñ, emojis, etc.) and the
 * host console code page isn't UTF-8 (CP-65001).
 *
 * This module:
 *   1. sets the default stream encoding to utf8;
 *   2. wraps process.stdout.write / process.stderr.write to always emit utf8 bytes;
 *   3. swallows any write error so a single bad log line never crashes the server.
 *
 * Must be imported BEFORE any other module that performs console output.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Avoid attaching the patch twice if this file is loaded multiple times (tsx watch).
const G = globalThis as any;
if (!G.__ontimeStdioPatched) {
  G.__ontimeStdioPatched = true;

  // Never crash on EPIPE when our parent (turbo/electron) closes the pipe.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });
  process.stderr.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err;
  });

  if (process.platform === 'win32') {
    for (const stream of [process.stdout, process.stderr] as NodeJS.WriteStream[]) {
      try {
        if (typeof stream.setDefaultEncoding === 'function') {
          stream.setDefaultEncoding('utf8');
        }
        const origWrite = stream.write.bind(stream) as NodeJS.WriteStream['write'];
        (stream as any).write = (chunk: any, encoding?: any, cb?: any): boolean => {
          try {
            let payload = chunk;
            if (Buffer.isBuffer(payload)) {
              payload = payload.toString('utf8');
            }
            if (typeof payload === 'string') {
              // Round-trip through UTF-8 to drop any lone surrogates.
              payload = Buffer.from(payload, 'utf8').toString('utf8');
            }
            // Forward the typed callback in the right slot.
            if (typeof encoding === 'function') {
              return origWrite(payload, 'utf8', encoding);
            }
            return origWrite(payload, 'utf8', cb);
          } catch {
            // Never let a log line crash the process.
            if (typeof encoding === 'function') {
              try { (encoding as () => void)(); } catch { /* ignore */ }
            } else if (typeof cb === 'function') {
              try { (cb as () => void)(); } catch { /* ignore */ }
            }
            return true;
          }
        };
      } catch {
        // Keep original stream if patching failed.
      }
    }
  }
}

export {};
