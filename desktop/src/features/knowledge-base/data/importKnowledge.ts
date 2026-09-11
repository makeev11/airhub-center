import { validateKnowledgeFile } from "./importSafety";

/** Disposable isolated worker; timeout, cancel and route unmount terminate parsing. */
export async function importKnowledge(
  file: File,
  signal: AbortSignal,
): Promise<string> {
  validateKnowledgeFile(file.name, file.size);
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./knowledgeImport.worker.ts", import.meta.url),
      { type: "module" },
    );
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () =>
      fail(new DOMException("Import cancelled", "AbortError"));
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "Обработка заняла слишком долго. Попробуйте меньший файл / Import timed out.",
          ),
        ),
      30_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () =>
      fail(new Error("Не удалось прочитать файл / File parser failed."));
    worker.onmessage = (
      event: MessageEvent<{ markdown?: string; error?: string }>,
    ) => {
      if (event.data.error || typeof event.data.markdown !== "string") {
        fail(new Error(event.data.error ?? "Invalid import response"));
        return;
      }
      cleanup();
      resolve(event.data.markdown);
    };
    worker.postMessage({ name: file.name, bytes }, [bytes]);
  });
}
