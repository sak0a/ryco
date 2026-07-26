import { useState } from "react";
import { Pressable, View } from "react-native";

import type { EnvironmentId, ThreadId } from "@ryco/contracts";
import type { PendingUserInput } from "@ryco/client-runtime/state/session";
import {
  buildPendingUserInputAnswers,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@ryco/client-runtime/state/user-input";

import { AppText as Text } from "../../components/AppText";
import { ensureEnvironmentApi } from "../../connection/environmentApi";
import { respondToThreadUserInput } from "./sessionActions";

// §3-16: draft answers are UI-local state; the answer assembly + validation come
// from the runtime user-input helpers (single source of truth).
export function PendingUserInputCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly userInput: PendingUserInput;
}) {
  const [drafts, setDrafts] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [submitting, setSubmitting] = useState(false);

  const toggle = (questionId: string, optionLabel: string) => {
    setDrafts((current) => {
      const question = props.userInput.questions.find((q) => q.id === questionId);
      if (!question) return current;
      return {
        ...current,
        [questionId]: togglePendingUserInputOptionSelection(
          question,
          current[questionId],
          optionLabel,
        ),
      };
    });
  };

  const isSelected = (questionId: string, optionLabel: string): boolean =>
    Boolean(drafts[questionId]?.selectedOptionLabels?.includes(optionLabel));

  const answers = buildPendingUserInputAnswers(props.userInput.questions, drafts);
  const canSubmit = answers !== null && !submitting;

  const submit = async () => {
    if (!answers) return;
    setSubmitting(true);
    try {
      await respondToThreadUserInput({
        api: ensureEnvironmentApi(props.environmentId),
        threadId: props.threadId,
        requestId: props.userInput.requestId,
        answers,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className="mx-4 my-2 rounded-2xl border border-accent-border bg-accent-bg p-4">
      <Text className="text-xs font-ryco-bold uppercase tracking-wide text-accent-strong">
        Input needed
      </Text>
      {props.userInput.questions.map((question) => (
        <View key={question.id} className="mt-3">
          <Text className="font-sans text-base text-foreground">{question.question}</Text>
          <View className="mt-2 gap-2">
            {question.options.map((option) => (
              <Pressable
                key={option.label}
                onPress={() => toggle(question.id, option.label)}
                className={`rounded-xl border px-3 py-2.5 active:opacity-70 ${
                  isSelected(question.id, option.label)
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card"
                }`}
              >
                <Text className="font-sans text-sm text-foreground">{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <Pressable
        disabled={!canSubmit}
        onPress={() => void submit()}
        className="mt-4 items-center rounded-full bg-primary px-4 py-2.5 active:opacity-70 disabled:opacity-40"
      >
        <Text className="text-sm font-ryco-bold text-primary-foreground">Submit</Text>
      </Pressable>
    </View>
  );
}
