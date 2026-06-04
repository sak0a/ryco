import { type ReactNode } from "react";

import { resolveInactivePanelContentVisibilityStyle } from "../lib/perf/motion";
import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const panelContentVisibilityStyle = resolveInactivePanelContentVisibilityStyle({
    active: props.open,
    containIntrinsicSize: "28rem 100vh",
  });

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
      >
        <div className="flex min-h-0 w-full flex-1" style={panelContentVisibilityStyle}>
          {props.children}
        </div>
      </SheetPopup>
    </Sheet>
  );
}
