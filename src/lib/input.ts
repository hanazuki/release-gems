import * as core from "@actions/core";
import * as z from "zod";

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
    throw new Error(`Invalid inputs:\n${errors.join("\n")}`);
  }

  return values as { [K in keyof T]: z.infer<T[K]> };
}

export const BooleanSchema = z.stringbool({
  case: "sensitive",
  truthy: ["true", "True", "TRUE"],
  falsy: ["false", "False", "FALSE"],
});

export const IntegerSchema = z
  .string()
  .transform<number>((val, { addIssue }) => {
    const intval = Number.parseInt(val, 10);
    if (Number.isNaN(intval)) {
      addIssue({
        code: "custom",
        message: "not parseable as an integer",
      });
      return z.NEVER;
    }
    return intval;
  });

export const NewlineSeparatedSchema = <
  T extends z.core.$ZodType<unknown, string>,
>(
  itemSchema: T,
) =>
  z
    .string()
    .transform((val) => val.split("\n").filter((line) => line.length > 0))
    .pipe(z.array(itemSchema));
