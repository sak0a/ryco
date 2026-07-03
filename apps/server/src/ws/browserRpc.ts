import { WS_METHODS } from "@ryco/contracts";

import { observeRpcEffect, observeRpcStream } from "../observability/RpcInstrumentation.ts";
import { defineWsHandlers, type WsRpcContext } from "./context.ts";

export const makeBrowserHandlers = (ctx: WsRpcContext) => {
  const { localDesktopOwnerEffect, localDesktopOwnerStream } = ctx;
  const browser = ctx.browserService;

  return defineWsHandlers({
    [WS_METHODS.browserGetStatus]: (_input) =>
      observeRpcEffect(
        WS_METHODS.browserGetStatus,
        localDesktopOwnerEffect(WS_METHODS.browserGetStatus, browser.getStatus),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserListProfiles]: (_input) =>
      observeRpcEffect(
        WS_METHODS.browserListProfiles,
        localDesktopOwnerEffect(WS_METHODS.browserListProfiles, browser.listProfiles),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserOpenSession]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserOpenSession,
        localDesktopOwnerEffect(WS_METHODS.browserOpenSession, browser.openSession(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserCloseSession]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserCloseSession,
        localDesktopOwnerEffect(WS_METHODS.browserCloseSession, browser.closeSession(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserGetSnapshot]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserGetSnapshot,
        localDesktopOwnerEffect(WS_METHODS.browserGetSnapshot, browser.getSnapshot(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserNavigate]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserNavigate,
        localDesktopOwnerEffect(WS_METHODS.browserNavigate, browser.navigate(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserBack]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserBack,
        localDesktopOwnerEffect(WS_METHODS.browserBack, browser.back(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserForward]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserForward,
        localDesktopOwnerEffect(WS_METHODS.browserForward, browser.forward(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserReload]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserReload,
        localDesktopOwnerEffect(WS_METHODS.browserReload, browser.reload(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserStop]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserStop,
        localDesktopOwnerEffect(WS_METHODS.browserStop, browser.stop(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserInput]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserInput,
        localDesktopOwnerEffect(WS_METHODS.browserInput, browser.input(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserInspectStorage]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserInspectStorage,
        localDesktopOwnerEffect(WS_METHODS.browserInspectStorage, browser.inspectStorage(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserClearStorage]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserClearStorage,
        localDesktopOwnerEffect(WS_METHODS.browserClearStorage, browser.clearStorage(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserDeleteCookie]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserDeleteCookie,
        localDesktopOwnerEffect(WS_METHODS.browserDeleteCookie, browser.deleteCookie(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserSnapshotDom]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserSnapshotDom,
        localDesktopOwnerEffect(WS_METHODS.browserSnapshotDom, browser.snapshotDom(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserScreenshot]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserScreenshot,
        localDesktopOwnerEffect(WS_METHODS.browserScreenshot, browser.screenshot(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserReadConsole]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserReadConsole,
        localDesktopOwnerEffect(WS_METHODS.browserReadConsole, browser.readConsole(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserReadNetwork]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserReadNetwork,
        localDesktopOwnerEffect(WS_METHODS.browserReadNetwork, browser.readNetwork(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.browserWaitFor]: (input) =>
      observeRpcEffect(
        WS_METHODS.browserWaitFor,
        localDesktopOwnerEffect(WS_METHODS.browserWaitFor, browser.waitFor(input)),
        { "rpc.aggregate": "browser" },
      ),
    [WS_METHODS.subscribeBrowserEvents]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeBrowserEvents,
        localDesktopOwnerStream(WS_METHODS.subscribeBrowserEvents, browser.events),
        { "rpc.aggregate": "browser" },
      ),
  });
};
