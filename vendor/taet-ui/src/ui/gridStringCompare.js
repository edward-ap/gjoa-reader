// Grid and TreeGrid share the host's default locale and natural, case-insensitive
// string ordering. Reuse ICU setup instead of rebuilding it for every comparison.
let collator;
export function compareGridStrings(left, right) {
  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return collator.compare(String(left), String(right));
}
