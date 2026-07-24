#pragma once

#include <react/renderer/components/RycoMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/RycoMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char RycoMarkdownTextComponentName[];

struct RycoMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct RycoMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
};

inline Float RycoMarkdownTextAttachmentSize(const RycoMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float RycoMarkdownTextAttachmentBaselineOffset(
    const RycoMarkdownTextAttachmentRange &) {
  return -2;
}

class RycoMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<RycoMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<RycoMarkdownTextAttachmentRange> attachmentRanges;
};

class RycoMarkdownTextShadowNode final : public ConcreteViewShadowNode<
RycoMarkdownTextComponentName,
RycoMarkdownTextProps,
RycoMarkdownTextEventEmitter,
RycoMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  RycoMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<RycoMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<RycoMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
