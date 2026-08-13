import { View } from "react-native";
import { WebView } from "react-native-webview";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export function createTurnstileHtml(siteKey: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
    <style>
      html, body, #challenge { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
      body { display: flex; align-items: center; justify-content: center; }
    </style>
    <script src="${TURNSTILE_ORIGIN}/turnstile/v0/api.js" async defer></script>
  </head>
  <body>
    <div
      id="challenge"
      class="cf-turnstile"
      data-sitekey=${JSON.stringify(siteKey)}
      data-action="native_identity"
      data-theme="dark"
      data-size="flexible"
      data-retry="auto"
      data-callback="complete"
      data-error-callback="clear"
      data-expired-callback="clear"
      data-unsupported-callback="clear"
    ></div>
    <script>
      function send(token) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ token: token }));
      }
      function complete(token) { send(token); }
      function clear() { send(null); }
    </script>
  </body>
</html>`;
}

export function turnstileOriginWhitelist(origin: string): ReadonlyArray<string> {
  return [origin, TURNSTILE_ORIGIN, "about:blank", "about:srcdoc"];
}

export function parseTurnstileMessage(data: string): string | null {
  try {
    const value = JSON.parse(data) as { readonly token?: unknown };
    return typeof value.token === "string" && value.token.length > 0 ? value.token : null;
  } catch {
    return null;
  }
}

export function TurnstileChallenge(props: {
  readonly origin: string;
  readonly siteKey: string;
  readonly onToken: (token: string | null) => void;
}) {
  const clearToken = () => props.onToken(null);

  return (
    <View
      accessibilityLabel="Cloudflare verification"
      className="h-20 w-full overflow-hidden rounded-xl"
      style={{ height: 80, width: "100%", flex: 0 }}
    >
      <WebView
        source={{ html: createTurnstileHtml(props.siteKey), baseUrl: props.origin }}
        originWhitelist={[...turnstileOriginWhitelist(props.origin)]}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        onMessage={(event) => props.onToken(parseTurnstileMessage(event.nativeEvent.data))}
        onError={clearToken}
        onHttpError={clearToken}
        style={{ height: 80, width: "100%", flex: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}
