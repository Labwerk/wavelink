import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// design-system R16, R17: ten documented UI conventions, each with exactly
// one implementation, and every authenticated page's primary render starts
// with PageHeading (AC17 a/b/c).

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "components"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
    const isSource = /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name);
    return isSource ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const README = readFileSync(join(ROOT, "styles/README.md"), "utf8");

describe("README documents all ten UI conventions (AC17 a)", () => {
  const CONVENTIONS = [
    "Shell layout",
    "Account menu",
    "Page heading",
    "Card",
    "Badge",
    "Table",
    "Form field",
    "Button",
    "Focus ring",
    "Selectable list",
  ];
  for (const name of CONVENTIONS) {
    it(`documents "${name}"`, () => {
      expect(README).toMatch(new RegExp(name));
    });
  }
});

describe("each convention implementation file exists exactly once (AC17 b)", () => {
  const FILES = [
    "components/shell/AppShell.tsx",
    "components/shell/SideNav.tsx",
    "components/shell/TopBar.tsx",
    "components/shell/AccountMenu.tsx",
    "components/ui/PageHeading.tsx",
    "components/ui/Card.tsx",
    "components/StatusBadge.tsx",
    "components/ui/Table.tsx",
    "components/ui/Field.tsx",
    "components/ui/Button.tsx",
    "components/ui/SelectableList.tsx",
    "styles/globals.css",
  ];
  for (const file of FILES) {
    it(`${file} exists`, () => {
      expect(existsSync(join(ROOT, file))).toBe(true);
    });
  }
});

describe("no raw form/table controls outside the ui/shell conventions (AC17 c)", () => {
  const ALLOWED = new Set([
    join("components", "ui", "Button.tsx"),
    join("components", "ui", "Field.tsx"),
    join("components", "ui", "Table.tsx"),
    join("components", "ui", "SelectableList.tsx"),
    join("components", "shell", "AccountMenu.tsx"),
    join("components", "shell", "TopBar.tsx"), // <button> only via AccountMenu's MenuItem
    join("app", "devices", "DeviceForm.tsx"), // <datalist>/<option> only, no raw <input>/<select>
  ]);
  const RAW_TAGS = /<(button|table|select|input|textarea)\b/g;

  it("finds no raw control tag outside the allowlist", () => {
    const findings: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const name = relative(ROOT, file);
        if (ALLOWED.has(name)) continue;
        const source = stripComments(readFileSync(file, "utf8"));
        for (const match of source.matchAll(RAW_TAGS)) {
          findings.push(`${name}: raw <${match[1]}>`);
        }
      }
    }
    expect(findings).toEqual([]);
  });
});

describe("Headless UI primitives imported only where the convention lives (R16, AC17 c)", () => {
  const RULES: Array<{ name: string; allowed: string[] }> = [
    { name: "Menu", allowed: [join("components", "shell", "AccountMenu.tsx")] },
    { name: "Disclosure", allowed: [join("app", "devices", "DeviceDetail.tsx")] },
    {
      name: "Button",
      allowed: [join("components", "ui", "Button.tsx"), join("components", "ui", "SelectableList.tsx")],
    },
    { name: "Select", allowed: [join("components", "ui", "Field.tsx")] },
    { name: "Input", allowed: [join("components", "ui", "Field.tsx")] },
    { name: "Checkbox", allowed: [join("components", "ui", "Field.tsx")] },
  ];

  for (const { name, allowed } of RULES) {
    it(`${name} is imported only by ${allowed.join(", ")}`, () => {
      const findings: string[] = [];
      for (const dir of SCAN_DIRS) {
        for (const file of walk(join(ROOT, dir))) {
          const relName = relative(ROOT, file);
          if (allowed.includes(relName)) continue;
          const source = readFileSync(file, "utf8");
          const importRegex = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']@headlessui/react["']`);
          if (importRegex.test(source)) findings.push(relName);
        }
      }
      expect(findings).toEqual([]);
    });
  }
});

describe("every authenticated page's primary render starts with PageHeading (AC17 c)", () => {
  const PAGES = [
    "app/page.tsx",
    "app/devices/DevicesView.tsx",
    "app/devices/[deviceId]/DeviceDetailView.tsx",
    "app/admin/users/page.tsx",
  ];
  for (const file of PAGES) {
    it(`${file} renders PageHeading`, () => {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source).toMatch(/<PageHeading/);
    });
  }
});
