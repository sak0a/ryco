import { View } from "react-native";
import type { StaticScreenProps } from "@react-navigation/native";

import { EmptyState } from "../../components/EmptyState";

// B2 placeholder — replaced by the real screen in a later task. Declares its
// thread route params so the flat deep-link route stays typed and navigable.
type RouteProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
}>;

export function ReviewCommentComposerSheet(_props: RouteProps) {
  return (
    <View className="flex-1 items-center justify-center bg-screen px-6">
      <EmptyState variant="plain" title="Comment" detail="The review comment composer arrives in the next build." />
    </View>
  );
}
