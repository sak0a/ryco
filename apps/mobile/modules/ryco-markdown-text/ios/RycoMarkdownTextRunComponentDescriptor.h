#pragma once

#include "RycoMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using RycoMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<RycoMarkdownTextRunShadowNode>;

void RycoMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
