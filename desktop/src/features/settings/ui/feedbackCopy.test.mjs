import assert from "node:assert/strict";
import test from "node:test";
import { feedbackText } from "./feedbackCopy.ts";
test("feedback labels follow locale without changing persisted category ids", () => {
  assert.equal(feedbackText("Send feedback", true), "Отправить отзыв");
  assert.equal(feedbackText("Bug", true), "Ошибка");
  assert.equal(feedbackText("Send feedback", false), "Send feedback");
  assert.equal(
    feedbackText("Attach diagnostics", true),
    "Добавить технические сведения",
  );
});
