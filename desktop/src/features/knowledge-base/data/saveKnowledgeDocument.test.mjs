import assert from "node:assert/strict";
import test from "node:test";
import { saveKnowledgeDocument } from "./saveKnowledgeDocument.ts";

test("private originals use the native save dialog and exact bytes, never public media", async () => {
  const bytes = new Uint8Array([0, 1, 255, 128, 13]);
  await saveKnowledgeDocument(
    "Документ.pdf",
    new Blob([bytes]),
    async (command, input) => {
      assert.equal(command, "save_knowledge_document");
      assert.equal(input.filename, "Документ.pdf");
      assert.deepEqual(
        new Uint8Array(Buffer.from(input.contentBase64, "base64")),
        bytes,
      );
      return true;
    },
  );
  await assert.rejects(
    saveKnowledgeDocument(
      "huge.pdf",
      new Blob([new Uint8Array(10485761)]),
      async () => assert.fail("No dialog for oversized data"),
    ),
    /10 MB/,
  );
});
