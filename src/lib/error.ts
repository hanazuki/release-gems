// Appends one error subtree into `lines`. `prefix` is prepended to the first
// line only (e.g. "Caused by: " or "1. "); `indent` is prepended to every line.
function appendError(
  lines: string[],
  prefix: string,
  err: unknown,
  maxDepth: number,
  indent: string,
): void {
  const isError = err instanceof Error;

  const text = isError ? err.message : String(err);
  const [firstLine, ...restLines] = text.split("\n");
  lines.push(`${indent}${prefix}${firstLine}`);
  for (const line of restLines) {
    lines.push(`${indent}${line}`);
  }

  if (!isError) return;

  const childIndent = `${indent}| `;
  const hasCause = err.cause !== undefined;
  const isAggregate = err instanceof AggregateError && err.errors.length > 0;

  if (!isAggregate && !hasCause) return;

  if (maxDepth <= 0) {
    lines.push(`${childIndent}(further causes omitted)`);
    return;
  }

  if (isAggregate) {
    for (const [i, subErr] of err.errors.entries()) {
      appendError(lines, `${i + 1}. `, subErr, maxDepth - 1, childIndent);
    }
  }

  if (hasCause) {
    appendError(lines, "Caused by: ", err.cause, maxDepth - 1, childIndent);
  }
}

export function formatError(err: unknown, maxDepth: number = 10): string {
  const lines: string[] = [];
  appendError(lines, "", err, maxDepth, "");
  return lines.join("\n");
}
