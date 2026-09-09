import { invokeTauri } from "@/shared/api/tauri";

/** WebKit downloads use the native file dialog, not an unsupported blob navigation. */
export async function saveKnowledgeDocument(
  name: string,
  blob: Blob,
  invoke = invokeTauri,
): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error("File limit: 10 MB");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  await invoke("save_knowledge_document", {
    filename: name,
    contentBase64: btoa(binary),
  });
}
