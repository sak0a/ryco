"use client";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Input } from "./input";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

type RGB = { r: number; g: number; b: number };
type HSV = { h: number; s: number; v: number };

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function hexToRgb(hex: string): RGB | null {
  const trimmed = hex.trim().replace(/^#/, "");
  let normalized: string;
  if (trimmed.length === 3) {
    normalized = trimmed
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("");
  } else if (trimmed.length === 6) {
    normalized = trimmed;
  } else {
    return null;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hp < 1) [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  const m = v - c;
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  };
}

export type ColorPickerProps = {
  value: string;
  onChange: (hex: string) => void;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  ariaLabel?: string;
  triggerClassName?: string;
};

export function ColorPicker({
  value,
  onChange,
  children,
  side = "bottom",
  align = "start",
  ariaLabel,
  triggerClassName,
}: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => {
    const parsed = hexToRgb(value);
    return parsed ? rgbToHsv(parsed) : { h: 0, s: 0, v: 0 };
  });
  const [hexInput, setHexInput] = useState(value);
  const [open, setOpen] = useState(false);

  const rafRef = useRef<number | null>(null);
  const pendingHexRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const hueRef = useRef(hsv.h);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    hueRef.current = hsv.h;
  }, [hsv.h]);

  const flushCommit = useCallback(() => {
    rafRef.current = null;
    if (pendingHexRef.current === null) return;
    const next = pendingHexRef.current;
    pendingHexRef.current = null;
    onChangeRef.current(next);
  }, []);

  const scheduleCommit = useCallback(
    (hex: string) => {
      pendingHexRef.current = hex;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(flushCommit);
    },
    [flushCommit],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pendingHexRef.current !== null) {
        const next = pendingHexRef.current;
        pendingHexRef.current = null;
        onChangeRef.current(next);
      }
    };
  }, []);

  const swatch = useMemo(() => rgbToHex(hsvToRgb(hsv)), [hsv]);

  useEffect(() => {
    if (value.toLowerCase() === swatch.toLowerCase()) return;
    const parsed = hexToRgb(value);
    if (!parsed) return;
    const next = rgbToHsv(parsed);
    setHsv((prev) => ({
      h: next.s === 0 ? prev.h : next.h,
      s: next.s,
      v: next.v,
    }));
    setHexInput(value);
  }, [value, swatch]);

  const padRef = useRef<HTMLDivElement | null>(null);
  const updateFromPad = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = padRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const y = clamp(event.clientY - rect.top, 0, rect.height);
      const s = rect.width === 0 ? 0 : x / rect.width;
      const v = rect.height === 0 ? 0 : 1 - y / rect.height;
      setHsv((prev) => {
        const next = { h: prev.h, s, v };
        const hex = rgbToHex(hsvToRgb(next));
        setHexInput(hex);
        pendingHexRef.current = hex;
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushCommit);
        return next;
      });
    },
    [flushCommit],
  );

  const handlePadDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateFromPad(event);
    },
    [updateFromPad],
  );

  const handlePadMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      updateFromPad(event);
    },
    [updateFromPad],
  );

  const hueSliderRef = useRef<HTMLDivElement | null>(null);
  const updateFromHue = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = hueSliderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const h = rect.width === 0 ? 0 : (x / rect.width) * 360;
      setHsv((prev) => {
        const next = { h, s: prev.s, v: prev.v };
        const hex = rgbToHex(hsvToRgb(next));
        setHexInput(hex);
        pendingHexRef.current = hex;
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushCommit);
        return next;
      });
    },
    [flushCommit],
  );

  const handleHueDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateFromHue(event);
    },
    [updateFromHue],
  );

  const handleHueMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      updateFromHue(event);
    },
    [updateFromHue],
  );

  const handleHexInput = useCallback(
    (text: string) => {
      setHexInput(text);
      const candidate = text.startsWith("#") ? text : `#${text}`;
      const parsed = hexToRgb(candidate);
      if (!parsed) return;
      const nextHsv = rgbToHsv(parsed);
      const stable: HSV = {
        h: nextHsv.s === 0 ? hueRef.current : nextHsv.h,
        s: nextHsv.s,
        v: nextHsv.v,
      };
      setHsv(stable);
      scheduleCommit(rgbToHex(parsed));
    },
    [scheduleCommit],
  );

  const huePercent = `${(hsv.h / 360) * 100}%`;
  const saturationPercent = `${hsv.s * 100}%`;
  const valuePercent = `${(1 - hsv.v) * 100}%`;
  const hueColor = `hsl(${hsv.h} 100% 50%)`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        className={cn(
          "relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-border/80 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          triggerClassName,
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverPopup side={side} align={align} className="w-64">
        <div className="space-y-3">
          <div
            ref={padRef}
            role="slider"
            aria-label="Saturation and value"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            tabIndex={0}
            className="relative h-36 w-full cursor-crosshair touch-none select-none overflow-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            style={{ backgroundColor: hueColor }}
            onPointerDown={handlePadDown}
            onPointerMove={handlePadMove}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: "linear-gradient(to right, rgba(255,255,255,1), rgba(255,255,255,0))",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: "linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0))",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{ left: saturationPercent, top: valuePercent }}
            />
          </div>

          <div
            ref={hueSliderRef}
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            tabIndex={0}
            className="relative h-3 w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            style={{
              background:
                "linear-gradient(to right, hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%), hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%))",
            }}
            onPointerDown={handleHueDown}
            onPointerMove={handleHueMove}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              style={{ left: huePercent }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-7 shrink-0 rounded-md border border-border/60"
              style={{ backgroundColor: swatch }}
            />
            <Input
              value={hexInput}
              size="sm"
              nativeInput
              onChange={(event) => handleHexInput(event.currentTarget.value)}
              spellCheck={false}
              className="font-mono text-xs"
              aria-label="Hex value"
            />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
