#import "RycoMarkdownTextRun.h"
#import "RycoMarkdownText.h"
#import "RycoMarkdownTextRunComponentDescriptor.h"
#import <react/renderer/components/RycoMarkdownTextSpec/EventEmitters.h>
#import <react/renderer/components/RycoMarkdownTextSpec/Props.h>
#import <react/renderer/components/RycoMarkdownTextSpec/RCTComponentViewHelpers.h>
#import "RCTFabricComponentsPlugins.h"
#import "Utils.h"

using namespace facebook::react;

@interface RycoMarkdownTextRun () <RCTRycoMarkdownTextRunViewProtocol>

@end

@implementation RycoMarkdownTextRun {
  NSString * _text;
  RCTBubblingEventBlock _onPress;
  RCTBubblingEventBlock _onLongPress;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
    return concreteComponentDescriptorProvider<RycoMarkdownTextRunComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const RycoMarkdownTextRunProps>();
    _props = defaultProps;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<RycoMarkdownTextRunProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<RycoMarkdownTextRunProps const>(props);

  if (newViewProps.text != oldViewProps.text) {
    NSString *text = [NSString stringWithUTF8String:newViewProps.text.c_str()];
    _text = text;
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)onPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::RycoMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onPress(facebook::react::RycoMarkdownTextRunEventEmitter::OnPress{});
  }
}

- (void)onLongPress {
  if (_eventEmitter != nullptr) {
    std::dynamic_pointer_cast<const facebook::react::RycoMarkdownTextRunEventEmitter>(_eventEmitter)
    ->onLongPress(facebook::react::RycoMarkdownTextRunEventEmitter::OnLongPress{});
  }
}

+ (BOOL)shouldBeRecycled {
  return NO;
}

Class<RCTComponentViewProtocol> RycoMarkdownTextRunCls(void)
{
    return RycoMarkdownTextRun.class;
}

@end
