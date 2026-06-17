import { describe, expect, it } from "vite-plus/test";
import {
  deriveComposerFooterActionLayoutKey,
  deriveComposerSendState,
  isComposerPrimaryActionDisabled,
  shouldBlurComposerOnSubmit,
} from "./ComposerSendPipeline";

describe("deriveComposerSendState (re-export)", () => {
  it("reports sendable content when the prompt has text", () => {
    const state = deriveComposerSendState({
      prompt: "hello",
      imageCount: 0,
      terminalContexts: [],
    });
    expect(state.hasSendableContent).toBe(true);
    expect(state.trimmedPrompt).toBe("hello");
  });

  it("reports no sendable content for an empty prompt and no attachments", () => {
    const state = deriveComposerSendState({
      prompt: "   ",
      imageCount: 0,
      terminalContexts: [],
    });
    expect(state.hasSendableContent).toBe(false);
  });

  it("treats images as sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 1,
      terminalContexts: [],
    });
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("isComposerPrimaryActionDisabled", () => {
  const base = {
    phase: "ready" as const,
    isSendBusy: false,
    isConnecting: false,
    hasSendableContent: true,
  };

  it("is enabled when content is sendable and nothing is busy", () => {
    expect(isComposerPrimaryActionDisabled(base)).toBe(false);
  });

  it("is disabled while running", () => {
    expect(isComposerPrimaryActionDisabled({ ...base, phase: "running" })).toBe(true);
  });

  it("is disabled while send is busy", () => {
    expect(isComposerPrimaryActionDisabled({ ...base, isSendBusy: true })).toBe(true);
  });

  it("is disabled while connecting", () => {
    expect(isComposerPrimaryActionDisabled({ ...base, isConnecting: true })).toBe(true);
  });

  it("is disabled without sendable content", () => {
    expect(isComposerPrimaryActionDisabled({ ...base, hasSendableContent: false })).toBe(true);
  });
});

describe("shouldBlurComposerOnSubmit", () => {
  const base = {
    isMobileViewport: true,
    isSendBusy: false,
    isConnecting: false,
    phase: "ready" as const,
    pendingProgress: null,
    hasResolvedAnswers: false,
    showPlanFollowUpPrompt: false,
    hasSendableContent: true,
  };

  it("returns false off mobile viewport", () => {
    expect(shouldBlurComposerOnSubmit({ ...base, isMobileViewport: false })).toBe(false);
  });

  it("returns false while busy/connecting/running", () => {
    expect(shouldBlurComposerOnSubmit({ ...base, isSendBusy: true })).toBe(false);
    expect(shouldBlurComposerOnSubmit({ ...base, isConnecting: true })).toBe(false);
    expect(shouldBlurComposerOnSubmit({ ...base, phase: "running" })).toBe(false);
  });

  it("blurs on the last pending question once answers resolve", () => {
    expect(
      shouldBlurComposerOnSubmit({
        ...base,
        pendingProgress: { isLastQuestion: true },
        hasResolvedAnswers: true,
      }),
    ).toBe(true);
    expect(
      shouldBlurComposerOnSubmit({
        ...base,
        pendingProgress: { isLastQuestion: true },
        hasResolvedAnswers: false,
      }),
    ).toBe(false);
    expect(
      shouldBlurComposerOnSubmit({
        ...base,
        pendingProgress: { isLastQuestion: false },
        hasResolvedAnswers: true,
      }),
    ).toBe(false);
  });

  it("blurs for plan follow-up or sendable content", () => {
    expect(shouldBlurComposerOnSubmit({ ...base, hasSendableContent: true })).toBe(true);
    expect(
      shouldBlurComposerOnSubmit({
        ...base,
        hasSendableContent: false,
        showPlanFollowUpPrompt: true,
      }),
    ).toBe(true);
    expect(
      shouldBlurComposerOnSubmit({
        ...base,
        hasSendableContent: false,
        showPlanFollowUpPrompt: false,
      }),
    ).toBe(false);
  });
});

describe("deriveComposerFooterActionLayoutKey", () => {
  const base = {
    pendingProgress: null,
    pendingIsResponding: false,
    phase: "ready" as const,
    showPlanFollowUpPrompt: false,
    promptHasText: false,
    hasSendableContent: false,
    isSendBusy: false,
    isConnecting: false,
    isPreparingWorktree: false,
  };

  it("keys on pending progress when present", () => {
    expect(
      deriveComposerFooterActionLayoutKey({
        ...base,
        pendingProgress: { questionIndex: 2, isLastQuestion: true },
        pendingIsResponding: true,
      }),
    ).toBe("pending:2:true:true");
  });

  it("keys running phase", () => {
    expect(deriveComposerFooterActionLayoutKey({ ...base, phase: "running" })).toBe("running");
  });

  it("distinguishes plan refine vs implement", () => {
    expect(
      deriveComposerFooterActionLayoutKey({
        ...base,
        showPlanFollowUpPrompt: true,
        promptHasText: true,
      }),
    ).toBe("plan:refine");
    expect(
      deriveComposerFooterActionLayoutKey({
        ...base,
        showPlanFollowUpPrompt: true,
        promptHasText: false,
      }),
    ).toBe("plan:implement");
  });

  it("keys idle state with eligibility flags", () => {
    expect(
      deriveComposerFooterActionLayoutKey({
        ...base,
        hasSendableContent: true,
        isSendBusy: true,
        isConnecting: false,
        isPreparingWorktree: true,
      }),
    ).toBe("idle:true:true:false:true");
  });
});
