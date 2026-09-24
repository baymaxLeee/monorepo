#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontendRoot = resolve(repoRoot, "apps/frontend");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".git",
  ".rspack-build",
  ".turbo",
  "build",
  "dist",
  "dist-mfe",
  "generated",
  "node_modules",
]);
const failures = [];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        files.push(...(await collectSourceFiles(resolve(directory, entry.name))));
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (sourceExtensions.has(extension)) files.push(resolve(directory, entry.name));
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function report(file, source, index, message) {
  failures.push(`${relative(repoRoot, file)}:${lineNumber(source, index)} ${message}`);
}

function checkMenuGroups(file, source) {
  if (file.includes("/packages/design-system/src/shadcn/")) return;
  const stack = [];
  const tagPattern =
    /<(\/?)(DropdownMenuGroup|DropdownMenuLabel|ContextMenuGroup|ContextMenuLabel|MenubarGroup|MenubarLabel)\b[^>]*>/g;
  for (const match of source.matchAll(tagPattern)) {
    const [, closing, tag] = match;
    if (tag.endsWith("Group")) {
      if (closing) stack.pop();
      else if (!match[0].endsWith("/>")) stack.push(tag);
      continue;
    }
    const requiredGroup = tag.replace("Label", "Group");
    if (!closing && !stack.includes(requiredGroup)) {
      report(file, source, match.index, `${tag} must be nested in ${requiredGroup}.`);
    }
  }
}

function checkSource(file, source) {
  if (file.endsWith("/packages/design-system/src/shadcn/toast.tsx")) {
    const viewport = source.match(/function ToastViewport[\s\S]*?^}/m)?.[0] ?? "";
    if (!viewport.includes("top-4") || viewport.includes("bottom-4")) {
      report(
        file,
        source,
        source.indexOf("function ToastViewport"),
        "The global toast viewport must remain top-centered.",
      );
    }
  }

  const isRegistryForm = file.endsWith("/packages/design-system/src/shadcn/form.tsx");
  const simpleRules = [
    [
      /from\s+["'](?:@radix-ui\/|radix-ui(?:["'/]))/g,
      "Direct Radix imports are forbidden; use the Base UI-backed design system.",
    ],
    [/\basChild(?:\s|=)/g, "Radix asChild is forbidden; use Base UI render composition."],
    [/data-\[state=(?:open|closed)\]/g, "Radix data-state selectors are forbidden; use the Base UI state attribute."],
    [/--radix-[a-z-]+/g, "Radix CSS variables are forbidden; use the Base UI positioning variables."],
    [
      /<Button\b(?:(?!<Button\b|<\/Button>).){0,1200}?render=\{<(?:Link|a)\b/gms,
      "Do not render links through Button; apply buttonVariants() to Link/a directly.",
    ],
    [
      /<form\b(?:(?!<form\b|<\/form>).){0,500}?onSubmit=\{\(event\)\s*=>\s*event\.preventDefault\(\)\}/gms,
      "Forms must use native submit semantics; connect onSubmit to react-hook-form handleSubmit().",
    ],
    [
      /<Select\b(?=[^>]{0,700}\bvalue=\{field\.value)(?![^>]{0,700}\bname=\{field\.name\})[^>]*>/gms,
      "Controller-bound Select must pass name={field.name} to its hidden form control.",
    ],
    [
      /<(?:Tool|Collapsible)\b(?=[^>]*\bopen(?:\s|=|>))(?![^>]*\bonOpenChange=)[^>]*>/gms,
      "Interactive collapsibles must not pass controlled open without onOpenChange; use defaultOpen for initial state.",
    ],
    [
      /<Button\b(?=[^>]*\bclassName=\{?(?:`|"|'))(?=[^>]*\babsolute\b)(?=[^>]*\binset-0\b)(?![^>]*\bh-(?:auto|full|\[|\d))[^>]*>/gms,
      "Full-inset Button must override the default fixed height.",
    ],
    [
      /<Switch\b(?=[^>]{0,700}\bchecked=\{[^}]*field\.value[^}]*\})(?![^>]{0,700}\bname=\{field\.name\})[^>]*>/gms,
      "Controller-bound Switch must pass name={field.name} to its hidden form control.",
    ],
    ...(isRegistryForm
      ? []
      : [
          [
            /from\s+["'][^"']*shadcn\/form["']/g,
            "Business code must use react-hook-form Controller with Field primitives directly.",
          ],
          [
            /<(?:FormControl|FormField|FormItem|FormLabel|FormMessage)\b/g,
            "Legacy form composition is forbidden; use Controller with Field primitives.",
          ],
        ]),
  ];
  for (const [pattern, message] of simpleRules) {
    for (const match of source.matchAll(pattern)) report(file, source, match.index, message);
  }

  const nonButtonTrigger =
    /<(Button|(?:Popover|DropdownMenu|ContextMenu|Menubar|Dialog|AlertDialog|Sheet|Drawer)Trigger)\b(?:(?!<\/\1>).){0,1000}?render=\{<(span|div)\b(?:(?!\/?>).)*\/>\}(?:(?!>).){0,300}>/gms;
  for (const match of source.matchAll(nonButtonTrigger)) {
    if (!/nativeButton=\{false\}/.test(match[0])) {
      report(file, source, match.index, `${match[1]} rendering <${match[2]}> must set nativeButton={false}.`);
    }
  }

  const namedNonButtonTrigger =
    /<(Button|(?:Popover|DropdownMenu|ContextMenu|Menubar|Dialog|AlertDialog|Sheet|Drawer)Trigger)\b(?:(?!<\/\1>).){0,1000}?render=\{<([A-Z][A-Za-z0-9]*)\b(?:(?!\/>).)*\/>\}(?:(?!>).){0,300}>/gms;
  for (const match of source.matchAll(namedNonButtonTrigger)) {
    if (!/nativeButton=\{false\}/.test(match[0]) && !/(?:^|\.)Button$|^MenuItem$/.test(match[2])) {
      report(
        file,
        source,
        match.index,
        `${match[1]} rendering ${match[2]} must prove it renders a button or set nativeButton={false}.`,
      );
    }
  }

  for (const match of source.matchAll(/<FieldLabel\b[^>]*htmlFor=\{field\.name\}[^>]*>/g)) {
    const fieldEnd = source.indexOf("</Field>", match.index);
    const fieldBody = source.slice(match.index, fieldEnd === -1 ? match.index + 2000 : fieldEnd);
    if (!/(?:\bid|\binputId)=\{field\.name\}/.test(fieldBody)) {
      report(file, source, match.index, "FieldLabel htmlFor={field.name} must target a real control id={field.name}.");
    }
  }
  checkMenuGroups(file, source);
}

for (const file of await collectSourceFiles(frontendRoot)) {
  checkSource(file, await readFile(file, "utf8"));
}

if (failures.length > 0) {
  console.error("UI contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("UI contract check passed.");
}
