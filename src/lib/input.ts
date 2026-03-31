import * as core from "@actions/core";
import * as z from "zod/v4";

function getInput<T extends z.core.$ZodType<unknown, string | undefined>>(
  name: string,
  schema: T,
) {
  const value = core.getInput(name);
  return z.safeParse(schema, value === "" ? undefined : value);
}

export function getInputs<
  T extends Record<string, z.core.$ZodType<unknown, string | undefined>>,
>(schemata: T): { [K in keyof T]: z.infer<T[K]> } {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const [name, schema] of Object.entries(schemata)) {
    const result = getInput(name, schema);
    if (result.success) {
      values[name] = result.data;
    } else {
      for (const issue of result.error.issues) {
        errors.push(`${name}: ${issue.message}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Invalid inputs");
  }

  return values as { [K in keyof T]: z.infer<T[K]> };
}

export const booleanInput = z.stringbool({
  case: "sensitive",
  truthy: ["true", "True", "TRUE"],
  falsy: ["false", "False", "FALSE"],
});
