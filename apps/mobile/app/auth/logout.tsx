import { Redirect } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// Post-logout redirect target (kiorex://auth/logout). The in-app auth session normally consumes it; if the OS opens the app with it
// instead (Android custom tab), land on sign-in rather than an unmatched route.
WebBrowser.maybeCompleteAuthSession();

export default function AuthLogout() {
  return <Redirect href="/sign-in" />;
}
