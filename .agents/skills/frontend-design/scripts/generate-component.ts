#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * generate-component.ts - Component Template Generator
 *
 * Generates component templates with design-focused styling
 * for multiple frameworks (React, Vue, Svelte, HTML).
 */

import { parseArgs } from "jsr:@std/cli@1.0.9/parse-args";
import { resolve, relative, isAbsolute } from "jsr:@std/path@1.0.8";
import { ensureDir } from "jsr:@std/fs@1.0.8/ensure-dir";

// === Constants ===
const VERSION = "1.0.0";
const SCRIPT_NAME = "generate-component";

type Framework = "react" | "vue" | "svelte" | "html";
type Styling = "css" | "tailwind" | "css-modules" | "styled-components" | "emotion";
type Aesthetic = "minimal" | "bold" | "organic" | "brutalist" | "glassmorphism" | "neumorphism";
type Animation = "none" | "subtle" | "expressive";
type ComponentType = "button" | "card" | "input" | "modal" | "navigation" | "hero" | "custom";

const VALID_FRAMEWORKS: Framework[] = ["react", "vue", "svelte", "html"];
const VALID_STYLING: Styling[] = ["css", "tailwind", "css-modules", "styled-components", "emotion"];
const VALID_AESTHETICS: Aesthetic[] = [
  "minimal",
  "bold",
  "organic",
  "brutalist",
  "glassmorphism",
  "neumorphism",
];
const VALID_TYPES: ComponentType[] = [
  "button",
  "card",
  "input",
  "modal",
  "navigation",
  "hero",
  "custom",
];
const VALID_ANIMATIONS: Animation[] = ["none", "subtle", "expressive"];

// === Types ===
export interface ComponentSpec {
  name: string;
  type?: ComponentType;
  framework: Framework;
  styling?: Styling;
  aesthetic?: {
    style?: Aesthetic;
    animation?: Animation;
    darkMode?: boolean;
  };
  tokens?: string;
  props?: Record<string, { type: string; default?: string; required?: boolean }>;
  slots?: string[];
  variants?: string[];
}

export interface GenerateOptions {
  specFile?: string;
  name?: string;
  type?: ComponentType;
  framework?: Framework;
  styling?: Styling;
  aesthetic?: Aesthetic;
  animation?: Animation;
  darkMode?: boolean;
  tokens?: string;
  outputDir: string;
}

interface ResolvedGenerateOptions {
  name: string;
  type: ComponentType;
  framework: Framework;
  styling: Styling;
  aesthetic: Aesthetic;
  animation: Animation;
  darkMode: boolean;
  tokens?: string;
  outputDir: string;
}

interface ComponentTemplate {
  styles: string;
  component: string;
}

// === Validation & Path Containment ===

export function validateComponentName(name: string): string {
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(name) || name.length > 64) {
    throw new Error(
      `Invalid component name '${name}': must be PascalCase alphanumeric starting with an uppercase letter (max 64 chars)`
    );
  }
  return name;
}

export function resolveContainedOutputPath(outputDir: string, fileName: string): string {
  const outPath = resolve(outputDir);
  if (
    !fileName ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("..")
  ) {
    throw new Error(`Invalid output filename '${fileName}': path traversal is not allowed`);
  }
  const filePath = resolve(outPath, fileName);
  const rel = relative(outPath, filePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("/") || rel.includes("\\")) {
    throw new Error(`Refusing to write '${fileName}' outside output directory '${outPath}'`);
  }
  return filePath;
}

async function resolveGenerateOptions(options: GenerateOptions): Promise<ResolvedGenerateOptions> {
  let spec: Partial<ComponentSpec> = {};

  if (options.specFile) {
    const specContent = await Deno.readTextFile(resolve(options.specFile));
    const parsed = JSON.parse(specContent);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Component specification must be a JSON object");
    }
    spec = parsed as Partial<ComponentSpec>;
    if (!spec.name || typeof spec.name !== "string") {
      throw new Error("Component specification must include a valid string 'name'");
    }
    if (!spec.framework || typeof spec.framework !== "string") {
      throw new Error("Component specification must include a valid string 'framework'");
    }
  }

  const name = validateComponentName(options.name ?? spec.name ?? "");
  const framework = (options.framework ?? spec.framework ?? "react") as Framework;
  const type = (options.type ?? spec.type ?? (options.specFile ? "custom" : "button")) as ComponentType;
  const styling = (options.styling ?? spec.styling ?? "css") as Styling;
  const aesthetic = (options.aesthetic ?? spec.aesthetic?.style ?? "minimal") as Aesthetic;
  const animation = (options.animation ?? spec.aesthetic?.animation ?? "subtle") as Animation;
  const darkMode = options.darkMode ?? spec.aesthetic?.darkMode ?? false;
  const tokens = options.tokens ?? spec.tokens;

  if (!VALID_FRAMEWORKS.includes(framework)) {
    throw new Error(`Invalid framework '${framework}'. Valid: ${VALID_FRAMEWORKS.join(", ")}`);
  }
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid component type '${type}'. Valid: ${VALID_TYPES.join(", ")}`);
  }
  if (!VALID_STYLING.includes(styling)) {
    throw new Error(`Invalid styling '${styling}'. Valid: ${VALID_STYLING.join(", ")}`);
  }
  if (!VALID_AESTHETICS.includes(aesthetic)) {
    throw new Error(`Invalid aesthetic '${aesthetic}'. Valid: ${VALID_AESTHETICS.join(", ")}`);
  }
  if (!VALID_ANIMATIONS.includes(animation)) {
    throw new Error(`Invalid animation '${animation}'. Valid: ${VALID_ANIMATIONS.join(", ")}`);
  }
  if ((styling === "styled-components" || styling === "emotion") && framework !== "react") {
    throw new Error(`Styling '${styling}' is only supported for the 'react' framework`);
  }

  return {
    name,
    type,
    framework,
    styling,
    aesthetic,
    animation,
    darkMode,
    tokens,
    outputDir: options.outputDir,
  };
}

// === Style Templates ===

const AESTHETIC_STYLES: Record<Aesthetic, Record<string, string>> = {
  minimal: {
    base: "border border-gray-200 bg-white text-gray-900",
    hover: "hover:border-gray-300",
    focus: "focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2",
    active: "active:bg-gray-50",
    transition: "transition-colors duration-150",
  },
  bold: {
    base: "bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold",
    hover: "hover:from-purple-700 hover:to-pink-700 hover:scale-105",
    focus: "focus:outline-none focus:ring-4 focus:ring-purple-300",
    active: "active:scale-95",
    transition: "transition-all duration-200 transform",
  },
  organic: {
    base: "bg-amber-50 text-amber-900 border-2 border-amber-200 rounded-3xl",
    hover: "hover:bg-amber-100 hover:border-amber-300",
    focus: "focus:outline-none focus:ring-2 focus:ring-amber-400",
    active: "active:bg-amber-200",
    transition: "transition-all duration-300 ease-out",
  },
  brutalist: {
    base: "bg-black text-white border-4 border-black font-mono uppercase tracking-wider",
    hover: "hover:bg-white hover:text-black",
    focus: "focus:outline-none focus:ring-0 focus:border-yellow-400",
    active: "active:translate-x-1 active:translate-y-1",
    transition: "transition-all duration-100",
  },
  glassmorphism: {
    base: "bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-xl",
    hover: "hover:bg-white/30",
    focus: "focus:outline-none focus:ring-2 focus:ring-white/50",
    active: "active:bg-white/40",
    transition: "transition-all duration-200",
  },
  neumorphism: {
    base: "bg-gray-100 text-gray-700 rounded-xl shadow-[8px_8px_16px_#d1d1d1,-8px_-8px_16px_#ffffff]",
    hover: "hover:shadow-[4px_4px_8px_#d1d1d1,-4px_-4px_8px_#ffffff]",
    focus: "focus:outline-none focus:shadow-[inset_4px_4px_8px_#d1d1d1,inset_-4px_-4px_8px_#ffffff]",
    active: "active:shadow-[inset_4px_4px_8px_#d1d1d1,inset_-4px_-4px_8px_#ffffff]",
    transition: "transition-shadow duration-200",
  },
};

const ANIMATION_STYLES: Record<Animation, string> = {
  none: "",
  subtle: "transition-all duration-200 ease-out",
  expressive: "transition-all duration-300 ease-out hover:scale-105 active:scale-95",
};

// === Component Templates ===

function getButtonTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  const styles = AESTHETIC_STYLES[options.aesthetic];
  const animation = ANIMATION_STYLES[options.animation];

  const cssClasses = [
    "px-4 py-2 rounded-lg font-medium",
    styles.base,
    styles.hover,
    styles.focus,
    styles.active,
    animation || styles.transition,
  ].join(" ");

  if (options.styling === "tailwind") {
    return { styles: "", component: cssClasses };
  }

  const cssStyles = `
.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  ${options.aesthetic === "minimal" ? `
  border: 1px solid #e5e7eb;
  background: white;
  color: #111827;
  ` : ""}
  ${options.aesthetic === "bold" ? `
  background: linear-gradient(to right, #9333ea, #ec4899);
  color: white;
  font-weight: 700;
  border: none;
  ` : ""}
  transition: all 0.2s ease-out;
}

.btn:hover {
  transform: translateY(-1px);
}

.btn:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.btn:active {
  transform: translateY(0);
}
${options.darkMode ? `
.dark .btn {
  background: #1f2937;
  color: white;
  border-color: #374151;
}
` : ""}`;

  return { styles: cssStyles, component: "btn" };
}

function getCardTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    const classes: Record<Aesthetic, string> = {
      minimal: "bg-white border border-gray-200 rounded-lg shadow-sm p-6",
      bold: "bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl p-8 shadow-2xl",
      organic: "bg-amber-50 border-2 border-amber-200 rounded-3xl p-8",
      brutalist: "bg-white border-4 border-black p-6",
      glassmorphism: "bg-white/20 backdrop-blur-lg border border-white/30 rounded-2xl p-6 shadow-xl",
      neumorphism: "bg-gray-100 rounded-2xl p-6 shadow-[8px_8px_16px_#d1d1d1,-8px_-8px_16px_#ffffff]",
    };
    return { styles: "", component: classes[options.aesthetic] };
  }

  const cssStyles = `
.card {
  padding: 1.5rem;
  border-radius: 0.5rem;
  background: white;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.card-header {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.card-body {
  color: #374151;
}

.card-footer {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}
${options.darkMode ? `
.dark .card {
  background: #1f2937;
  border-color: #374151;
  color: white;
}
` : ""}`;

  return { styles: cssStyles, component: "card" };
}

function getInputTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    return {
      styles: "",
      component:
        "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
    };
  }

  const cssStyles = `
.input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.input {
  width: 100%;
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-size: 1rem;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.input-error {
  border-color: #dc2626;
}

.input-error-message {
  font-size: 0.875rem;
  color: #dc2626;
}
${options.darkMode ? `
.dark .input {
  background: #1f2937;
  border-color: #4b5563;
  color: white;
}
` : ""}`;

  return { styles: cssStyles, component: "input" };
}

function getModalTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    return {
      styles: "",
      component: "w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl border border-gray-200",
    };
  }

  const cssStyles = `
.modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  padding: 1rem;
}

.modal {
  width: 100%;
  max-width: 32rem;
  border-radius: 0.75rem;
  background: white;
  padding: 1.5rem;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.modal-close {
  background: transparent;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}

.modal-body {
  color: #374151;
}
${options.darkMode ? `
.dark .modal {
  background: #1f2937;
  color: white;
}
` : ""}`;

  return { styles: cssStyles, component: "modal" };
}

function getNavigationTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    return {
      styles: "",
      component: "flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200",
    };
  }

  const cssStyles = `
.nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: white;
  border-bottom: 1px solid #e5e7eb;
}

.nav-brand {
  font-weight: 700;
  color: #111827;
}

.nav-list {
  display: flex;
  list-style: none;
  gap: 1rem;
  margin: 0;
  padding: 0;
}

.nav-link {
  color: #374151;
  text-decoration: none;
  font-weight: 500;
}

.nav-link:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
${options.darkMode ? `
.dark .nav {
  background: #111827;
  border-color: #374151;
  color: white;
}
` : ""}`;

  return { styles: cssStyles, component: "nav" };
}

function getHeroTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    return {
      styles: "",
      component: "py-16 px-6 text-left max-w-5xl mx-auto",
    };
  }

  const cssStyles = `
.hero {
  padding: 4rem 1.5rem;
  max-width: 64rem;
  margin: 0 auto;
}

.hero-title {
  font-size: 2.5rem;
  line-height: 1.15;
  font-weight: 700;
  color: #111827;
  margin: 0 0 1rem;
}

.hero-subtitle {
  font-size: 1.125rem;
  line-height: 1.6;
  color: #4b5563;
  margin: 0 0 1.5rem;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
${options.darkMode ? `
.dark .hero-title {
  color: white;
}
.dark .hero-subtitle {
  color: #d1d5db;
}
` : ""}`;

  return { styles: cssStyles, component: "hero" };
}

function getCustomTemplate(options: ResolvedGenerateOptions): ComponentTemplate {
  if (options.styling === "tailwind") {
    const styles = AESTHETIC_STYLES[options.aesthetic];
    return {
      styles: "",
      component: `p-4 rounded-lg ${styles.base}`,
    };
  }

  const cssStyles = `
.component {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
  background: white;
  color: #111827;
}
${options.darkMode ? `
.dark .component {
  background: #1f2937;
  border-color: #374151;
  color: white;
}
` : ""}`;

  return { styles: cssStyles, component: "component" };
}

// === React Generators ===

function generateReactStyled(options: ResolvedGenerateOptions): string {
  const { name, type, styling } = options;
  const styledImport =
    styling === "emotion"
      ? "import styled from '@emotion/styled';"
      : "import styled from 'styled-components';";

  if (type === "input") {
    return `import React, { useId } from 'react';
${styledImport}

export interface ${name}Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

const Wrapper = styled.div\`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
\`;

const Label = styled.label\`
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
\`;

const StyledInput = styled.input<{ $hasError?: boolean }>\`
  width: 100%;
  padding: 0.5rem 1rem;
  border: 1px solid \${({ $hasError }) => ($hasError ? '#dc2626' : '#d1d5db')};
  border-radius: 0.5rem;
  font-size: 1rem;
  &:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
\`;

const ErrorMessage = styled.p\`
  font-size: 0.875rem;
  color: #dc2626;
  margin: 0;
\`;

export function ${name}({ label, error, id, className, ...rest }: ${name}Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = \`\${inputId}-error\`;

  return (
    <Wrapper className={className}>
      <Label htmlFor={inputId}>{label}</Label>
      <StyledInput
        id={inputId}
        $hasError={Boolean(error)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && <ErrorMessage id={errorId} role="alert">{error}</ErrorMessage>}
    </Wrapper>
  );
}

export default ${name};
`;
  }

  if (type === "card") {
    return `import React from 'react';
${styledImport}

export interface ${name}Props {
  header?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

const StyledCard = styled.article\`
  padding: 1.5rem;
  border-radius: 0.5rem;
  background: white;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
\`;

export function ${name}({ header, children, footer, className }: ${name}Props) {
  return (
    <StyledCard className={className}>
      {header && <header>{header}</header>}
      <div>{children}</div>
      {footer && <footer>{footer}</footer>}
    </StyledCard>
  );
}

export default ${name};
`;
  }

  if (type === "modal") {
    return `import React, { useId } from 'react';
${styledImport}

export interface ${name}Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
}

const Backdrop = styled.div\`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.55);
  padding: 1rem;
\`;

const Dialog = styled.div\`
  width: 100%;
  max-width: 32rem;
  border-radius: 0.75rem;
  background: white;
  padding: 1.5rem;
\`;

export function ${name}({ open, title, onClose, children, className }: ${name}Props) {
  const titleId = useId();
  if (!open) return null;

  return (
    <Backdrop>
      <Dialog role="dialog" aria-modal="true" aria-labelledby={titleId} className={className}>
        <div>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="Close modal" onClick={onClose}>
            Close
          </button>
        </div>
        <div>{children}</div>
      </Dialog>
    </Backdrop>
  );
}

export default ${name};
`;
  }

  if (type === "navigation") {
    return `import React from 'react';
${styledImport}

export interface ${name}Item {
  label: string;
  href: string;
}

export interface ${name}Props {
  brand?: React.ReactNode;
  items: ${name}Item[];
  ariaLabel?: string;
  className?: string;
}

const StyledNav = styled.nav\`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: white;
  border-bottom: 1px solid #e5e7eb;
\`;

const NavList = styled.ul\`
  display: flex;
  list-style: none;
  gap: 1rem;
  margin: 0;
  padding: 0;
\`;

export function ${name}({ brand, items, ariaLabel = 'Primary navigation', className }: ${name}Props) {
  return (
    <StyledNav aria-label={ariaLabel} className={className}>
      {brand && <div>{brand}</div>}
      <NavList>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </NavList>
    </StyledNav>
  );
}

export default ${name};
`;
  }

  if (type === "hero") {
    return `import React, { useId } from 'react';
${styledImport}

export interface ${name}Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

const StyledHero = styled.section\`
  padding: 4rem 1.5rem;
  max-width: 64rem;
  margin: 0 auto;
\`;

export function ${name}({ title, subtitle, actions, className }: ${name}Props) {
  const headingId = useId();
  return (
    <StyledHero aria-labelledby={headingId} className={className}>
      <h1 id={headingId}>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {actions && <div>{actions}</div>}
    </StyledHero>
  );
}

export default ${name};
`;
  }

  if (type === "custom") {
    return `import React from 'react';
${styledImport}

export interface ${name}Props {
  children?: React.ReactNode;
  className?: string;
}

const StyledContainer = styled.div\`
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid #e5e7eb;
  background: white;
  color: #111827;
\`;

export function ${name}({ children, className }: ${name}Props) {
  return <StyledContainer className={className}>{children}</StyledContainer>;
}

export default ${name};
`;
  }

  // button
  return `import React from 'react';
${styledImport}

export interface ${name}Props {
  children?: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: () => void;
}

const StyledButton = styled.button<{ $variant: string; $size: string }>\`
  padding: \${({ $size }) => ($size === 'sm' ? '0.375rem 0.75rem' : $size === 'lg' ? '0.75rem 1.5rem' : '0.5rem 1rem')};
  border-radius: 0.5rem;
  font-weight: 500;
  cursor: pointer;
  border: \${({ $variant }) => ($variant === 'ghost' ? 'none' : '1px solid #e5e7eb')};
  background: \${({ $variant }) => ($variant === 'secondary' ? '#f3f4f6' : $variant === 'ghost' ? 'transparent' : '#111827')};
  color: \${({ $variant }) => ($variant === 'primary' ? '#ffffff' : '#111827')};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  &:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }
\`;

export function ${name}({
  children,
  className,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
}: ${name}Props) {
  return (
    <StyledButton
      type="button"
      className={className}
      $variant={variant}
      $size={size}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </StyledButton>
  );
}

export default ${name};
`;
}

function generateReact(options: ResolvedGenerateOptions, template: ComponentTemplate): string {
  const { name, type, styling } = options;

  if (styling === "styled-components" || styling === "emotion") {
    return generateReactStyled(options);
  }

  const styleImport =
    styling === "css-modules"
      ? `import styles from './${name}.module.css';\n`
      : styling === "css"
        ? `import './${name}.css';\n`
        : "";

  const cls = (cssClass: string, twClass: string, moduleKey?: string) => {
    if (styling === "tailwind") return `'${twClass}'`;
    if (styling === "css-modules") return `styles['${moduleKey ?? cssClass}']`;
    return `'${cssClass}'`;
  };

  if (type === "input") {
    const wrapperClass = cls("input-wrapper", "flex flex-col gap-2");
    const labelClass = cls("input-label", "text-sm font-medium text-gray-700");
    const inputClass = cls("input", template.component);
    const errorInputClass = cls("input-error", "border-red-600");
    const errorMsgClass = cls("input-error-message", "text-sm text-red-600");

    return `import React, { useId } from 'react';
${styleImport}
export interface ${name}Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function ${name}({ label, error, id, className = '', ...rest }: ${name}Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = \`\${inputId}-error\`;
  const inputClasses = [${inputClass}, error ? ${errorInputClass} : '', className].filter(Boolean).join(' ');

  return (
    <div className={${wrapperClass}}>
      <label htmlFor={inputId} className={${labelClass}}>
        {label}
      </label>
      <input
        id={inputId}
        className={inputClasses}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className={${errorMsgClass}}>
          {error}
        </p>
      )}
    </div>
  );
}

export default ${name};
`;
  }

  if (type === "card") {
    const rootClass = cls("card", template.component);
    const headerClass = cls("card-header", "mb-4 pb-4 border-b border-gray-200");
    const bodyClass = cls("card-body", "text-gray-700");
    const footerClass = cls("card-footer", "mt-4 pt-4 border-t border-gray-200");

    return `import React from 'react';
${styleImport}
export interface ${name}Props {
  header?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function ${name}({ header, children, footer, className = '' }: ${name}Props) {
  return (
    <article className={[${rootClass}, className].filter(Boolean).join(' ')}>
      {header && <header className={${headerClass}}>{header}</header>}
      <div className={${bodyClass}}>{children}</div>
      {footer && <footer className={${footerClass}}>{footer}</footer>}
    </article>
  );
}

export default ${name};
`;
  }

  if (type === "modal") {
    const backdropClass = cls(
      "modal-backdrop",
      "fixed inset-0 flex items-center justify-center bg-slate-900/55 p-4"
    );
    const dialogClass = cls("modal", template.component);
    const headerClass = cls("modal-header", "flex items-center justify-between mb-4");
    const closeClass = cls("modal-close", "px-2 py-1 rounded border border-gray-300");
    const bodyClass = cls("modal-body", "text-gray-700");

    return `import React, { useId } from 'react';
${styleImport}
export interface ${name}Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function ${name}({ open, title, onClose, children, className = '' }: ${name}Props) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div className={${backdropClass}}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={[${dialogClass}, className].filter(Boolean).join(' ')}
      >
        <div className={${headerClass}}>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="Close modal" className={${closeClass}} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={${bodyClass}}>{children}</div>
      </div>
    </div>
  );
}

export default ${name};
`;
  }

  if (type === "navigation") {
    const navClass = cls("nav", template.component);
    const brandClass = cls("nav-brand", "font-bold text-gray-900");
    const listClass = cls("nav-list", "flex items-center gap-4 list-none m-0 p-0");
    const linkClass = cls("nav-link", "text-gray-700 hover:text-gray-900 font-medium");

    return `import React from 'react';
${styleImport}
export interface ${name}Item {
  label: string;
  href: string;
}

export interface ${name}Props {
  brand?: React.ReactNode;
  items: ${name}Item[];
  ariaLabel?: string;
  className?: string;
}

export function ${name}({ brand, items, ariaLabel = 'Primary navigation', className = '' }: ${name}Props) {
  return (
    <nav aria-label={ariaLabel} className={[${navClass}, className].filter(Boolean).join(' ')}>
      {brand && <div className={${brandClass}}>{brand}</div>}
      <ul className={${listClass}}>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} className={${linkClass}}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default ${name};
`;
  }

  if (type === "hero") {
    const heroClass = cls("hero", template.component);
    const titleClass = cls("hero-title", "text-4xl font-bold text-gray-900 mb-4");
    const subtitleClass = cls("hero-subtitle", "text-lg text-gray-600 mb-6");
    const actionsClass = cls("hero-actions", "flex flex-wrap gap-3");

    return `import React, { useId } from 'react';
${styleImport}
export interface ${name}Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function ${name}({ title, subtitle, actions, className = '' }: ${name}Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={[${heroClass}, className].filter(Boolean).join(' ')}>
      <h1 id={headingId} className={${titleClass}}>
        {title}
      </h1>
      {subtitle && <p className={${subtitleClass}}>{subtitle}</p>}
      {actions && <div className={${actionsClass}}>{actions}</div>}
    </section>
  );
}

export default ${name};
`;
  }

  if (type === "custom") {
    const rootClass = cls("component", template.component);
    return `import React from 'react';
${styleImport}
export interface ${name}Props {
  children?: React.ReactNode;
  className?: string;
}

export function ${name}({ children, className = '' }: ${name}Props) {
  return <div className={[${rootClass}, className].filter(Boolean).join(' ')}>{children}</div>;
}

export default ${name};
`;
  }

  // button
  const propsInterface = `export interface ${name}Props {
  children?: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: () => void;
}`;

  if (styling === "tailwind") {
    return `import React from 'react';

${propsInterface}

const variants = {
  primary: '${template.component}',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
  ghost: 'bg-transparent hover:bg-gray-100',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

export function ${name}({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
}: ${name}Props) {
  return (
    <button
      type="button"
      className={\`\${variants[variant]} \${sizes[size]} \${className} \${disabled ? 'opacity-50 cursor-not-allowed' : ''}\`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default ${name};
`;
  }

  if (styling === "css-modules") {
    return `import React from 'react';
import styles from './${name}.module.css';

${propsInterface}

export function ${name}({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
}: ${name}Props) {
  const classes = [
    styles.${template.component},
    styles[variant],
    styles[size],
    disabled ? styles.disabled : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export default ${name};
`;
  }

  return `import React from 'react';
import './${name}.css';

${propsInterface}

export function ${name}({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
}: ${name}Props) {
  const classes = [
    '${template.component}',
    \`${template.component}--\${variant}\`,
    \`${template.component}--\${size}\`,
    disabled ? '${template.component}--disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type="button" className={classes} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export default ${name};
`;
}

// === Vue Generator ===

function generateVue(options: ResolvedGenerateOptions, template: ComponentTemplate): string {
  const { type, styling } = options;
  const styleBlock = styling === "tailwind" ? "" : `\n<style scoped>\n${template.styles}\n</style>\n`;

  if (type === "input") {
    const wrapperCls = styling === "tailwind" ? "flex flex-col gap-2" : "input-wrapper";
    const labelCls = styling === "tailwind" ? "text-sm font-medium text-gray-700" : "input-label";
    const inputCls = styling === "tailwind" ? template.component : "input";
    const errorCls = styling === "tailwind" ? "border-red-600" : "input-error";
    const errorMsgCls = styling === "tailwind" ? "text-sm text-red-600" : "input-error-message";

    return `<template>
  <div class="${wrapperCls}">
    <label :for="inputId" class="${labelCls}">{{ label }}</label>
    <input
      :id="inputId"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="Boolean(error)"
      :aria-describedby="error ? errorId : undefined"
      :class="['${inputCls}', { '${errorCls}': Boolean(error) }]"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error" :id="errorId" role="alert" class="${errorMsgCls}">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    id?: string;
    label: string;
    modelValue?: string;
    type?: string;
    placeholder?: string;
    error?: string;
    disabled?: boolean;
  }>(),
  {
    type: 'text',
    modelValue: '',
    disabled: false,
  }
);

defineEmits<{
  'update:modelValue': [value: string];
}>();

const inputId = props.id || 'input-field';
const errorId = \`\${inputId}-error\`;
</script>
${styleBlock}`;
  }

  if (type === "card") {
    const rootCls = styling === "tailwind" ? template.component : "card";
    return `<template>
  <article class="${rootCls}">
    <header v-if="$slots.header" class="${styling === "tailwind" ? "mb-4 pb-4 border-b border-gray-200" : "card-header"}">
      <slot name="header" />
    </header>
    <div class="${styling === "tailwind" ? "text-gray-700" : "card-body"}">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="${styling === "tailwind" ? "mt-4 pt-4 border-t border-gray-200" : "card-footer"}">
      <slot name="footer" />
    </footer>
  </article>
</template>

<script setup lang="ts">
defineProps<{ elevated?: boolean }>();
</script>
${styleBlock}`;
  }

  if (type === "modal") {
    return `<template>
  <div v-if="open" class="${styling === "tailwind" ? "fixed inset-0 flex items-center justify-center bg-slate-900/55 p-4" : "modal-backdrop"}">
    <div role="dialog" aria-modal="true" :aria-labelledby="titleId" class="${styling === "tailwind" ? template.component : "modal"}">
      <div class="${styling === "tailwind" ? "flex items-center justify-between mb-4" : "modal-header"}">
        <h2 :id="titleId">{{ title }}</h2>
        <button type="button" aria-label="Close modal" class="${styling === "tailwind" ? "px-2 py-1 rounded border border-gray-300" : "modal-close"}" @click="$emit('close')">
          Close
        </button>
      </div>
      <div class="${styling === "tailwind" ? "text-gray-700" : "modal-body"}">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ open: boolean; title: string }>();
defineEmits<{ close: [] }>();
const titleId = 'modal-title';
</script>
${styleBlock}`;
  }

  if (type === "navigation") {
    return `<template>
  <nav :aria-label="ariaLabel" class="${styling === "tailwind" ? template.component : "nav"}">
    <div class="${styling === "tailwind" ? "font-bold text-gray-900" : "nav-brand"}">
      <slot name="brand" />
    </div>
    <ul class="${styling === "tailwind" ? "flex items-center gap-4 list-none m-0 p-0" : "nav-list"}">
      <li v-for="item in items" :key="item.href">
        <a :href="item.href" class="${styling === "tailwind" ? "text-gray-700 hover:text-gray-900 font-medium" : "nav-link"}">
          {{ item.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    items: Array<{ label: string; href: string }>;
    ariaLabel?: string;
  }>(),
  { ariaLabel: 'Primary navigation' }
);
</script>
${styleBlock}`;
  }

  if (type === "hero") {
    return `<template>
  <section aria-labelledby="hero-heading" class="${styling === "tailwind" ? template.component : "hero"}">
    <h1 id="hero-heading" class="${styling === "tailwind" ? "text-4xl font-bold text-gray-900 mb-4" : "hero-title"}">{{ title }}</h1>
    <p v-if="subtitle" class="${styling === "tailwind" ? "text-lg text-gray-600 mb-6" : "hero-subtitle"}">{{ subtitle }}</p>
    <div class="${styling === "tailwind" ? "flex flex-wrap gap-3" : "hero-actions"}">
      <slot name="actions" />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>
${styleBlock}`;
  }

  if (type === "custom") {
    return `<template>
  <div class="${styling === "tailwind" ? template.component : "component"}">
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ className?: string }>();
</script>
${styleBlock}`;
  }

  // button
  if (styling === "tailwind") {
    return `<template>
  <button
    type="button"
    :class="[
      '${template.component}',
      variants[variant],
      sizes[size],
      { 'opacity-50 cursor-not-allowed': disabled }
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  }>(),
  { variant: 'primary', size: 'md', disabled: false }
);

defineEmits<{
  click: [];
}>();

const variants = {
  primary: '',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
  ghost: 'bg-transparent hover:bg-gray-100',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};
</script>
`;
  }

  return `<template>
  <button
    type="button"
    :class="[
      '${template.component}',
      '${template.component}--' + variant,
      '${template.component}--' + size,
      { '${template.component}--disabled': disabled }
    ]"
    :disabled="disabled"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  }>(),
  { variant: 'primary', size: 'md', disabled: false }
);

defineEmits<{
  click: [];
}>();
</script>

<style scoped>
${template.styles}

.${template.component}--secondary {
  background: #f3f4f6;
  color: #111827;
}

.${template.component}--ghost {
  background: transparent;
  border: none;
}

.${template.component}--sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
}

.${template.component}--lg {
  padding: 0.75rem 1.5rem;
  font-size: 1.125rem;
}

.${template.component}--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
`;
}

// === Svelte Generator ===

function generateSvelte(options: ResolvedGenerateOptions, template: ComponentTemplate): string {
  const { type, styling } = options;
  const styleBlock = styling === "tailwind" ? "" : `\n<style>\n${template.styles}\n</style>\n`;

  if (type === "input") {
    const wrapperCls = styling === "tailwind" ? "flex flex-col gap-2" : "input-wrapper";
    const labelCls = styling === "tailwind" ? "text-sm font-medium text-gray-700" : "input-label";
    const inputCls = styling === "tailwind" ? template.component : "input";
    const errorCls = styling === "tailwind" ? "border-red-600" : "input-error";
    const errorMsgCls = styling === "tailwind" ? "text-sm text-red-600" : "input-error-message";

    return `<script lang="ts">
  export let id = 'input-field';
  export let label: string;
  export let value = '';
  export let type = 'text';
  export let placeholder = '';
  export let error = '';
  export let disabled = false;

  $: errorId = \`\${id}-error\`;
</script>

<div class="${wrapperCls}">
  <label for={id} class="${labelCls}">{label}</label>
  <input
    {id}
    {type}
    bind:value
    {placeholder}
    {disabled}
    aria-invalid={Boolean(error)}
    aria-describedby={error ? errorId : undefined}
    class="${inputCls} {error ? '${errorCls}' : ''}"
    on:input
    on:blur
  />
  {#if error}
    <p id={errorId} role="alert" class="${errorMsgCls}">{error}</p>
  {/if}
</div>
${styleBlock}`;
  }

  if (type === "card") {
    return `<article class="${styling === "tailwind" ? template.component : "card"}">
  {#if $$slots.header}
    <header class="${styling === "tailwind" ? "mb-4 pb-4 border-b border-gray-200" : "card-header"}">
      <slot name="header" />
    </header>
  {/if}
  <div class="${styling === "tailwind" ? "text-gray-700" : "card-body"}">
    <slot />
  </div>
  {#if $$slots.footer}
    <footer class="${styling === "tailwind" ? "mt-4 pt-4 border-t border-gray-200" : "card-footer"}">
      <slot name="footer" />
    </footer>
  {/if}
</article>
${styleBlock}`;
  }

  if (type === "modal") {
    return `<script lang="ts">
  export let open = false;
  export let title = '';
  export let onClose: () => void = () => {};
</script>

{#if open}
  <div class="${styling === "tailwind" ? "fixed inset-0 flex items-center justify-center bg-slate-900/55 p-4" : "modal-backdrop"}">
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title" class="${styling === "tailwind" ? template.component : "modal"}">
      <div class="${styling === "tailwind" ? "flex items-center justify-between mb-4" : "modal-header"}">
        <h2 id="modal-title">{title}</h2>
        <button type="button" aria-label="Close modal" class="${styling === "tailwind" ? "px-2 py-1 rounded border border-gray-300" : "modal-close"}" on:click={onClose}>
          Close
        </button>
      </div>
      <div class="${styling === "tailwind" ? "text-gray-700" : "modal-body"}">
        <slot />
      </div>
    </div>
  </div>
{/if}
${styleBlock}`;
  }

  if (type === "navigation") {
    return `<script lang="ts">
  export let items: Array<{ label: string; href: string }> = [];
  export let ariaLabel = 'Primary navigation';
</script>

<nav aria-label={ariaLabel} class="${styling === "tailwind" ? template.component : "nav"}">
  <div class="${styling === "tailwind" ? "font-bold text-gray-900" : "nav-brand"}">
    <slot name="brand" />
  </div>
  <ul class="${styling === "tailwind" ? "flex items-center gap-4 list-none m-0 p-0" : "nav-list"}">
    {#each items as item}
      <li>
        <a href={item.href} class="${styling === "tailwind" ? "text-gray-700 hover:text-gray-900 font-medium" : "nav-link"}">
          {item.label}
        </a>
      </li>
    {/each}
  </ul>
</nav>
${styleBlock}`;
  }

  if (type === "hero") {
    return `<script lang="ts">
  export let title: string;
  export let subtitle = '';
</script>

<section aria-labelledby="hero-heading" class="${styling === "tailwind" ? template.component : "hero"}">
  <h1 id="hero-heading" class="${styling === "tailwind" ? "text-4xl font-bold text-gray-900 mb-4" : "hero-title"}">{title}</h1>
  {#if subtitle}
    <p class="${styling === "tailwind" ? "text-lg text-gray-600 mb-6" : "hero-subtitle"}">{subtitle}</p>
  {/if}
  <div class="${styling === "tailwind" ? "flex flex-wrap gap-3" : "hero-actions"}">
    <slot name="actions" />
  </div>
</section>
${styleBlock}`;
  }

  if (type === "custom") {
    return `<div class="${styling === "tailwind" ? template.component : "component"}">
  <slot />
</div>
${styleBlock}`;
  }

  // button
  if (styling === "tailwind") {
    return `<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let disabled = false;

  const variants = {
    primary: '${template.component}',
    secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
    ghost: 'bg-transparent hover:bg-gray-100',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };
</script>

<button
  type="button"
  class="{variants[variant]} {sizes[size]} {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
  {disabled}
  on:click
>
  <slot />
</button>
`;
  }

  return `<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'ghost' = 'primary';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let disabled = false;
</script>

<button
  type="button"
  class="${template.component} ${template.component}--{variant} ${template.component}--{size}"
  class:${template.component}--disabled={disabled}
  {disabled}
  on:click
>
  <slot />
</button>

<style>
${template.styles}

.${template.component}--secondary {
  background: #f3f4f6;
  color: #111827;
}

.${template.component}--ghost {
  background: transparent;
  border: none;
}

.${template.component}--sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
}

.${template.component}--lg {
  padding: 0.75rem 1.5rem;
  font-size: 1.125rem;
}

.${template.component}--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
`;
}

// === HTML Generator ===

function generateHTMLBody(options: ResolvedGenerateOptions, template: ComponentTemplate): string {
  const { name, type, styling } = options;

  if (type === "input") {
    const wrapperCls = styling === "tailwind" ? "flex flex-col gap-2" : "input-wrapper";
    const labelCls = styling === "tailwind" ? "text-sm font-medium text-gray-700" : "input-label";
    const inputCls = styling === "tailwind" ? template.component : "input";
    const errorMsgCls = styling === "tailwind" ? "text-sm text-red-600" : "input-error-message";
    return `  <div class="${wrapperCls}">
    <label for="${name.toLowerCase()}-field" class="${labelCls}">${name} Label</label>
    <input id="${name.toLowerCase()}-field" type="text" class="${inputCls}" aria-describedby="${name.toLowerCase()}-error" placeholder="Enter value" />
    <p id="${name.toLowerCase()}-error" role="alert" class="${errorMsgCls}" hidden>Error message</p>
  </div>`;
  }

  if (type === "card") {
    return `  <article class="${styling === "tailwind" ? template.component : "card"}">
    <header class="${styling === "tailwind" ? "mb-4 pb-4 border-b border-gray-200" : "card-header"}">Card Title</header>
    <div class="${styling === "tailwind" ? "text-gray-700" : "card-body"}">Card body content.</div>
    <footer class="${styling === "tailwind" ? "mt-4 pt-4 border-t border-gray-200" : "card-footer"}">Card footer</footer>
  </article>`;
  }

  if (type === "modal") {
    return `  <div class="${styling === "tailwind" ? "fixed inset-0 flex items-center justify-center bg-slate-900/55 p-4" : "modal-backdrop"}">
    <div role="dialog" aria-modal="true" aria-labelledby="${name.toLowerCase()}-title" class="${styling === "tailwind" ? template.component : "modal"}">
      <div class="${styling === "tailwind" ? "flex items-center justify-between mb-4" : "modal-header"}">
        <h2 id="${name.toLowerCase()}-title">${name}</h2>
        <button type="button" aria-label="Close modal" class="${styling === "tailwind" ? "px-2 py-1 rounded border border-gray-300" : "modal-close"}">Close</button>
      </div>
      <div class="${styling === "tailwind" ? "text-gray-700" : "modal-body"}">Modal content.</div>
    </div>
  </div>`;
  }

  if (type === "navigation") {
    return `  <nav aria-label="Primary navigation" class="${styling === "tailwind" ? template.component : "nav"}">
    <div class="${styling === "tailwind" ? "font-bold text-gray-900" : "nav-brand"}">${name}</div>
    <ul class="${styling === "tailwind" ? "flex items-center gap-4 list-none m-0 p-0" : "nav-list"}">
      <li><a href="#overview" class="${styling === "tailwind" ? "text-gray-700 hover:text-gray-900 font-medium" : "nav-link"}">Overview</a></li>
      <li><a href="#settings" class="${styling === "tailwind" ? "text-gray-700 hover:text-gray-900 font-medium" : "nav-link"}">Settings</a></li>
    </ul>
  </nav>`;
  }

  if (type === "hero") {
    return `  <section aria-labelledby="${name.toLowerCase()}-heading" class="${styling === "tailwind" ? template.component : "hero"}">
    <h1 id="${name.toLowerCase()}-heading" class="${styling === "tailwind" ? "text-4xl font-bold text-gray-900 mb-4" : "hero-title"}">${name} Headline</h1>
    <p class="${styling === "tailwind" ? "text-lg text-gray-600 mb-6" : "hero-subtitle"}">Supporting description for the hero section.</p>
    <div class="${styling === "tailwind" ? "flex flex-wrap gap-3" : "hero-actions"}">
      <a href="#action">Get Started</a>
    </div>
  </section>`;
  }

  if (type === "custom") {
    return `  <div class="${styling === "tailwind" ? template.component : "component"}">
    ${name} Content
  </div>`;
  }

  // button
  if (styling === "tailwind") {
    return `  <button type="button" class="${template.component}">Primary</button>
  <button type="button" class="bg-gray-100 text-gray-900 hover:bg-gray-200 px-4 py-2 rounded-lg">Secondary</button>
  <button type="button" class="bg-transparent hover:bg-gray-100 px-4 py-2 rounded-lg">Ghost</button>`;
  }

  return `  <button type="button" class="${template.component}">Primary Button</button>
  <button type="button" class="${template.component} ${template.component}--secondary">Secondary Button</button>
  <button type="button" class="${template.component} ${template.component}--ghost">Ghost Button</button>`;
}

function generateHTML(options: ResolvedGenerateOptions, template: ComponentTemplate): string {
  const { name, styling, type } = options;
  const body = generateHTMLBody(options, template);

  if (styling === "tailwind") {
    return `<!-- ${name} Component -->
<!-- Add Tailwind CSS to your project for these styles to work -->

${body}
`;
  }

  const buttonVariantsCss =
    type === "button"
      ? `
    .${template.component}--secondary {
      background: #f3f4f6;
      color: #111827;
    }

    .${template.component}--ghost {
      background: transparent;
      border: none;
    }

    .${template.component}--sm {
      padding: 0.375rem 0.75rem;
      font-size: 0.875rem;
    }

    .${template.component}--lg {
      padding: 0.75rem 1.5rem;
      font-size: 1.125rem;
    }

    .${template.component}--disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }`
      : "";

  return `<!-- ${name} Component -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} Component</title>
  <style>
${template.styles}${buttonVariantsCss}
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

// === File Extension Mapping ===

function getFileExtension(framework: Framework): string {
  switch (framework) {
    case "react":
      return "tsx";
    case "vue":
      return "vue";
    case "svelte":
      return "svelte";
    case "html":
      return "html";
    default:
      return "txt";
  }
}

// === Core Generation Function ===

export async function generateComponent(options: GenerateOptions): Promise<Map<string, string>> {
  const resolved = await resolveGenerateOptions(options);
  const outputs = new Map<string, string>();

  let template: ComponentTemplate;

  switch (resolved.type) {
    case "button":
      template = getButtonTemplate(resolved);
      break;
    case "card":
      template = getCardTemplate(resolved);
      break;
    case "input":
      template = getInputTemplate(resolved);
      break;
    case "modal":
      template = getModalTemplate(resolved);
      break;
    case "navigation":
      template = getNavigationTemplate(resolved);
      break;
    case "hero":
      template = getHeroTemplate(resolved);
      break;
    case "custom":
      template = getCustomTemplate(resolved);
      break;
    default:
      throw new Error(`Unsupported component type: ${resolved.type}`);
  }

  let componentCode: string;

  switch (resolved.framework) {
    case "react":
      componentCode = generateReact(resolved, template);
      break;
    case "vue":
      componentCode = generateVue(resolved, template);
      break;
    case "svelte":
      componentCode = generateSvelte(resolved, template);
      break;
    case "html":
      componentCode = generateHTML(resolved, template);
      break;
    default:
      throw new Error(`Unknown framework: ${resolved.framework}`);
  }

  const ext = getFileExtension(resolved.framework);
  const fileName = `${resolved.name}.${ext}`;
  outputs.set(fileName, componentCode);

  // Separate CSS files are imported by React css / css-modules outputs
  if (resolved.styling === "css" && template.styles && resolved.framework === "react") {
    outputs.set(`${resolved.name}.css`, template.styles);
  }

  if (resolved.styling === "css-modules" && template.styles && resolved.framework === "react") {
    outputs.set(`${resolved.name}.module.css`, template.styles);
  }

  return outputs;
}

// === Help Text ===

function printHelp(): void {
  console.log(`
${SCRIPT_NAME} v${VERSION} - Component Template Generator

Generates component templates with design-focused styling
for multiple frameworks (React, Vue, Svelte, HTML).

Usage:
  deno run --allow-read --allow-write scripts/${SCRIPT_NAME}.ts [options] <output-dir>

Arguments:
  <output-dir>         Directory for output files

Options:
  -h, --help           Show this help message
  -v, --version        Show version
  --spec <file>        JSON specification file
  --name <name>        Component name (PascalCase)
  --type <type>        Component type: button, card, input, modal, navigation, hero, custom
  --framework <fw>     Framework: react, vue, svelte, html
  --styling <type>     Styling: css, tailwind, css-modules, styled-components, emotion
  --aesthetic <type>   Aesthetic: minimal, bold, organic, brutalist, glassmorphism, neumorphism
  --animation <level>  Animation: none, subtle, expressive
  --dark-mode          Include dark mode support
  --tokens <file>      Use design tokens file

Examples:
  # Generate React button with Tailwind
  deno run --allow-read --allow-write scripts/${SCRIPT_NAME}.ts \\
    --name Button --framework react --styling tailwind --aesthetic bold ./components/

  # Generate Vue card with CSS
  deno run --allow-read --allow-write scripts/${SCRIPT_NAME}.ts \\
    --name Card --type card --framework vue --styling css ./components/

  # Generate Svelte input with minimal aesthetic
  deno run --allow-read --allow-write scripts/${SCRIPT_NAME}.ts \\
    --name Input --type input --framework svelte --aesthetic minimal ./components/

  # Generate from spec file
  deno run --allow-read --allow-write scripts/${SCRIPT_NAME}.ts \\
    --spec component-spec.json ./components/
`);
}

// === Main CLI Handler ===

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args, {
    boolean: ["help", "version", "dark-mode"],
    string: ["spec", "name", "type", "framework", "styling", "aesthetic", "animation", "tokens"],
    alias: { h: "help", v: "version" },
  });

  if (parsed.help) {
    printHelp();
    Deno.exit(0);
  }

  if (parsed.version) {
    console.log(`${SCRIPT_NAME} v${VERSION}`);
    Deno.exit(0);
  }

  const outputDir = parsed._[0] as string;

  if (!outputDir) {
    console.error("Error: Output directory required");
    console.error("Use --help for usage information");
    Deno.exit(1);
  }

  if (!parsed.spec && !parsed.name) {
    console.error("Error: Component name required (--name or --spec)");
    console.error("Use --help for usage information");
    Deno.exit(1);
  }

  const hasDarkModeFlag = args.includes("--dark-mode") || args.includes("--no-dark-mode");

  const options: GenerateOptions = {
    specFile: parsed.spec,
    name: parsed.name,
    type: parsed.type as ComponentType | undefined,
    framework: parsed.framework as Framework | undefined,
    styling: parsed.styling as Styling | undefined,
    aesthetic: parsed.aesthetic as Aesthetic | undefined,
    animation: parsed.animation as Animation | undefined,
    darkMode: hasDarkModeFlag ? Boolean(parsed["dark-mode"]) : undefined,
    tokens: parsed.tokens,
    outputDir,
  };

  try {
    const outputs = await generateComponent(options);
    const outPath = resolve(outputDir);

    await ensureDir(outPath);

    for (const [fileName, content] of outputs) {
      const filePath = resolveContainedOutputPath(outPath, fileName);
      await Deno.writeTextFile(filePath, content);
      console.log(`Generated: ${filePath}`);
    }

    console.log(`\nSuccessfully generated ${outputs.size} file(s)`);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    Deno.exit(1);
  }
}

// === Entry Point ===

if (import.meta.main) {
  main(Deno.args);
}
