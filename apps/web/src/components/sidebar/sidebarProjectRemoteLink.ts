import { type RepositoryIdentity } from "@ryco/contracts";
import {
  AzureDevOpsIcon,
  BitbucketIcon,
  ForgejoIcon,
  GitHubIcon,
  GitIcon,
  GitLabIcon,
  type Icon,
} from "../Icons";

export interface ProjectRemoteLink {
  readonly label: string;
  readonly provider: string | undefined;
  readonly providerLabel: string;
  readonly url: string;
}

export function formatRepositoryProviderLabel(provider: string | undefined): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "forgejo":
      return "Forgejo";
    case "azure-devops":
      return "Azure DevOps";
    case "bitbucket":
      return "Bitbucket";
    default:
      return "Remote";
  }
}

export function resolveRepositoryProviderIcon(provider: string | undefined): Icon {
  switch (provider) {
    case "github":
      return GitHubIcon;
    case "gitlab":
      return GitLabIcon;
    case "forgejo":
      return ForgejoIcon;
    case "azure-devops":
      return AzureDevOpsIcon;
    case "bitbucket":
      return BitbucketIcon;
    default:
      return GitIcon;
  }
}

function stripGitSuffix(path: string): string {
  return path.replace(/\/+$/g, "").replace(/\.git$/i, "");
}

function rewriteAzureDevOpsBrowserUrl(host: string, pathSegments: string[]): string | null {
  // Azure DevOps SSH form: ssh://git@ssh.dev.azure.com/v3/<org>/<project>/<repo>
  // scp form:              git@ssh.dev.azure.com:v3/<org>/<project>/<repo>
  // Both produce pathSegments starting with "v3". The browse URL is
  // https://dev.azure.com/<org>/<project>/_git/<repo>.
  if (host !== "ssh.dev.azure.com") {
    return null;
  }
  const v3Index = pathSegments.indexOf("v3");
  if (v3Index === -1 || pathSegments.length < v3Index + 4) {
    return null;
  }
  const org = pathSegments[v3Index + 1];
  const project = pathSegments[v3Index + 2];
  const repo = pathSegments[v3Index + 3];
  if (!org || !project || !repo) return null;
  return `https://dev.azure.com/${org}/${project}/_git/${repo}`;
}

export function resolveRemoteUrlToBrowserUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      url.pathname = stripGitSuffix(url.pathname);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  if (/^(?:ssh|git):\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const segments = stripGitSuffix(url.pathname)
        .split("/")
        .filter((segment) => segment.length > 0);
      const azureBrowserUrl = rewriteAzureDevOpsBrowserUrl(url.hostname, segments);
      if (azureBrowserUrl) return azureBrowserUrl;
      const repositoryPath = segments.join("/");
      return url.hostname && repositoryPath ? `https://${url.hostname}/${repositoryPath}` : null;
    } catch {
      return null;
    }
  }

  const scpStyleRemote = /^git@([^:/\s]+)[:/]([^#?\s]+)$/i.exec(trimmed);
  if (scpStyleRemote?.[1] && scpStyleRemote[2]) {
    const host = scpStyleRemote[1];
    const path = stripGitSuffix(scpStyleRemote[2]);
    const segments = path.split("/").filter((s) => s.length > 0);
    const azureBrowserUrl = rewriteAzureDevOpsBrowserUrl(host, segments);
    if (azureBrowserUrl) return azureBrowserUrl;
    return `https://${host}/${path}`;
  }

  return null;
}

export function resolveProjectRemoteLink(
  repositoryIdentity: RepositoryIdentity | null | undefined,
  preferredRemoteName: string | null | undefined,
): ProjectRemoteLink | null {
  if (!repositoryIdentity) return null;

  const candidate = (() => {
    if (preferredRemoteName) {
      const match = (repositoryIdentity.remotes ?? []).find(
        (remote) => remote.name === preferredRemoteName,
      );
      if (match) {
        return {
          url: match.url,
          label: match.ownerRepo ?? match.url,
          provider: match.provider ?? undefined,
        };
      }
    }
    const locatorUrl = repositoryIdentity.locator.remoteUrl;
    return {
      url: locatorUrl,
      label: repositoryIdentity.displayName ?? repositoryIdentity.canonicalKey,
      provider: repositoryIdentity.provider ?? undefined,
    };
  })();

  const url = resolveRemoteUrlToBrowserUrl(candidate.url);
  if (!url) return null;
  return {
    url,
    label: candidate.label,
    provider: candidate.provider,
    providerLabel: formatRepositoryProviderLabel(candidate.provider),
  };
}
