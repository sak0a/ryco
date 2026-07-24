#pragma once

#include <react/renderer/components/RycoMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/RycoMarkdownTextSpec/Props.h>
#include <react/renderer/components/RycoMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char RycoMarkdownTextRunComponentName[];

using RycoMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    RycoMarkdownTextRunComponentName,
    RycoMarkdownTextRunProps,
    RycoMarkdownTextRunEventEmitter,
    RycoMarkdownTextRunState>;
}
