// Read-only inventory of UI literals. Excludes protocol values and user-authored content.
import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const roots = ["src/features/channels", "src/features/messages"];
const rows = [];
function visitDir(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitDir(path);
      continue;
    }
    if (!/\.tsx?$/.test(path) || /\.test\./.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      const jsx = ts.isJsxText(node);
      const str =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
      if (jsx || str) {
        const value = (jsx ? node.getText(source) : node.text)
          .replace(/\s+/g, " ")
          .trim();
        const parent = node.parent;
        const attr = ts.isJsxAttribute(parent)
          ? parent.name.getText(source)
          : null;
        const prop = ts.isPropertyAssignment(parent)
          ? parent.name.getText(source)
          : null;
        const ui =
          jsx ||
          (attr &&
            /^(aria-label|title|placeholder|description|label|alt)$/.test(
              attr,
            )) ||
          (prop &&
            /^(label|title|description|placeholder|emptyMessage|errorMessage)$/.test(
              prop,
            ));
        const copyCall =
          ts.isCallExpression(parent) &&
          /messageText|^m$/.test(parent.expression.getText(source));
        const broad =
          process.argv.includes("--all-literals") &&
          str &&
          !copyCall &&
          !ts.isImportDeclaration(parent) &&
          !ts.isExportDeclaration(parent) &&
          !ts.isLiteralTypeNode(parent) &&
          !ts.isJsxAttribute(parent) &&
          !(ts.isPropertyAssignment(parent) && node === parent.name) &&
          !(prop && /class|style|key|type|value|testId|name/i.test(prop)) &&
          !/class|selector|Selector|RegExp/.test(
            parent.getText(source).slice(0, 45),
          ) &&
          /^[A-Za-z][A-Za-z ,’'()\-…:.!?]+$/.test(value) &&
          (/\s/.test(value) || /^[A-Z]/.test(value));
        if ((ui || broad) && /[a-zA-Z]/.test(value) && !/[а-яА-Я]/.test(value))
          rows.push({
            path,
            line:
              source.getLineAndCharacterOfPosition(node.getStart(source)).line +
              1,
            value,
            kind: jsx ? "text" : attr ? "attribute" : "property",
          });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
roots.forEach(visitDir);
if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
else
  for (const [value, count] of [
    ...rows.reduce(
      (map, row) => map.set(row.value, (map.get(row.value) ?? 0) + 1),
      new Map(),
    ),
  ])
    console.log(`${count}\t${value}`);
