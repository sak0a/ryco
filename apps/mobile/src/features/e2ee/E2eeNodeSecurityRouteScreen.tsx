import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { showConfirmDialog } from "../../components/ConfirmDialogHost";
import { useHostedModeAvailable } from "../hostedHub/useHostedMode";
import { E2eeActionButton, E2eeChannelCard, E2eeUnverifiedHubNotice } from "./E2eeTrustParts";
import { exactNodeRouteParams, resolveExactNodeRoute } from "./exactNodeRouteModel";
import { deriveE2eeSecurityView, type E2eeTrustAction } from "./e2eeTrustUiModel";
import { useMobileE2eeSession } from "./useMobileE2eeSession";
import { useHostedHubStore } from "../../hostedHub/state";

/**
 * The `docs/relay-e2ee-protocol.md` §13.1.1 security surface.
 *
 * Layout only. Which sections exist, what they say, which actions are offered
 * and what each one calls are all `e2eeTrustUiModel.ts`'s, and are asserted by a
 * node test — react-native ships untranspiled Flow, so a decision made in this
 * file could not be.
 */
type Props = StaticScreenProps<{ readonly nodeId: string; readonly environmentId: string }>;

export function E2eeNodeSecurityRouteScreen(props: Props) {
  const navigation = useNavigation();
  const nodes = useHostedHubStore((state) => state.nodes);
  const target = resolveExactNodeRoute(props.route.params, nodes);
  const session = useMobileE2eeSession(target?.environmentId ?? "__invalid-node-route__");
  // The hook, not the bare accessor: availability is false until the async
  // runtime configuration completes, and nothing about the §13 projection
  // changes when it flips — so a screen reached cold (a deep link, or Settings
  // opened before any other hosted surface has mounted) would have rendered the
  // "no Hub" copy for a fully hosted build and never re-rendered out of it.
  const hostedModeAvailable = useHostedModeAvailable();
  const view = deriveE2eeSecurityView({
    session,
    hostedModeAvailable,
    // The unreadable-document case has no synchronous probe: the store reports
    // it by refusing every mutation. Surfacing the owner action for it is left
    // to the Hub-domain screen that already owns the scoped forgets, so this
    // screen never offers a whole-namespace wipe it cannot justify.
    trustStateUnreadable: false,
    onOpenVerification: () => {
      if (!target) return;
      navigation.dispatch(
        StackActions.push("SettingsNodeVerification", exactNodeRouteParams(target.node)),
      );
    },
    now: () => Date.now(),
  });

  const confirm = (action: E2eeTrustAction) => {
    if (!action.confirm) {
      action.run();
      return;
    }
    showConfirmDialog({
      title: action.confirm.title,
      message: action.confirm.message,
      confirmText: action.confirm.confirmText,
      destructive: action.confirm.destructive,
      onConfirm: action.run,
    });
  };

  if (!target) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-screen">
        <Text className="mx-5 mt-6 font-sans text-sm leading-relaxed text-danger-foreground">
          This verification link does not match a current machine. Open Machines and choose the
          machine again.
        </Text>
      </ScrollView>
    );
  }

  if (!view.available) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-screen">
        <Text className="mx-5 mt-6 font-sans text-sm leading-relaxed text-foreground-muted">
          {view.unavailableMessage}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      className="flex-1 bg-screen"
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
    >
      <View
        accessibilityLabel={`Machine: ${target.node.label}`}
        className="mx-5 mt-2 mb-3 rounded-2xl border border-border bg-card px-4 py-3"
      >
        <Text className="font-sans text-xs font-ryco-medium text-foreground-muted">Machine</Text>
        <Text className="mt-1 font-sans text-sm font-ryco-bold text-foreground">
          {target.node.label}
        </Text>
      </View>

      <E2eeChannelCard claim={view.claim} label={view.channelLabel} message={view.channelMessage} />

      {/* §13.2.1: the surface names the selection and says which of the three
          situations occurred, ABOVE the two resolutions — neither may be taken
          without the copy that distinguishes them on screen. */}
      {view.situationTitle && view.situationMessage ? (
        <View
          accessibilityRole="alert"
          className="mx-5 mt-4 rounded-2xl border border-warning-border bg-warning-bg p-4"
        >
          <Text className="text-sm font-ryco-bold text-foreground">{view.situationTitle}</Text>
          {view.nodeLabel ? (
            <Text className="mt-1 font-sans text-xs text-foreground-muted">{view.nodeLabel}</Text>
          ) : null}
          <Text className="mt-1.5 font-sans text-sm leading-relaxed text-foreground">
            {view.situationMessage}
          </Text>
        </View>
      ) : null}

      {view.unverifiedHub ? (
        <E2eeUnverifiedHubNotice
          title={view.unverifiedHubTitle}
          message={view.unverifiedHubMessage}
          pair={view.pair}
        />
      ) : view.pair ? (
        <E2eeActionButton action={view.pair} onConfirm={confirm} variant="quiet" />
      ) : null}

      {view.resolutions.map((action) => (
        <E2eeActionButton
          key={action.id}
          action={action}
          onConfirm={confirm}
          variant={action.id === "start-pairing" ? "primary" : "quiet"}
        />
      ))}

      {view.rePair ? <E2eeActionButton action={view.rePair} onConfirm={confirm} /> : null}
      {view.destroyUnreadable ? (
        <E2eeActionButton action={view.destroyUnreadable} onConfirm={confirm} />
      ) : null}

      {view.diagnostics.length > 0 ? (
        <View className="mx-5 mt-8">
          <Text className="pb-2.5 text-sm font-ryco-medium text-foreground-muted">
            On this device
          </Text>
          <View className="overflow-hidden rounded-2xl border border-border bg-card">
            {view.diagnostics.map((row, index) => (
              <View
                key={row.id}
                className={`flex-row items-start gap-3 px-4 py-3 ${index > 0 ? "border-t border-border-subtle" : ""}`}
              >
                <Text className="min-w-0 flex-1 font-sans text-sm leading-relaxed text-foreground-muted">
                  {row.label}
                </Text>
                {row.count > 1 ? (
                  <Text className="shrink-0 pt-0.5 font-sans text-xs text-foreground-faint">
                    {row.count} attempts
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          <Text className="mt-2.5 font-sans text-xs leading-relaxed text-foreground-muted">
            {view.diagnosticsCaption}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
