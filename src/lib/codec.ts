import { dump as dumpYaml, load as loadYaml } from "js-yaml";
import * as z from "zod/v4";

export const json = <O>(schema: z.core.$ZodType<O>) =>
  z.codec(z.string(), schema, {
    decode: (str) => JSON.parse(str),
    encode: (val) => JSON.stringify(val),
  });

export const yaml = <O>(schema: z.core.$ZodType<O>) =>
  z.codec(z.string(), schema, {
    decode: (str) => loadYaml(str),
    encode: (val) => dumpYaml(val),
  });

export const stringToInt = z.codec(
  z.string().regex(z.regexes.integer),
  z.int(),
  {
    decode: (str) => Number.parseInt(str, 10),
    encode: (num) => num.toString(),
  },
);

export const separatedString = <O>(
  separator: string,
  itemSchema: z.core.$ZodType<O, string>,
) =>
  z.codec(z.string(), z.array(itemSchema), {
    decode: (str) => str.split(separator),
    encode: (ary) => ary.join(separator),
  });

export const newlineSeparatedString = <O>(
  itemSchema: z.core.$ZodType<O, string>,
) => separatedString("\n", itemSchema);
