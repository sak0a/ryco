#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface RycoMarkdownTextManager : RCTViewManager
@end

@implementation RycoMarkdownTextManager

RCT_EXPORT_MODULE(RycoMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface RycoMarkdownTextRunManager : RCTViewManager
@end

@implementation RycoMarkdownTextRunManager

RCT_EXPORT_MODULE(RycoMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
