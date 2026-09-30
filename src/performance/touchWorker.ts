// Summarises a touch-level export off the main thread. A 50MB file takes a second or two to
// read, which would freeze the page; here it only moves a progress bar. The file's rows (and
// their household hashes) stay in this worker; only the summary is posted back.

import { readTouchReportStream } from "./reports";
import { fileChunks } from "./fileChunks";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<{ file: File }>) => void) | null;
  postMessage: (message: unknown) => void;
};

worker.onmessage = async (event) => {
  const { file } = event.data;
  try {
    const report = await readTouchReportStream(file.name, fileChunks(file, (fraction) => worker.postMessage({ type: "progress", fraction })));
    worker.postMessage({ type: "done", report });
  } catch (err: any) {
    worker.postMessage({ type: "error", error: err?.message || String(err) });
  }
};
