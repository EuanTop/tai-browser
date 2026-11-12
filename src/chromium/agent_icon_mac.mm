// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/agent_icon_mac.h"

#import <AppKit/AppKit.h>

#include "base/no_destructor.h"
#include "base/memory/ref_counted_memory.h"
#include "base/strings/string_view_util.h"
#include "sidebar_browser/brand_resources.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_util_mac.h"

namespace sidebar {
namespace {

constexpr CGFloat kIconSize = 16;

NSImage* InstalledIcon(NSString* identifier, NSString* asset = nil) {
  NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
  NSURL* url = [workspace URLForApplicationWithBundleIdentifier:identifier];
  if (!url) return nil;
  if (asset) {
    NSURL* resource = [[NSBundle bundleWithURL:url] URLForResource:asset
                                                     withExtension:@"png"];
    if (resource) {
      NSImage* image = [[NSImage alloc] initWithContentsOfURL:resource];
      if (image) return image;
    }
  }
  return [workspace iconForFile:url.path];
}

gfx::ImageSkia DrawIcon(NSImage* image, NSColor* tile, NSString* fallback) {
  NSImage* icon = [NSImage imageWithSize:NSMakeSize(kIconSize, kIconSize)
                                flipped:NO
                         drawingHandler:^BOOL(NSRect rect) {
    if (tile) {
      [tile setFill];
      [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:4 yRadius:4] fill];
    }
    if (image) {
      [image drawInRect:tile ? NSInsetRect(rect, 3.5, 3.5) : rect
               fromRect:NSZeroRect
              operation:NSCompositingOperationSourceOver
               fraction:1
         respectFlipped:YES
                  hints:nil];
    } else {
      NSDictionary* attributes = @{
        NSFontAttributeName: [NSFont systemFontOfSize:10 weight:NSFontWeightSemibold],
        NSForegroundColorAttributeName: NSColor.whiteColor,
      };
      const NSSize size = [fallback sizeWithAttributes:attributes];
      [fallback drawAtPoint:NSMakePoint((NSWidth(rect) - size.width) / 2,
                                        (NSHeight(rect) - size.height) / 2)
             withAttributes:attributes];
    }
    return YES;
  }];
  return gfx::ImageSkiaFromNSImage(icon);
}

gfx::ImageSkia ChatGPTIcon() {
  NSImage* app = InstalledIcon(@"com.openai.codex", @"icon-chatgpt");
  return DrawIcon(app, app ? nil : [NSColor colorWithSRGBRed:.14 green:.39 blue:.34 alpha:1], @"G");
}

gfx::ImageSkia ClaudeIcon() {
  NSImage* app = InstalledIcon(@"com.anthropic.claudefordesktop");
  return DrawIcon(app, app ? nil : [NSColor colorWithSRGBRed:.66 green:.30 blue:.21 alpha:1], @"C");
}

gfx::ImageSkia PiIcon() {
  NSString* encoded = [NSString stringWithUTF8String:brand_resources::kPiAgentIcon];
  NSData* png = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
  return DrawIcon([[NSImage alloc] initWithData:png], NSColor.whiteColor, @"π");
}

}  // namespace

ui::ImageModel MacAgentIcon(std::string_view provider) {
  if (provider == "codex") {
    static const base::NoDestructor<gfx::ImageSkia> icon(ChatGPTIcon());
    return ui::ImageModel::FromImageSkia(*icon);
  }
  if (provider == "claude") {
    static const base::NoDestructor<gfx::ImageSkia> icon(ClaudeIcon());
    return ui::ImageModel::FromImageSkia(*icon);
  }
  if (provider == "pi") {
    static const base::NoDestructor<gfx::ImageSkia> icon(PiIcon());
    return ui::ImageModel::FromImageSkia(*icon);
  }
  return {};
}

std::string MacAgentIconPng(std::string_view provider) {
  auto model = MacAgentIcon(provider);
  if (model.IsEmpty()) return {};
  const auto bytes = model.GetImage().As1xPNGBytes();
  return bytes ? std::string(base::as_string_view(base::span(*bytes))) : std::string();
}

}  // namespace sidebar
