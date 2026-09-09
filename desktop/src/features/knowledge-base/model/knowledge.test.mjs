import assert from "node:assert/strict";
import test from "node:test";
import {
  knowledgeMarkdown,
  newKnowledgeDraft,
  knowledgeTopics,
  draftSchema,
} from "./knowledge.ts";
import {
  validateKnowledgeFile,
  validateDocxArchive,
  validateExtractedText,
  plainTextMarkdown,
} from "../data/importSafety.ts";

test("questionnaire omits unanswered prompts and keeps editable source", () => {
  const draft = {
    ...newKnowledgeDraft("ru-RU"),
    title: "Подготовка",
    questions: [
      { question: "Что взять?", answer: "Воду." },
      { question: "Неизвестно?", answer: "  " },
    ],
  };
  assert.equal(knowledgeMarkdown(draft), "## Что взять?\n\nВоду.");
  assert.equal(draft.questions.length, 2);
  assert.ok(draftSchema.safeParse(draft).success);
});
test("starter topics are optional and do not invent business facts", () => {
  for (const ru of [true, false]) {
    const topics = knowledgeTopics(ru);
    assert.equal(new Set(topics.map((t) => t.key)).size, topics.length);
    for (const topic of topics) {
      const draft = {
        ...newKnowledgeDraft("ru-RU"),
        title: topic.title,
        topic: topic.key,
        questions: topic.questions.map((question) => ({
          question,
          answer: "",
        })),
      };
      assert.equal(knowledgeMarkdown(draft), "");
    }
  }
});
test("file limits fail closed, never truncate or pretend a scan is text", () => {
  for (const name of ["image.png", "script.js", "evil.docm"])
    assert.throws(() => validateKnowledgeFile(name, 100));
  assert.throws(() => validateKnowledgeFile("notes.pdf", 11 * 1024 * 1024));
  assert.throws(() => validateDocxArchive(new ArrayBuffer(20)));
  assert.throws(() => validateExtractedText(" "));
  assert.throws(() => validateExtractedText("x".repeat(50001)));
  assert.throws(() => validateExtractedText("a\0b"));
  assert.equal(validateKnowledgeFile("notes.PDF", 100), "pdf");
  assert.equal(plainTextMarkdown("<script>\r\n[x]"), "\\<script\\>\n\\[x\\]");
});
