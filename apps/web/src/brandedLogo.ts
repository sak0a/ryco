import { APP_STAGE_LABEL } from "./branding";
import logoBeta from "../../../assets/prod/favicon/apple-touch-icon.png";
import logoDev from "../../../assets/dev/favicon/apple-touch-icon.png";
import logoNightly from "../../../assets/nightly/favicon/apple-touch-icon.png";

const LOGO_BY_STAGE = {
  Beta: logoBeta,
  Dev: logoDev,
  Nightly: logoNightly,
} as const;

// Branded apple-touch-icon variant bundled into the JS so the React boot/splash
// surfaces always render the correct brand asset regardless of which static
// directory the server happens to be serving from.
export const BRANDED_APP_LOGO_SRC: string = LOGO_BY_STAGE[APP_STAGE_LABEL] ?? logoBeta;
