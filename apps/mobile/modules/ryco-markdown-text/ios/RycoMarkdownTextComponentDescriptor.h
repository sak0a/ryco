#pragma once

#include "RycoMarkdownTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using RycoMarkdownTextComponentDescriptor = ConcreteComponentDescriptor<RycoMarkdownTextShadowNode>;

void RycoMarkdownTextSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
