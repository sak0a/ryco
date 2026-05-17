import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StdoutSniffer } from "./Layers/StdoutSniffer.ts";

const fixturePath = (name: string) =>
  join(import.meta.dirname, "__fixtures__/stdout", `${name}.txt`);

describe("StdoutSniffer", () => {
  it("extracts Vite URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("vite"), "utf8"));
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("http://localhost:5173/");
    expect(out[0]!.port).toBe(5173);
    expect(out[0]!.framework).toBe("vite");
  });

  it("extracts Next URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("next"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000");
    expect(out[0]!.framework).toBe("next");
  });

  it("extracts Nuxt URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("nuxt"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000/");
    expect(out[0]!.framework).toBe("nuxt");
  });

  it("extracts Astro URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("astro"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:4321/");
    expect(out[0]!.framework).toBe("astro");
  });

  it("extracts Remix URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("remix"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:3000");
    expect(out[0]!.framework).toBe("remix");
  });

  it("extracts Wrangler URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("wrangler"), "utf8"));
    expect(out[0]!.url).toBe("http://127.0.0.1:8787");
    expect(out[0]!.framework).toBe("wrangler");
  });

  it("extracts Webpack-DevServer URL", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("webpack"), "utf8"));
    expect(out[0]!.url).toBe("http://localhost:8080/");
    expect(out[0]!.framework).toBe("webpack");
  });

  it("extracts generic Express port", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number; framework: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed(readFileSync(fixturePath("express"), "utf8"));
    expect(out[0]!.port).toBe(3000);
    expect(out[0]!.framework).toBe("express");
  });

  it("assembles URLs split across chunks", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string; port: number }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed("Local: http://localho");
    sniffer.feed("st:5173/\n");
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("http://localhost:5173/");
  });

  it("strips ANSI before matching", () => {
    const sniffer = new StdoutSniffer();
    const out: { url: string }[] = [];
    sniffer.onCandidate((c) => out.push(c));
    sniffer.feed("\x1b[36m  ➜  Local:\x1b[0m \x1b[1mhttp://localhost:5173/\x1b[0m\n");
    expect(out[0]!.url).toBe("http://localhost:5173/");
  });
});
