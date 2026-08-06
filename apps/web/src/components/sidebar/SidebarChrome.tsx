import { PanelLeftCloseIcon, SettingsIcon } from "lucide-react";
import React, { memo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { APP_BASE_NAME, APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { useSettingsDialogStore } from "../../settingsDialogStore";
import { SidebarFooter, SidebarHeader, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";

/**
 * The Ryco "R" mark, from `assets/logo_letter_only.svg`.
 *
 * Re-cut to a viewBox tight around the glyph: the source art floats the letter
 * inside a square canvas roughly three times its size, so the original box
 * would render it at a third of the requested height. The source fill
 * (`rgb(21,21,21)`) is dropped for `currentColor` so the theme's foreground
 * token carries the mark — near-black in light mode, near-white in dark —
 * instead of a hardcoded near-black that would vanish on the dark sidebar.
 */
function RycoLetterMark() {
  return (
    <svg
      aria-label="Ryco"
      className="h-4.5 w-auto shrink-0 text-foreground"
      viewBox="414.46 386.67 425.09 480.61"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <g transform="matrix(0.125617,0,0,-0.125617,-180.839814,1610.932617)">
        <path d="M6035,9744C5514,9700 5112,9433 4886,8982C4838,8886 4786,8729 4764,8610L4746,8515L4742,7231L4739,5947L4758,5928L4796,5962C4818,5981 4975,6121 5147,6273L5459,6550L5462,7502L5465,8455L5491,8532C5576,8779 5754,8952 6002,9028L6055,9044L6605,9048C6908,9050 7178,9049 7206,9045L7258,9039L7364,8975L7392,8930C7407,8905 7424,8863 7429,8835L7438,8786L7429,8725C7424,8692 7406,8636 7389,8601L7358,8538L7295,8474L7233,8411L7161,8376L7088,8341L7032,8335C6708,8298 6509,8207 6296,7996C6187,7889 6155,7846 5901,7472L5708,7188L5714,7167C5717,7155 5741,7123 5768,7095C5794,7068 5840,7016 5870,6980C5919,6922 6037,6786 6370,6405C6428,6340 6528,6225 6594,6150C6659,6076 6732,5994 6757,5968L6801,5920L7710,5920L7710,5933C7710,5939 7666,5997 7612,6061C7503,6191 7498,6197 7009,6774C6599,7259 6590,7270 6590,7283C6590,7305 6683,7421 6753,7486L6827,7555L6975,7629L7040,7640C7076,7646 7148,7659 7200,7670C7628,7751 8003,8123 8102,8563L8123,8655L8122,8795L8122,8935L8097,9030C8048,9217 7971,9350 7832,9482C7695,9612 7569,9680 7385,9723L7295,9743L6685,9745C6350,9746 6057,9746 6035,9744Z" />
      </g>
    </svg>
  );
}

const SIDEBAR_HEADER_ACTION_CLASS_NAME =
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground/70 outline-hidden ring-ring transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    openSettings();
  }, [isMobile, openSettings, setOpenMobile]);

  const actionButtons = (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Settings"
              onClick={handleSettingsClick}
              className={SIDEBAR_HEADER_ACTION_CLASS_NAME}
            >
              <SettingsIcon className="size-3.5" />
              <span className="hidden text-xs @[12rem]/sidebar-header:inline">Settings</span>
            </button>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Settings
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="Hide sidebar"
              onClick={toggleSidebar}
              className={SIDEBAR_HEADER_ACTION_CLASS_NAME}
            >
              <PanelLeftCloseIcon className="size-3.5" />
            </button>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Hide sidebar
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  const brandRow = (
    <div className="@container/sidebar-header flex w-full min-w-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to threads"
              className="ml-1 flex min-w-0 cursor-pointer items-center rounded-md outline-hidden ring-ring transition-opacity hover:opacity-80 focus-visible:ring-2"
              to="/"
            >
              <RycoLetterMark />
            </Link>
          }
        />
        {/* The release stage moved off the header with the wordmark badge, so
            the tooltip carries it — a Dev or Nightly build still has to be
            identifiable without opening settings. */}
        <TooltipPopup side="bottom" sideOffset={2}>
          {APP_BASE_NAME} {APP_STAGE_LABEL} · Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
      {actionButtons}
    </div>
  );

  return isElectron ? (
    <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)]">
      {brandRow}
    </SidebarHeader>
  ) : (
    <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">{brandRow}</SidebarHeader>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
    </SidebarFooter>
  );
});
