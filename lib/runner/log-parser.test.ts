import { describe, it, expect } from "vitest";
import { parseLine, LineBuffer } from "./log-parser";

describe("parseLine (tolerant act --json parsing)", () => {
  it("parses a representative act --json line into a job/step event", () => {
    const line = JSON.stringify({
      dryrun: false,
      job: "tiny/hello",
      jobID: "hello",
      level: "info",
      msg: '  ✅  Success - Main echo "hi"',
      stage: "Main",
      step: 'echo "hi"',
      stepID: ["0"],
      time: "2026-07-09T23:11:28+07:00",
    });
    const ev = parseLine(line);
    expect(ev.raw).toBe(false);
    expect(ev.message).toBe('  ✅  Success - Main echo "hi"');
    expect(ev.level).toBe("info");
    expect(ev.job).toBe("hello"); // jobID preferred (matches -j)
    expect(ev.step).toBe('echo "hi"');
    expect(ev.ts).toBe("2026-07-09T23:11:28+07:00");
  });

  it("prefers jobID over the display job (matches the -j argument)", () => {
    const ev = parseLine(
      JSON.stringify({ msg: "x", job: "tiny/hello", jobID: "hello", level: "info" }),
    );
    expect(ev.job).toBe("hello");
  });

  it("falls back to the display job when jobID is absent", () => {
    const ev = parseLine(JSON.stringify({ msg: "x", job: "tiny/hello" }));
    expect(ev.job).toBe("tiny/hello");
  });

  it("reads a raw_output command line", () => {
    const ev = parseLine(
      JSON.stringify({
        msg: "hello world\n",
        raw_output: true,
        jobID: "hello",
        level: "info",
      }),
    );
    expect(ev.raw).toBe(false);
    expect(ev.message).toBe("hello world\n");
  });

  it("falls back to the whole line as message when JSON lacks msg/message", () => {
    const ev = parseLine('{"foo":"bar"}');
    expect(ev.raw).toBe(false);
    expect(ev.message).toBe('{"foo":"bar"}');
  });

  it("still yields a message for an empty JSON object", () => {
    const ev = parseLine("{}");
    expect(ev.raw).toBe(false);
    expect(ev.message).toBe("{}");
  });

  it("turns a non-JSON line into a raw passthrough event", () => {
    const line = "Error: workflow is not valid. 'bad.yml': yaml: line 1";
    const ev = parseLine(line);
    expect(ev.raw).toBe(true);
    expect(ev.message).toBe(line);
    expect(ev.level).toBeNull();
    expect(ev.job).toBeNull();
  });

  it("treats a JSON primitive as raw passthrough", () => {
    expect(parseLine("42").raw).toBe(true);
    expect(parseLine('"a string"').raw).toBe(true);
  });

  it("parses a CRLF-terminated line", () => {
    const ev = parseLine('{"msg":"ok","level":"info"}\r');
    expect(ev.raw).toBe(false);
    expect(ev.message).toBe("ok");
  });
});

describe("LineBuffer (line-buffered stdout)", () => {
  it("emits each complete line and flushes the trailing partial on end", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push("a\nb\n");
    expect(lines).toEqual(["a", "b"]);
    buf.push("c");
    expect(lines).toEqual(["a", "b"]);
    buf.end();
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("reassembles a JSON object split across two chunks into one line", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push('{"msg":"hi"');
    expect(lines).toEqual([]);
    buf.push('}\n');
    // One complete line, not two fragments.
    expect(lines).toEqual(['{"msg":"hi"}']);
    expect(lines.length).toBe(1);
  });

  it("end is idempotent (safe from both stream-end and process-exit)", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push("partial");
    buf.end();
    buf.end();
    expect(lines).toEqual(["partial"]);
  });

  it("ignores pushes after end", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.end();
    buf.push("late\n");
    expect(lines).toEqual([]);
  });

  it("normalizes CRLF to LF", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push("a\r\nb\r\n");
    expect(lines).toEqual(["a", "b"]);
  });

  it("does not emit an empty trailing line for a newline-terminated chunk", () => {
    const lines: string[] = [];
    const buf = new LineBuffer((l) => lines.push(l));
    buf.push("only\n");
    buf.end();
    expect(lines).toEqual(["only"]);
  });
});
