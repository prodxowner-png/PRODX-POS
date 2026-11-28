import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

class NotFoundError extends Error {}

function installDenoShim() {
  globalThis.Deno = {
    args: [],
    errors: { NotFound: NotFoundError },
    exit(code = 0) {
      throw new Error(`Deno.exit(${code})`);
    },
    async readTextFile(filePath) {
      return fs.readFile(filePath, "utf8");
    },
    async writeTextFile(filePath, content) {
      await fs.writeFile(filePath, content, "utf8");
    },
    async stat(filePath) {
      try {
        const s = await fs.stat(filePath);
        return { isDirectory: s.isDirectory(), isFile: s.isFile() };
      } catch (err) {
        if (err && err.code === "ENOENT") {
          throw new NotFoundError(err.message);
        }
        throw err;
      }
    },
  };
}

async function loadDenoScript(scriptName) {
  installDenoShim();
  const tsPath = path.join(SCRIPTS_DIR, scriptName);
  const rawTs = await fs.readFile(tsPath, "utf8");

  // Rewrite Deno JSR std imports to Node built-in equivalents for unit testing
  const rewritten = rawTs
    .replace(/^#!.*\n/, "")
    .replace(/import\s+\{[^}]*\}\s+from\s+"jsr:@std\/cli@[^"]+";\n/g, "")
    .replace(
      /import\s+\{([^}]*)\}\s+from\s+"jsr:@std\/path@[^"]+";\n/g,
      'import { $1 } from "node:path";\n'
    )
    .replace(/import\s+\{[^}]*\}\s+from\s+"jsr:@std\/fs@[^"]+";\n/g, "")
    .replace(/if\s*\(import\.meta\.main\)\s*\{[\s\S]*?\}\s*$/, "");

  const helpers = `
const parseArgs = () => ({ _: [] });
const ensureDir = async (dir) => {
  const fsMod = await import("node:fs/promises");
  await fsMod.mkdir(dir, { recursive: true });
};
async function* walk(rootDir, opts = {}) {
  const fsMod = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const entries = await fsMod.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = pathMod.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, opts);
    } else if (entry.isFile()) {
      const ext = pathMod.extname(entry.name);
      const exts = (opts.exts || []).map((e) => (e.startsWith(".") ? e : "." + e));
      if (exts.length === 0 || exts.includes(ext)) {
        yield { path: full };
      }
    }
  }
}
`;

  const jsCode = stripTypeScriptTypes(rewritten, { mode: "strip" });
  const moduleSource = `${helpers}\n${jsCode}`;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(moduleSource, "utf8").toString("base64")}`;
  return import(dataUrl);
}

function assertValidCommonJsModule(code, label) {
  const sandbox = { module: { exports: {} }, exports: {} };
  assert.doesNotThrow(() => {
    vm.runInNewContext(code, sandbox, { filename: `${label}.js` });
  }, `${label} must be valid parseable JavaScript`);
  return sandbox.module.exports;
}

test("generate-tokens: blocks path traversal in spec names and output paths", async () => {
  const mod = await loadDenoScript("generate-tokens.ts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-tokens-"));
  try {
    const badSpecPath = path.join(tmpDir, "bad-spec.json");
    await fs.writeFile(
      badSpecPath,
      JSON.stringify({
        name: "../../escaped",
        tokens: { color: { primary: "#112233" } },
        outputFormats: ["css"],
      })
    );

    await assert.rejects(
      () => mod.generateTokens({ specFile: badSpecPath, outputDir: tmpDir }),
      /Invalid token specification name/
    );

    assert.throws(
      () => mod.resolveContainedOutputPath(tmpDir, "../escape.css"),
      /path traversal|outside output directory/
    );
    assert.throws(
      () => mod.resolveContainedOutputPath(tmpDir, "nested/file.css"),
      /path traversal|outside output directory/
    );

    const safePath = mod.resolveContainedOutputPath(tmpDir, "brand-tokens.css");
    assert.equal(safePath, path.resolve(tmpDir, "brand-tokens.css"));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("generate-tokens: preserves valid JS and TS syntax for hyphenated and numeric keys", async () => {
  const mod = await loadDenoScript("generate-tokens.ts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-tokens-keys-"));
  try {
    const specPath = path.join(tmpDir, "spec.json");
    await fs.writeFile(
      specPath,
      JSON.stringify({
        name: "My Design System",
        tokens: {
          color: {
            primary: "#2563eb",
            "gray-100": "#f3f4f6",
            "brand-scale": { "50": "#eff6ff", "950": "#172554" },
          },
          typography: {
            fontSizes: { "2xl": "1.5rem", "body-sm": "0.875rem" },
          },
        },
        outputFormats: ["tailwind", "ts"],
      })
    );

    const outputs = await mod.generateTokens({ specFile: specPath, outputDir: tmpDir });
    const tailwindCode = outputs.get("my-design-system.tailwind.js");
    assert.ok(tailwindCode, "tailwind output should be generated");
    const parsedTw = assertValidCommonJsModule(tailwindCode, "tokens.tailwind");
    assert.equal(parsedTw.colors["gray-100"], "#f3f4f6");
    assert.equal(parsedTw.fontSize["2xl"], "1.5rem");

    const tsCode = outputs.get("my-design-system.ts");
    assert.ok(tsCode, "ts output should be generated");
    assert.match(tsCode, /"gray-100": string;/);
    assert.match(tsCode, /"brand-scale": Record<string, string>;/);
    assert.doesNotThrow(
      () => stripTypeScriptTypes(tsCode, { mode: "strip" }),
      "generated TypeScript output must parse cleanly"
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("extract-tokens: classifies shadow variables as shadow and quotes hyphenated Tailwind keys", async () => {
  const mod = await loadDenoScript("extract-tokens.ts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-extract-"));
  try {
    const cssPath = path.join(tmpDir, "tokens.css");
    await fs.writeFile(
      cssPath,
      `:root {
  --gray-100: #f3f4f6;
  --color-primary: #2563eb;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-color: rgba(0, 0, 0, 0.15);
}`
    );

    const extracted = await mod.extractTokens({
      input: cssPath,
      format: "tailwind",
      outputCss: false,
      pretty: true,
    });

    assert.ok(extracted.tokens.shadow["shadow-sm"], "--shadow-sm must classify as shadow");
    assert.equal(extracted.tokens.color["shadow-sm"], undefined, "--shadow-sm must not classify as color");
    assert.ok(extracted.tokens.color["shadow-color"], "--shadow-color still classifies as color");

    const twOutput = mod.formatOutput(extracted, {
      input: cssPath,
      format: "tailwind",
      outputCss: false,
      pretty: true,
    });
    const parsedTw = assertValidCommonJsModule(twOutput, "extract-tokens.tailwind");
    assert.equal(parsedTw.theme.extend.boxShadow["shadow-sm"], "0 1px 2px rgba(0, 0, 0, 0.05)");
    assert.equal(parsedTw.theme.extend.colors["gray-100"], "#f3f4f6");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("analyze-accessibility: accepts aria-label and aria-labelledby on empty links and buttons", async () => {
  const mod = await loadDenoScript("analyze-accessibility.ts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-a11y-"));
  try {
    const validPath = path.join(tmpDir, "ValidControls.tsx");
    await fs.writeFile(
      validPath,
      `export function Controls() {
  return (
    <div>
      <button aria-label="Close modal"></button>
      <button aria-labelledby="save-title"> </button>
      <a href="/home" aria-label="Go home"></a>
      <a href="/help" aria-labelledby="help-label"></a>
    </div>
  );
}`
    );

    const validResults = await mod.analyzeAccessibility({
      input: validPath,
      level: "AA",
      format: "json",
      pretty: false,
    });
    assert.equal(validResults[0].issues.length, 0, "accessible icon-only controls should have zero errors");

    const invalidPath = path.join(tmpDir, "InvalidControls.tsx");
    await fs.writeFile(
      invalidPath,
      `export function BadControls() {
  return (
    <div>
      <button></button>
      <button aria-label="   "></button>
      <a href="/empty"></a>
    </div>
  );
}`
    );

    const invalidResults = await mod.analyzeAccessibility({
      input: invalidPath,
      level: "AA",
      format: "json",
      pretty: false,
    });
    assert.equal(invalidResults[0].issues.length, 3, "empty controls without real accessible names must fail");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("generate-palette: enforces AA and AAA WCAG contrast targets and produces valid Tailwind JS", async () => {
  const mod = await loadDenoScript("generate-palette.ts");

  const aaPalette = await mod.generatePalette({
    seed: "#93c5fd", // very light blue (~1.8:1 on white)
    shades: false,
    semantic: true,
    contrast: "AA",
    format: "json",
  });
  assert.ok(mod.getContrastRatio(aaPalette.primary.DEFAULT, "#ffffff") >= 4.5);
  assert.ok(mod.getContrastRatio(aaPalette.secondary.DEFAULT, "#ffffff") >= 4.5);
  assert.ok(mod.getContrastRatio(aaPalette.accent.DEFAULT, "#ffffff") >= 4.5);
  assert.ok(mod.getContrastRatio(aaPalette.semantic.warning["500"], "#ffffff") >= 4.5);

  const aaaPalette = await mod.generatePalette({
    seed: "#2563eb", // passes AA (~5.3:1) but fails AAA on white
    shades: true,
    semantic: true,
    contrast: "AAA",
    format: "tailwind",
  });
  assert.ok(mod.getContrastRatio(aaaPalette.primary["500"], "#ffffff") >= 7.0);
  assert.ok(mod.getContrastRatio(aaaPalette.secondary["500"], "#ffffff") >= 7.0);
  assert.ok(mod.getContrastRatio(aaaPalette.accent["500"], "#ffffff") >= 7.0);
  assert.ok(mod.getContrastRatio(aaaPalette.semantic.error["500"], "#ffffff") >= 7.0);

  const paletteTw = mod.formatOutput(aaaPalette, "tailwind");
  const parsedPaletteTw = assertValidCommonJsModule(paletteTw, "generate-palette.tailwind");
  assert.equal(parsedPaletteTw.theme.extend.colors.primary["500"], aaaPalette.primary["500"]);

  const darkAaa = await mod.generatePalette({
    seed: "#1e3a8a", // dark blue on dark surface
    theme: "dark",
    shades: false,
    semantic: false,
    contrast: "AAA",
    format: "json",
  });
  assert.ok(mod.getContrastRatio(darkAaa.primary.DEFAULT, "#0f172a") >= 7.0);
});

test("generate-typography: produces valid JS Tailwind config for 2xl-6xl keys", async () => {
  const mod = await loadDenoScript("generate-typography.ts");
  const typography = await mod.generateTypography({
    display: "Space Grotesk",
    body: "Inter",
    scale: "major-third",
    base: 16,
    lineHeight: "normal",
    responsive: false,
    format: "tailwind",
  });
  const twOutput = mod.formatOutput(typography, {
    display: "Space Grotesk",
    body: "Inter",
    scale: "major-third",
    base: 16,
    lineHeight: "normal",
    responsive: false,
    format: "tailwind",
  });
  const parsedTw = assertValidCommonJsModule(twOutput, "generate-typography.tailwind");
  assert.ok(Array.isArray(parsedTw.theme.extend.fontSize["2xl"]));
  assert.ok(Array.isArray(parsedTw.theme.extend.fontSize["6xl"]));
});

test("generate-component: loads --spec, renders semantic inputs & all types, supports styled-components/emotion", async () => {
  const mod = await loadDenoScript("generate-component.ts");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fd-comp-"));
  try {
    // 1. --spec loading
    const specPath = path.join(tmpDir, "component-spec.json");
    await fs.writeFile(
      specPath,
      JSON.stringify({
        name: "SearchInput",
        type: "input",
        framework: "svelte",
        styling: "css",
        aesthetic: { style: "minimal", animation: "subtle", darkMode: true },
      })
    );

    const specOutputs = await mod.generateComponent({
      specFile: specPath,
      outputDir: tmpDir,
    });
    assert.ok(specOutputs.has("SearchInput.svelte"), "spec framework & name must be honored");
    const svelteInput = specOutputs.get("SearchInput.svelte");
    assert.match(svelteInput, /<label\b/);
    assert.match(svelteInput, /<input\b/);
    assert.doesNotMatch(svelteInput, /<button\b/);

    // 2. input renders form controls across React, Vue, Svelte, HTML
    for (const fw of ["react", "vue", "svelte", "html"]) {
      const out = await mod.generateComponent({
        name: "EmailField",
        type: "input",
        framework: fw,
        styling: "tailwind",
        outputDir: tmpDir,
      });
      const code = [...out.values()][0];
      assert.match(code, /<label\b/, `${fw} input must render <label>`);
      assert.match(code, /<input\b/, `${fw} input must render <input>`);
      assert.match(code, /role="alert"/, `${fw} input must render error alert markup`);
      assert.doesNotMatch(code, /<button\b/, `${fw} input must not hardcode <button>`);
    }

    // 3. All advertised types emit distinct semantic elements (never fallback to button)
    const expectedPatterns = {
      card: /<article\b/,
      modal: /role="dialog"/,
      navigation: /<nav\b/,
      hero: /<section\b/,
      custom: /<div\b/,
    };
    for (const [type, pattern] of Object.entries(expectedPatterns)) {
      const out = await mod.generateComponent({
        name: "SampleComp",
        type,
        framework: "react",
        styling: "tailwind",
        outputDir: tmpDir,
      });
      const code = out.get("SampleComp.tsx");
      assert.match(code, pattern, `type=${type} should emit expected semantic element`);
    }

    // 4. styled-components and emotion emit real imports without broken .css imports
    const scOut = await mod.generateComponent({
      name: "ActionBtn",
      type: "button",
      framework: "react",
      styling: "styled-components",
      outputDir: tmpDir,
    });
    assert.deepEqual([...scOut.keys()], ["ActionBtn.tsx"]);
    assert.match(scOut.get("ActionBtn.tsx"), /from 'styled-components'/);
    assert.doesNotMatch(scOut.get("ActionBtn.tsx"), /ActionBtn\.css/);

    const emOut = await mod.generateComponent({
      name: "TextBox",
      type: "input",
      framework: "react",
      styling: "emotion",
      outputDir: tmpDir,
    });
    assert.deepEqual([...emOut.keys()], ["TextBox.tsx"]);
    assert.match(emOut.get("TextBox.tsx"), /from '@emotion\/styled'/);
    assert.doesNotMatch(emOut.get("TextBox.tsx"), /TextBox\.css/);

    // 5. Rejects styled-components on non-React and path-traversal names
    await assert.rejects(
      () =>
        mod.generateComponent({
          name: "BadVue",
          type: "button",
          framework: "vue",
          styling: "styled-components",
          outputDir: tmpDir,
        }),
      /only supported for the 'react' framework/
    );
    await assert.rejects(
      () =>
        mod.generateComponent({
          name: "../Escape",
          type: "button",
          framework: "react",
          styling: "tailwind",
          outputDir: tmpDir,
        }),
      /Invalid component name/
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
