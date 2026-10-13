import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const sourceRoot = path.resolve("src");
const files = [];
const dispatcherPath = path.join(sourceRoot, "app/actions/[name]/route.ts");

const dispatcherText = await readFile(dispatcherPath, "utf8");
const dispatcher = ts.createSourceFile(
  dispatcherPath,
  dispatcherText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const actionRegistry = new Set();

function collectRegisteredActions(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "actions"
  ) {
    if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) {
      throw new Error("The stable action registry must be an object literal.");
    }
    for (const property of node.initializer.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ) {
        actionRegistry.add(property.name.text);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        actionRegistry.add(property.name.text);
      }
    }
  }
  ts.forEachChild(node, collectRegisteredActions);
}

collectRegisteredActions(dispatcher);
if (!actionRegistry.size) throw new Error("The stable action registry is empty.");

async function collectTsx(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectTsx(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }
}

await collectTsx(sourceRoot);

const violations = [];
for (const file of files) {
  const sourceText = await readFile(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(source);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(source);
        if (name !== "formAction" && !(tagName === "form" && name === "action")) continue;

        const initializer = attribute.initializer;
        if (!initializer || !ts.isStringLiteral(initializer)) {
          const { line } = source.getLineAndCharacterOfPosition(attribute.getStart(source));
          violations.push(
            `${path.relative(process.cwd(), file)}:${line + 1}: ${tagName} ${name} must be a literal URL`,
          );
        } else if (!initializer.text.startsWith("/")) {
          const { line } = source.getLineAndCharacterOfPosition(attribute.getStart(source));
          violations.push(
            `${path.relative(process.cwd(), file)}:${line + 1}: ${tagName} ${name} must use a same-origin route`,
          );
        } else if (
          tagName === "form" &&
          name === "action" &&
          initializer.text.startsWith("/actions/") &&
          !actionRegistry.has(initializer.text.slice("/actions/".length))
        ) {
          const { line } = source.getLineAndCharacterOfPosition(attribute.getStart(source));
          violations.push(
            `${path.relative(process.cwd(), file)}:${line + 1}: no stable action is registered for ${initializer.text}`,
          );
        } else if (tagName === "form" && name === "action") {
          const method = node.attributes.properties.find(
            (candidate) =>
              ts.isJsxAttribute(candidate) && candidate.name.getText(source) === "method",
          );
          if (
            !method ||
            !ts.isJsxAttribute(method) ||
            !method.initializer ||
            !ts.isStringLiteral(method.initializer) ||
            method.initializer.text.toLowerCase() !== "post"
          ) {
            const { line } = source.getLineAndCharacterOfPosition(attribute.getStart(source));
            violations.push(
              `${path.relative(process.cwd(), file)}:${line + 1}: mutating form routes must use method="post"`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
}

if (violations.length) {
  console.error("Form submissions must use stable, same-origin route URLs:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${files.length} TSX files: form actions use stable, same-origin route URLs.`,
  );
}
