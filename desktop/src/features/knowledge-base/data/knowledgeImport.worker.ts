import {
  plainTextMarkdown,
  validateDocxArchive,
  validateExtractedText,
  validateKnowledgeFile,
} from "./importSafety";

// Loaded only by the private knowledge route, never by the public booking/site entry.
self.onmessage = async (
  event: MessageEvent<{ name: string; bytes: ArrayBuffer }>,
) => {
  try {
    const { name, bytes } = event.data;
    const extension = validateKnowledgeFile(name, bytes.byteLength);
    let markdown = "";
    if (extension === "pdf") {
      const pdf = await import("pdfjs-dist");
      const workerUrl = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      // Explicit port: PDF.js' automatic worker discovery assumes `window`.
      // Inside our disposable worker that fallback would initialize its message
      // protocol on this worker's own port and corrupt the import response.
      const parser = new Worker(workerUrl.default, { type: "module" });
      const pdfWorker = pdf.PDFWorker.create({ port: parser });
      const loading = pdf.getDocument({
        data: bytes,
        worker: pdfWorker,
        useWorkerFetch: false,
        disableFontFace: true,
        stopAtErrors: true,
        maxImageSize: 1,
      });
      loading.onPassword = () => {
        void loading.destroy();
      };
      try {
        const document = await loading.promise;
        if (document.numPages > 100)
          throw new Error(
            "Максимум 100 страниц. Разделите PDF / PDF page limit: 100.",
          );
        const pages: string[] = [];
        for (let index = 1; index <= document.numPages; index++) {
          const page = await document.getPage(index);
          const content = await page.getTextContent();
          const text = content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("")
            .trim();
          if (!text)
            throw new Error(
              `На странице ${index} нет текста. Скан нужно распознать вручную / Page ${index} has no readable text.`,
            );
          pages.push(`## ${index}\n\n${plainTextMarkdown(text)}`);
          if (pages.join("\n\n").length > 50000)
            throw new Error(
              "Разделите PDF на меньшие материалы / PDF text limit exceeded.",
            );
          page.cleanup();
        }
        markdown = pages.join("\n\n");
      } finally {
        await loading.destroy();
        pdfWorker.destroy();
        parser.terminate();
      }
    } else if (extension === "docx") {
      validateDocxArchive(bytes);
      const mammoth = await import("mammoth/mammoth.browser");
      const result = await mammoth.extractRawText({ arrayBuffer: bytes });
      markdown = plainTextMarkdown(result.value);
    } else {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      markdown = extension === "md" ? text : plainTextMarkdown(text);
    }
    self.postMessage({ markdown: validateExtractedText(markdown) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Не удалось прочитать файл / Import failed.",
    });
  }
};
