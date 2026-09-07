/** Resolve only supported release targets; values are never interpolated into a shell. */
export function resourceMonitorBuildTargets(
  platform: string,
  architecture: string,
): ReadonlyArray<string> {
  const targets: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    darwin: { arm64: "aarch64-apple-darwin", x64: "x86_64-apple-darwin" },
    linux: { arm64: "aarch64-unknown-linux-gnu", x64: "x86_64-unknown-linux-gnu" },
    win32: { arm64: "aarch64-pc-windows-msvc", x64: "x86_64-pc-windows-msvc" },
  };
  const architectures =
    architecture === "universal" && platform === "darwin" ? ["arm64", "x64"] : [architecture];
  return architectures.map((arch) => {
    const platformTargets = Object.hasOwn(targets, platform) ? targets[platform] : undefined;
    const target =
      platformTargets && Object.hasOwn(platformTargets, arch) ? platformTargets[arch] : undefined;
    if (!target) throw new Error(`Unsupported resource monitor target: ${platform}/${arch}`);
    return target;
  });
}
