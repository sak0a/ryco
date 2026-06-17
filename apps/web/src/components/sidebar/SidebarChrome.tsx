import { SettingsIcon } from "lucide-react";
import React, { memo, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { APP_STAGE_LABEL, APP_VERSION } from "../../branding";
import { useSettingsDialogStore } from "../../settingsDialogStore";
import { SidebarFooter, SidebarHeader, SidebarTrigger, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";

function RycoWordmark() {
  return (
    <svg
      aria-label="Ryco"
      className="h-3 w-auto shrink-0 text-foreground"
      viewBox="650 1050 2150 800"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <g transform="matrix(0.718921,0,0,1,443.224836,208.15748)">
        <g transform="matrix(1.390973,0,0,1,-106.34474,0)">
          <g transform="matrix(1080.539877,0,0,1080.539877,272,1401.377914)">
            <path d="M0.055,-0.494L0.055,-0L0.104,-0L0.104,-0.288C0.104,-0.378 0.175,-0.452 0.267,-0.453C0.296,-0.453 0.325,-0.446 0.351,-0.43L0.373,-0.47C0.34,-0.49 0.304,-0.5 0.267,-0.499C0.204,-0.499 0.134,-0.473 0.103,-0.406L0.101,-0.494L0.055,-0.494Z" />
          </g>
          <g transform="matrix(1080.539877,0,0,1080.539877,729.068368,1401.377914)">
            <path d="M0.424,-0.494L0.3,-0.203L0.243,-0.059L0.185,-0.202L0.07,-0.494L0.017,-0.494L0.215,-0.006L0.124,0.206L0.176,0.206L0.477,-0.494L0.424,-0.494Z" />
          </g>
          <g transform="matrix(1080.539877,0,0,1080.539877,1287.707485,1401.377914)">
            <path d="M0.427,-0.102C0.387,-0.062 0.333,-0.041 0.28,-0.041C0.168,-0.041 0.074,-0.114 0.074,-0.247C0.074,-0.38 0.168,-0.453 0.28,-0.453C0.333,-0.453 0.388,-0.434 0.428,-0.394L0.46,-0.425C0.41,-0.474 0.345,-0.499 0.28,-0.499C0.137,-0.499 0.026,-0.403 0.026,-0.247C0.026,-0.091 0.141,0.005 0.28,0.005C0.345,0.005 0.41,-0.019 0.46,-0.069L0.427,-0.102Z" />
          </g>
          <g transform="matrix(1080.539877,0,0,1080.539877,1844.185521,1401.377914)">
            <path d="M0.283,0.007C0.422,0.007 0.534,-0.089 0.534,-0.246C0.534,-0.403 0.422,-0.503 0.283,-0.503C0.144,-0.503 0.032,-0.403 0.032,-0.246C0.032,-0.089 0.144,0.007 0.283,0.007ZM0.283,-0.041C0.171,-0.041 0.08,-0.118 0.08,-0.246C0.08,-0.374 0.171,-0.457 0.283,-0.457C0.395,-0.457 0.486,-0.374 0.486,-0.246C0.486,-0.118 0.395,-0.041 0.283,-0.041Z" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const openSettings = useSettingsDialogStore((s) => s.openSettings);
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    openSettings();
  }, [isMobile, openSettings, setOpenMobile]);

  const actionButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Settings"
            onClick={handleSettingsClick}
            className="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground/70 outline-hidden ring-ring transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2"
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
  );

  const wordmark = (
    <div className="@container/sidebar-header flex w-full min-w-0 items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to threads"
              className="ml-1 flex min-w-0 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
              to="/"
            >
              <RycoWordmark />
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </Link>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
      {actionButton}
    </div>
  );

  return isElectron ? (
    <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)]">
      {wordmark}
    </SidebarHeader>
  ) : (
    <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">{wordmark}</SidebarHeader>
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
