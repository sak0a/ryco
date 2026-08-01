export type BuildArch = "arm64" | "x64" | "universal";
export type BuildPlatform = "mac" | "linux" | "win";
interface PlatformConfig {
    readonly archChoices: ReadonlyArray<BuildArch>;
}
export declare function resolveHostProcessArch(platform: NodeJS.Platform, processArch: NodeJS.Architecture, env: NodeJS.ProcessEnv): BuildArch | undefined;
export declare function getDefaultBuildArch(platform: BuildPlatform, processArch: NodeJS.Architecture, env: NodeJS.ProcessEnv, platformConfig: PlatformConfig): BuildArch;
export {};
