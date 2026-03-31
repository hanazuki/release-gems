import { describe, expect, it } from "vitest";
import { formatError } from "#/error";

describe("formatError", () => {
  describe("non-Error top-level values", () => {
    it("formats a string directly", () => {
      expect(formatError("something went wrong")).toBe("something went wrong");
    });

    it("formats null", () => {
      expect(formatError(null)).toBe("null");
    });

    it("formats a number", () => {
      expect(formatError(42)).toBe("42");
    });
  });

  describe("plain Error with no cause", () => {
    it("returns just the message", () => {
      const err = new Error("Something failed.");
      expect(formatError(err)).toBe("Something failed.");
    });
  });

  describe("Error with nested cause chain", () => {
    it("formats a single cause", () => {
      const cause = new Error("Root cause.");
      const err = new Error("Top-level error.", { cause });
      expect(formatError(err)).toBe(
        "Top-level error.\n| Caused by: Root cause.",
      );
    });

    it("formats a multi-level cause chain", () => {
      const inner = new Error("Yet another reason.");
      const middle = new Error("Another reason.", { cause: inner });
      const err = new Error("Something failed.", { cause: middle });
      expect(formatError(err)).toBe(
        "Something failed.\n| Caused by: Another reason.\n| | Caused by: Yet another reason.",
      );
    });

    it("formats a non-Error cause as String()", () => {
      const err = new Error("Top-level.", { cause: "string cause" });
      expect(formatError(err)).toBe("Top-level.\n| Caused by: string cause");
    });

    it("formats null cause as 'null'", () => {
      const err = new Error("Has null cause.", { cause: null });
      expect(formatError(err)).toBe("Has null cause.\n| Caused by: null");
    });
  });

  describe("AggregateError with sub-errors", () => {
    it("formats multiple sub-errors", () => {
      const err = new AggregateError(
        [new Error("Reason one."), new Error("Reason two.")],
        "Multiple failures.",
      );
      expect(formatError(err)).toBe(
        "Multiple failures.\n| 1. Reason one.\n| 2. Reason two.",
      );
    });

    it("formats sub-errors that have causes", () => {
      const sub = new Error("Reason two.", { cause: new Error("Root cause.") });
      const err = new AggregateError(
        [new Error("Reason one."), sub],
        "Multiple failures.",
      );
      expect(formatError(err)).toBe(
        "Multiple failures.\n| 1. Reason one.\n| 2. Reason two.\n| | Caused by: Root cause.",
      );
    });

    it("formats nested AggregateError", () => {
      const inner = new AggregateError(
        [new Error("Reason 3-1."), new Error("Reason 3-2.")],
        "Another aggregated error.",
      );
      const sub3 = new Error("Reason three.", { cause: inner });
      const err = new AggregateError(
        [new Error("Reason one."), new Error("Reason two."), sub3],
        "Something failed because of multiple reasons.",
      );
      expect(formatError(err)).toBe(
        [
          "Something failed because of multiple reasons.",
          "| 1. Reason one.",
          "| 2. Reason two.",
          "| 3. Reason three.",
          "| | Caused by: Another aggregated error.",
          "| | | 1. Reason 3-1.",
          "| | | 2. Reason 3-2.",
        ].join("\n"),
      );
    });

    it("treats AggregateError with empty errors as plain error", () => {
      const err = new AggregateError([], "No sub-errors.", {
        cause: new Error("Root."),
      });
      expect(formatError(err)).toBe("No sub-errors.\n| Caused by: Root.");
    });
  });

  describe("AggregateError with both .errors and .cause", () => {
    it("appends cause after the numbered list", () => {
      const err = new AggregateError(
        [new Error("Sub-error one."), new Error("Sub-error two.")],
        "Top-level message.",
        { cause: new Error("Root cause.") },
      );
      expect(formatError(err)).toBe(
        [
          "Top-level message.",
          "| 1. Sub-error one.",
          "| 2. Sub-error two.",
          "| Caused by: Root cause.",
        ].join("\n"),
      );
    });
  });

  describe("depth truncation", () => {
    it("truncates plain error cause at maxDepth=0", () => {
      const cause = new Error("Hidden cause.");
      const err = new Error("Visible.", { cause });
      expect(formatError(err, 0)).toBe("Visible.\n| (further causes omitted)");
    });

    it("shows one level at maxDepth=1 then truncates", () => {
      const deep = new Error("Error at depth 2.");
      const mid = new Error("Error at depth 1.", { cause: deep });
      const top = new Error("Error at depth 0.", { cause: mid });
      expect(formatError(top, 1)).toBe(
        [
          "Error at depth 0.",
          "| Caused by: Error at depth 1.",
          "| | (further causes omitted)",
        ].join("\n"),
      );
    });

    it("truncates AggregateError children at maxDepth=0", () => {
      const err = new AggregateError([new Error("Sub-error.")], "Aggregate.");
      expect(formatError(err, 0)).toBe(
        "Aggregate.\n| (further causes omitted)",
      );
    });

    it("truncates AggregateError with only cause at maxDepth=0", () => {
      const err = new AggregateError([], "Empty aggregate.", {
        cause: new Error("Root."),
      });
      // empty .errors → treated as plain error; cause → truncated at depth 0
      expect(formatError(err, 0)).toBe(
        "Empty aggregate.\n| (further causes omitted)",
      );
    });

    it("independent branches each receive the same remaining depth budget", () => {
      // maxDepth=2: items get maxDepth=1, their causes get maxDepth=0 (shown but truncated)
      const err = new AggregateError(
        [
          new Error("A", {
            cause: new Error("A-cause", { cause: new Error("A-deep") }),
          }),
          new Error("B", {
            cause: new Error("B-cause", { cause: new Error("B-deep") }),
          }),
        ],
        "Aggregate.",
      );
      expect(formatError(err, 2)).toBe(
        [
          "Aggregate.",
          "| 1. A",
          "| | Caused by: A-cause",
          "| | | (further causes omitted)",
          "| 2. B",
          "| | Caused by: B-cause",
          "| | | (further causes omitted)",
        ].join("\n"),
      );
    });
  });
});
