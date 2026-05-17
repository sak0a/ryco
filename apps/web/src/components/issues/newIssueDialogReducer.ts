export interface NewIssueState {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  worktreeEnabled: boolean;
  worktreeBranchName: string | null;
  ai: {
    polishStatus: "idle" | "running" | "error";
    titleStatus: "idle" | "running" | "error";
    branchStatus: "idle" | "running" | "error";
    lastError: string | null;
  };
  submitStatus: "idle" | "submitting" | "error";
  submitError: string | null;
}

export const initialNewIssueState: NewIssueState = {
  title: "",
  body: "",
  labels: [],
  assignees: [],
  worktreeEnabled: true,
  worktreeBranchName: null,
  ai: {
    polishStatus: "idle",
    titleStatus: "idle",
    branchStatus: "idle",
    lastError: null,
  },
  submitStatus: "idle",
  submitError: null,
};

export type NewIssueAction =
  | { type: "setTitle"; value: string }
  | { type: "setBody"; value: string }
  | { type: "setLabels"; labels: ReadonlyArray<string> }
  | { type: "setAssignees"; assignees: ReadonlyArray<string> }
  | { type: "setWorktreeEnabled"; value: boolean }
  | { type: "setWorktreeBranchName"; value: string }
  | { type: "branchGenerated"; branch: string }
  | { type: "aiPolishStarted" }
  | {
      type: "aiPolishSucceeded";
      result: { readonly title?: string | undefined; readonly body?: string | undefined };
    }
  | { type: "aiPolishFailed"; error: string }
  | { type: "aiTitleStarted" }
  | { type: "aiTitleSucceeded"; result: { readonly title?: string | undefined } }
  | { type: "aiTitleFailed"; error: string }
  | { type: "aiBranchStarted" }
  | { type: "aiBranchFailed"; error: string }
  | { type: "submitStarted" }
  | { type: "submitFailed"; error: string };

export function newIssueDialogReducer(
  state: NewIssueState,
  action: NewIssueAction,
): NewIssueState {
  switch (action.type) {
    case "setTitle":
      return { ...state, title: action.value };
    case "setBody":
      return { ...state, body: action.value };
    case "setLabels":
      return { ...state, labels: [...action.labels] };
    case "setAssignees":
      return { ...state, assignees: [...action.assignees] };
    case "setWorktreeEnabled":
      return { ...state, worktreeEnabled: action.value };
    case "setWorktreeBranchName":
      return { ...state, worktreeBranchName: action.value };
    case "branchGenerated":
      return {
        ...state,
        worktreeBranchName: action.branch,
        ai: { ...state.ai, branchStatus: "idle" },
      };
    case "aiPolishStarted":
      return { ...state, ai: { ...state.ai, polishStatus: "running", lastError: null } };
    case "aiPolishSucceeded":
      return {
        ...state,
        title: state.title === "" && action.result.title ? action.result.title : state.title,
        body: action.result.body ?? state.body,
        ai: { ...state.ai, polishStatus: "idle" },
      };
    case "aiPolishFailed":
      return {
        ...state,
        ai: { ...state.ai, polishStatus: "error", lastError: action.error },
      };
    case "aiTitleStarted":
      return { ...state, ai: { ...state.ai, titleStatus: "running" } };
    case "aiTitleSucceeded":
      return {
        ...state,
        title: action.result.title ?? state.title,
        ai: { ...state.ai, titleStatus: "idle" },
      };
    case "aiTitleFailed":
      return {
        ...state,
        ai: { ...state.ai, titleStatus: "error", lastError: action.error },
      };
    case "aiBranchStarted":
      return { ...state, ai: { ...state.ai, branchStatus: "running" } };
    case "aiBranchFailed":
      return {
        ...state,
        ai: { ...state.ai, branchStatus: "error", lastError: action.error },
      };
    case "submitStarted":
      return { ...state, submitStatus: "submitting", submitError: null };
    case "submitFailed":
      return { ...state, submitStatus: "error", submitError: action.error };
    default:
      return state;
  }
}

export function canSubmit(state: NewIssueState): boolean {
  if (state.title.trim() === "") return false;
  if (state.submitStatus === "submitting") return false;
  if (
    state.ai.polishStatus === "running" ||
    state.ai.titleStatus === "running" ||
    state.ai.branchStatus === "running"
  )
    return false;
  if (state.worktreeEnabled && state.worktreeBranchName === null) return false;
  return true;
}
