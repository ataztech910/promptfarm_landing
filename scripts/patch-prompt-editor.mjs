import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function patchPromptEditor() {
  const target = join(process.cwd(), "node_modules", "@promptfarm", "prompt-editor", "dist", "index.js");

  if (!existsSync(target)) {
    console.log(`[patch-prompt-editor] Skipped: ${target} not found.`);
    return;
  }

  const source = readFileSync(target, "utf8");

  if (source.includes("immediatelyRender: false")) {
    console.log("[patch-prompt-editor] Already patched.");
    return;
  }

  const needle = "  const editor = useEditor({\n    extensions: [StarterKit, PromptBlockNode],";
  const replacement = "  const editor = useEditor({\n    immediatelyRender: false,\n    extensions: [StarterKit, PromptBlockNode],";

  if (!source.includes(needle)) {
    console.error("[patch-prompt-editor] Failed: expected PromptEditor pattern not found. Package format may have changed.");
    process.exit(1);
  }

  writeFileSync(target, source.replace(needle, replacement), "utf8");
  console.log("[patch-prompt-editor] Patched @promptfarm/prompt-editor.");
}

function patchTiptapReactFile(filePath, label) {
  if (!existsSync(filePath)) {
    console.log(`[patch-prompt-editor] Skipped: ${filePath} not found.`);
    return;
  }

  const source = readFileSync(filePath, "utf8");

  const alreadyPatched = source.includes("if (isSSR || isNext) {\n        return null;\n      }");
  if (alreadyPatched) {
    console.log(`[patch-prompt-editor] ${label} already patched.`);
    return;
  }

  const devThrowBlock = /if \(isSSR \|\| isNext\) \{\n\s*if \(isDev\) \{\n\s*throw new Error\([\s\S]*?\);\n\s*\}\n\s*return null;\n\s*\}/m;

  if (!devThrowBlock.test(source)) {
    console.error(`[patch-prompt-editor] Failed: expected Tiptap SSR dev-throw block not found in ${label}.`);
    process.exit(1);
  }

  const patched = source.replace(devThrowBlock, "if (isSSR || isNext) {\n        return null;\n      }");
  writeFileSync(filePath, patched, "utf8");
  console.log(`[patch-prompt-editor] Patched ${label}.`);
}

function patchTiptapReact() {
  const esm = join(process.cwd(), "node_modules", "@tiptap", "react", "dist", "index.js");
  const cjs = join(process.cwd(), "node_modules", "@tiptap", "react", "dist", "index.cjs");
  patchTiptapReactFile(esm, "@tiptap/react dist/index.js");
  patchTiptapReactFile(cjs, "@tiptap/react dist/index.cjs");
}

patchPromptEditor();
patchTiptapReact();
