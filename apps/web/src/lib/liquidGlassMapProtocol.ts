export interface LiquidGlassMapInput {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly edgeBandPx: number;
}

export interface LiquidGlassMapWorkerRequest extends LiquidGlassMapInput {
  readonly requestId: number;
}

export type LiquidGlassMapWorkerResponse =
  | {
      readonly kind: "result";
      readonly requestId: number;
      readonly blob: Blob;
      readonly durationMs: number;
    }
  | {
      readonly kind: "error";
      readonly requestId: number;
      readonly message: string;
    };

const MAX_MAP_PIXELS = 262_144;

export function getLiquidGlassBitmapSize(
  width: number,
  height: number,
): {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
} {
  const scale = Math.min(1, Math.sqrt(MAX_MAP_PIXELS / Math.max(1, width * height)));
  return {
    width: Math.max(2, Math.round(width * scale)),
    height: Math.max(2, Math.round(height * scale)),
    scale,
  };
}

const REFRACTION_SAMPLES = 128;
const GLASS_REFRACTIVE_INDEX = 1.5;

function makeRefractionProfile(): Float32Array {
  const lut = new Float32Array(REFRACTION_SAMPLES);
  let peak = 0;
  for (let index = 0; index < REFRACTION_SAMPLES; index++) {
    const t = index / (REFRACTION_SAMPLES - 1);
    const u = 1 - t;
    const height = Math.sqrt(Math.max(1 - u * u, 1e-9));
    const slope = u / height;
    const theta1 = Math.atan(slope);
    const theta2 = Math.asin(Math.sin(theta1) / GLASS_REFRACTIVE_INDEX);
    lut[index] = height * Math.tan(theta1 - theta2);
    peak = Math.max(peak, lut[index] as number);
  }
  for (let index = 0; index < REFRACTION_SAMPLES; index++) {
    lut[index] = (lut[index] as number) / peak;
  }
  return lut;
}

const REFRACTION_PROFILE = makeRefractionProfile();

export function renderLiquidGlassPixels(input: LiquidGlassMapInput): {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
} {
  const bitmap = getLiquidGlassBitmapSize(input.width, input.height);
  const pixels = new Uint8ClampedArray(new ArrayBuffer(bitmap.width * bitmap.height * 4));
  const halfWidth = bitmap.width / 2 - 1;
  const halfHeight = bitmap.height / 2 - 1;
  const radius = Math.min(input.radius * bitmap.scale, halfWidth, halfHeight);
  const band = Math.max(2, input.edgeBandPx * bitmap.scale);

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const px = x - bitmap.width / 2;
      const py = y - bitmap.height / 2;
      const qx = Math.abs(px) - halfWidth + radius;
      const qy = Math.abs(py) - halfHeight + radius;
      const distance =
        Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
      const pixelIndex = (y * bitmap.width + x) * 4;
      const depth = -distance / band;
      if (depth <= 0 || depth >= 1) {
        pixels[pixelIndex] = 128;
        pixels[pixelIndex + 1] = 128;
        pixels[pixelIndex + 2] = 128;
        pixels[pixelIndex + 3] = 255;
        continue;
      }

      const magnitude = REFRACTION_PROFILE[Math.round(depth * (REFRACTION_SAMPLES - 1))] as number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy) || 1;
        nx = (qx / length) * Math.sign(px);
        ny = (qy / length) * Math.sign(py);
      } else if (qx > qy) {
        nx = Math.sign(px);
        ny = 0;
      } else {
        nx = 0;
        ny = Math.sign(py);
      }
      pixels[pixelIndex] = 128 + nx * magnitude * 127;
      pixels[pixelIndex + 1] = 128;
      pixels[pixelIndex + 2] = 128 + ny * magnitude * 127;
      pixels[pixelIndex + 3] = 255;
    }
  }

  return { width: bitmap.width, height: bitmap.height, pixels };
}
