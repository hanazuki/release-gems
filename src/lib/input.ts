import * as core from "@actions/core";
import * as z from "zod";

function getInput<
  T extends z.ZodType<unknown, z.ZodTypeDef, string | undefined>,
>(name: string, schema: T) {
  const value = core.getInput(name);
  return schema.safeParse(value === "" ? undefined : value);
}

export function getInputs<
  T extends Record<
    string,
    z.ZodType<unknown, z.ZodTypeDef, string | undefined>
  >,
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

export const BooleanSchema = z
  .enum(["true", "True", "TRUE", "false", "False", "FALSE"])
  .transform((v) => v.toLowerCase() === "true");

export const IntegerSchema = z.string().transform<number>((val, ctx) => {
  const intval = Number.parseInt(val, 10);
  if (Number.isNaN(intval)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "not parseable as an integer",
    });
    return z.NEVER;
  }
  return intval;
});
