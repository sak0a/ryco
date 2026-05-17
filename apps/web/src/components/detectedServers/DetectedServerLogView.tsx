import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useDetectedServerStore } from "../../detectedServerStore.ts";

interface Props {
  serverId: string;
}

export const DetectedServerLogView = ({ serverId }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenLengthRef = useRef(0);

  const buffer = useDetectedServerStore((s) => s.logBuffersByServerId.get(serverId));
  const bufferLength = useDetectedServerStore((s) => {
    const b = s.logBuffersByServerId.get(serverId);
    return b ? b.snapshot().length : 0;
  });

  // Mount the terminal once
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: "transparent" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    writtenLengthRef.current = 0;
    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Incremental write on buffer length change
  useEffect(() => {
    if (!termRef.current || !buffer) return;
    const snap = buffer.snapshot();
    if (writtenLengthRef.current > snap.length) {
      // Buffer trimmed from head — re-render from scratch
      termRef.current.clear();
      writtenLengthRef.current = 0;
    }
    for (let i = writtenLengthRef.current; i < snap.length; i += 1) {
      termRef.current.writeln(snap[i]!);
    }
    writtenLengthRef.current = snap.length;
  }, [buffer, bufferLength]);

  // Resize on window resize
  useEffect(() => {
    const handler = () => fitRef.current?.fit();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Reset on serverId change
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.clear();
    writtenLengthRef.current = 0;
  }, [serverId]);

  return <div ref={containerRef} className="h-full w-full p-2" />;
};
