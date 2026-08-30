import { Data, Effect, FileSystem, Option, Path } from "effect";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
  Multipart,
} from "effect/unstable/http";
import * as Schema from "effect/Schema";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import { resolveStaticDir, ServerConfig } from "./config.ts";
import { decodeOtlpTraceRecords } from "./observability/TraceRecord.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
import { ProjectAvatarStore } from "./project/Services/ProjectAvatarStore.ts";
import type { ProjectId } from "@ryco/contracts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { respondToAuthError } from "./auth/http.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "private, max-age=3600";
const PROJECT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_AVATAR_CACHE_CONTROL = "private, max-age=0, must-revalidate";
const STATIC_INDEX_CACHE_CONTROL = "no-cache";
const STATIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
export const SERVER_ENVIRONMENT_DESCRIPTOR_PATH = "/.well-known/ryco/environment";
export const LEGACY_SERVER_ENVIRONMENT_DESCRIPTOR_PATH = "/.well-known/s3/environment";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const DOWNLOAD_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";
const INLINE_ATTACHMENT_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["authorization", "b3", "traceparent", "content-type"],
  maxAge: 600,
});

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

export function resolveStaticCacheControl(staticRelativePath: string): string {
  const normalized = staticRelativePath.replace(/\\/g, "/");
  if (normalized === "index.html" || normalized.endsWith("/index.html")) {
    return STATIC_INDEX_CACHE_CONTROL;
  }

  const basename = normalized.split("/").at(-1) ?? normalized;
  const hasBuildHash = /(?:^|[-.])[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9]+$/u.test(basename);
  return hasBuildHash ? STATIC_IMMUTABLE_CACHE_CONTROL : STATIC_INDEX_CACHE_CONTROL;
}

/** Build a download disposition with a safe ASCII fallback and UTF-8 filename. */
export function downloadContentDisposition(fileName?: string): string {
  if (fileName === undefined) {
    return "attachment";
  }

  // encodeURIComponent rejects unpaired surrogates, and control characters,
  // quotes, and backslashes are unsafe in the quoted fallback parameter.
  // eslint-disable-next-line no-control-regex
  const sanitized = fileName.toWellFormed().replace(/[\u0000-\u001f"\\]/g, "_");
  const asciiFallback = sanitized.replace(/[^\u0020-\u007e]/g, "_");
  const extendedName = encodeURIComponent(sanitized).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"${
    asciiFallback === sanitized ? "" : `; filename*=UTF-8''${extendedName}`
  }`;
}

export function userAssetResponseHeaders(
  filePath: string,
  path: Pick<Path.Path, "basename" | "extname">,
): Record<string, string> {
  const extension = path.extname(filePath).toLowerCase();
  const download = !INLINE_ATTACHMENT_EXTENSIONS.has(extension);

  return {
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    ...(download
      ? {
          "Content-Disposition": downloadContentDisposition(path.basename(filePath)),
          "Content-Security-Policy": DOWNLOAD_CONTENT_SECURITY_POLICY,
          "Content-Type": "application/octet-stream",
        }
      : extension === ".svg"
        ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
        : {}),
  };
}

export function inlineImageResponseHeaders(filePath: string): Record<string, string> {
  return {
    "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
    ...(filePath.toLowerCase().endsWith(".svg")
      ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
      : {}),
  };
}

function resolveStaticContentType(filePath: string, path: Path.Path): string {
  return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const staticFileResponse = (filePath: string, staticRelativePath: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      contentType: resolveStaticContentType(filePath, path),
      headers: {
        "Cache-Control": resolveStaticCacheControl(staticRelativePath),
      },
    });
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
    ),
  );

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

const serverEnvironmentRouteHandler = Effect.gen(function* () {
  const descriptor = yield* Effect.service(ServerEnvironment).pipe(
    Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
  );
  return HttpServerResponse.jsonUnsafe(descriptor, { status: 200 });
});

export const serverEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  SERVER_ENVIRONMENT_DESCRIPTOR_PATH,
  serverEnvironmentRouteHandler,
);

export const legacyServerEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  LEGACY_SERVER_ENVIRONMENT_DESCRIPTOR_PATH,
  serverEnvironmentRouteHandler,
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: userAssetResponseHeaders(filePath, path),
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: inlineImageResponseHeaders("fallback.svg"),
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: inlineImageResponseHeaders(faviconFilePath),
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

const AvatarFormSchema = Schema.Struct({
  avatar: Multipart.SingleFileSchema,
});

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const projectAvatarUploadRouteLayer = HttpRouter.add(
  "POST",
  "/api/project-avatar/upload",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const projectId = url.value.searchParams.get("projectId");
    if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
      return HttpServerResponse.text("Invalid projectId", { status: 400 });
    }

    const contentLength = Number(request.headers["content-length"] ?? "0");
    if (contentLength > PROJECT_AVATAR_MAX_BYTES) {
      return HttpServerResponse.text("Payload too large", { status: 413 });
    }

    const form = yield* HttpServerRequest.schemaBodyForm(AvatarFormSchema).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!form) return HttpServerResponse.text("Bad Request", { status: 400 });

    const file = form.avatar;
    const fileSystem = yield* FileSystem.FileSystem;
    const fileBytes = yield* fileSystem.readFile(file.path);
    if (fileBytes.length > PROJECT_AVATAR_MAX_BYTES) {
      return HttpServerResponse.text("Payload too large", { status: 413 });
    }

    const store = yield* ProjectAvatarStore;
    const writeResult = yield* Effect.result(
      store.write({
        projectId: projectId as ProjectId,
        bytes: Buffer.from(fileBytes),
        contentType: file.contentType,
      }),
    );
    if (writeResult._tag === "Failure") {
      return HttpServerResponse.text(writeResult.failure.message, { status: 400 });
    }
    return HttpServerResponse.jsonUnsafe(writeResult.success);
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const projectAvatarServeRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-avatar",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const projectId = url.value.searchParams.get("projectId");
    if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
      return HttpServerResponse.text("Invalid projectId", { status: 400 });
    }

    const store = yield* ProjectAvatarStore;
    const stored = yield* store.read(projectId as ProjectId);
    if (!stored) return HttpServerResponse.text("Not Found", { status: 404 });
    return HttpServerResponse.uint8Array(stored.bytes, {
      status: 200,
      contentType: "image/png",
      headers: {
        "Cache-Control": PROJECT_AVATAR_CACHE_CONTROL,
        ETag: `"${stored.contentHash}"`,
      },
    });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir = config.staticDir ?? (config.devUrl ? yield* resolveStaticDir() : undefined);
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexInfo = yield* fileSystem
        .stat(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexInfo || indexInfo.type !== "File") {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return yield* staticFileResponse(indexPath, "index.html");
    }

    return yield* staticFileResponse(filePath, staticRelativePath);
  }),
);
