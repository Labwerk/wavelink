/**
 * Joins truthy class-name fragments with a single space (design-system R15).
 * Deliberately not `clsx`/`tailwind-merge`: recipes are designed with no
 * overlapping utilities, so plain joining is enough — see plan.md's "Class
 * merging" decision.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
