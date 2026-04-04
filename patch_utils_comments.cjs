const fs = require('fs');
let code = fs.readFileSync('src/utils.ts', 'utf8');

const replacement = `
// PERFORMANCE OPTIMIZATION (Bolt):
// normalizeDictationLanguageAllowList historically used chained array operations (.map().filter())
// combined with an O(n) array .includes() check inside the loop, causing unnecessary memory
// allocations and O(n^2) time complexity for deduplication.
// By migrating to a single-pass iteration and a Set, we achieve O(n) time complexity and
// O(1) lookups, significantly reducing garbage collection overhead during hot execution paths.
export function normalizeDictationLanguageAllowList(value: unknown): string[] {
`;
code = code.replace("export function normalizeDictationLanguageAllowList(value: unknown): string[] {", replacement);

fs.writeFileSync('src/utils.ts', code);
