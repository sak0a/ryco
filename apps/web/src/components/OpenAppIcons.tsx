import androidStudioIcon from "../assets/editor-icons/android-studio.png";
import novaIcon from "../assets/editor-icons/nova.png";
import positronIcon from "../assets/editor-icons/positron.png";
import sublimeTextIcon from "../assets/editor-icons/sublime-text.png";
import windsurfIcon from "../assets/editor-icons/windsurf.png";
import xcodeIcon from "../assets/editor-icons/xcode.png";
import type { Icon } from "./Icons";

function createOriginalAppIcon(source: string, title: string): Icon {
  const OriginalAppIcon: Icon = (props) => (
    <svg {...props} viewBox="0 0 24 24" fill="none">
      <title>{title}</title>
      <image href={source} width="24" height="24" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
  OriginalAppIcon.displayName = `${title.replaceAll(" ", "")}Icon`;
  return OriginalAppIcon;
}

export const AndroidStudioIcon = createOriginalAppIcon(androidStudioIcon, "Android Studio");
export const XcodeIcon = createOriginalAppIcon(xcodeIcon, "Xcode");
export const WindsurfIcon = createOriginalAppIcon(windsurfIcon, "Windsurf");
export const SublimeTextIcon = createOriginalAppIcon(sublimeTextIcon, "Sublime Text");
export const NovaIcon = createOriginalAppIcon(novaIcon, "Nova");
export const PositronIcon = createOriginalAppIcon(positronIcon, "Positron");
