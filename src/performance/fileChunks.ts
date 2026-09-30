/**
 * A file's text in pieces, decoded as it streams. Safari cannot iterate a ReadableStream
 * directly, so this reads it by hand; a multi-byte character split across two pieces is held
 * by the decoder until the rest arrives.
 */
export async function* fileChunks(file: Blob, onProgress?: (fraction: number) => void): AsyncGenerator<string> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    yield decoder.decode(value, { stream: true });
    const fraction = file.size ? read / file.size : 1;
    if (onProgress && fraction - reported >= 0.02) {
      reported = fraction;
      onProgress(fraction);
    }
  }
  const tail = decoder.decode();
  if (tail) yield tail;
  onProgress?.(1);
}
