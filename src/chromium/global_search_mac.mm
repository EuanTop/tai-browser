// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/global_search_mac.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include <algorithm>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/i18n/case_conversion.h"
#include "base/no_destructor.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/timer/timer.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_provider_client.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_scheme_classifier.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "components/omnibox/browser/autocomplete_controller.h"
#include "components/omnibox/browser/autocomplete_controller_config.h"
#include "components/omnibox/browser/autocomplete_enums.h"
#include "components/omnibox/browser/autocomplete_input.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_provider.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "sidebar_browser/localization.h"
#include "sidebar_browser/internal_urls.h"
#include "sidebar_browser/shortcuts.h"
#include "sidebar_browser/space_navigation_view.h"
#include "sidebar_browser/workspace_state.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/accelerators/global_accelerator_listener/global_accelerator_listener.h"
#include "ui/base/base_window.h"
#include "ui/base/page_transition_types.h"
#include "ui/base/window_open_disposition.h"
#include "url/gurl.h"

namespace sidebar {
class GlobalSearchController;
}

@interface TaiSearchPanel : NSPanel
@end

@interface TaiSearchRow : NSTableRowView
@end

@interface TaiSearchUI : NSObject <NSSearchFieldDelegate, NSTableViewDataSource,
                                  NSTableViewDelegate, NSWindowDelegate>
@property(nonatomic, assign) sidebar::GlobalSearchController* owner;
@property(nonatomic, strong) TaiSearchPanel* panel;
@property(nonatomic, strong) NSSearchField* search;
@property(nonatomic, strong) NSTableView* table;
@property(nonatomic, strong) NSScrollView* scroll;
@property(nonatomic, strong) NSTextField* context;
@property(nonatomic, strong) NSButton* closeButton;
@property(nonatomic, strong) NSRunningApplication* previousApp;
@property(nonatomic, assign) BOOL presenting;
- (void)showWithPlaceholder:(NSString*)placeholder context:(NSString*)context closeLabel:(NSString*)closeLabel;
- (void)reloadRows;
- (void)hideRestoringPreviousApp:(BOOL)restore;
@end

namespace sidebar {
namespace {
constexpr size_t kMaxRows = 7;
struct SearchRow {
  GURL url;
  std::u16string title;
  std::u16string detail;
  bool search = false;
};
bool CanOpen(const GURL& url) {
  // The palette navigates ordinary web and browser management pages only.
  // It never executes javascript/data URLs or omnibox action callbacks.
  return url.is_valid() && (url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("chrome"));
}
}  // namespace

class GlobalSearchController final : public ui::GlobalAcceleratorListener::Observer,
                                     public AutocompleteController::Observer,
                                     public ProfileObserver {
 public:
  GlobalSearchController() = default;
  static GlobalSearchController& Get() {
    static base::NoDestructor<GlobalSearchController> instance;
    return *instance;
  }
  bool Update(BrowserWindowInterface* browser, std::string_view binding) {
    if (!browser || browser->IsDeleteScheduled() || !SpaceNavigationView::From(browser))
      return registered_;
    // Synthetic headless tests must never reserve a desktop shortcut.
    if (base::CommandLine::ForCurrentProcess()->HasSwitch("headless")) {
      status_ = "unsupported";
      return false;
    }
    if (last_browser_ && last_browser_.get() != browser && !browser->GetWindow()->IsActive())
      return registered_;
    last_browser_ = browser->GetWeakPtr();
    if (binding_ == binding && attempted_) return registered_;
    if (auto* listener = ui::GlobalAcceleratorListener::GetInstance();
        listener && listener->IsShortcutHandlingSuspended()) {
      status_ = "unsupported"; return false;
    }
    Unregister();
    binding_ = std::string(binding);
    attempted_ = true;
    return Register();
  }
  bool Register() {
    if (capturing_) return false;
    if (registered_) { status_ = "registered"; return true; }
    if (binding_.empty()) { status_ = "unassigned"; return false; }
    accelerator_ = ParseShortcut(binding_);
    if (!accelerator_) { status_ = "invalid"; return false; }
    auto* listener = ui::GlobalAcceleratorListener::GetInstance();
    if (!listener || listener->IsShortcutHandlingSuspended()) {
      status_ = "unsupported"; return false;
    }
    registered_ = listener->RegisterAccelerator(*accelerator_, this);
    status_ = registered_ ? "registered" : "conflict";
    return registered_;
  }
  void Unregister() {
    if (!registered_) return;
    auto* listener = ui::GlobalAcceleratorListener::GetInstance();
    if (listener) {
      listener->UnregisterAccelerator(*accelerator_, this);
      registered_ = false;
    }
  }
  void Forget(BrowserWindowInterface* closing) {
    if (panel_browser_.get() == closing) Hide();
    if (last_browser_.get() != closing) return;
    last_browser_.reset();
    BrowserWindowInterface* replacement = nullptr;
    GlobalBrowserCollection::GetInstance()->ForEach([&](BrowserWindowInterface* browser) {
      if (browser != closing && !browser->IsDeleteScheduled() && SpaceNavigationView::From(browser)) {
        replacement = browser; return false;
      }
      return true;
    }, BrowserCollection::Order::kActivation);
    if (replacement) {
      Update(replacement, ShortcutBinding(*WorkspaceState::ForProfile(replacement->GetProfile()), "global_search"));
    } else {
      Unregister(); attempted_ = false; status_ = "unassigned";
      capture_timer_.Stop(); capturing_ = false;
    }
  }
  bool registered() const { return registered_; }
  std::string_view status() const { return status_; }
  void Capture(bool capture) {
    capture_timer_.Stop();
    if (capture) {
      Unregister();
      capturing_ = true;
      capture_timer_.Start(FROM_HERE, base::Seconds(30),
          base::BindOnce(&GlobalSearchController::Capture, base::Unretained(this), false));
    } else if (capturing_) {
      capturing_ = false;
      Register();
    }
  }
  void OnKeyPressed(const ui::Accelerator&) override { Show(nullptr); }
  void ExecuteCommand(const std::string&, const std::string&) override {}
  BrowserWindowInterface* Target() {
    if (last_browser_ && !last_browser_->IsDeleteScheduled() &&
        SpaceNavigationView::From(last_browser_.get())) return last_browser_.get();
    BrowserWindowInterface* result = nullptr;
    GlobalBrowserCollection::GetInstance()->ForEach([&](BrowserWindowInterface* browser) {
      if (!browser->IsDeleteScheduled() && SpaceNavigationView::From(browser)) {
        result = browser; return false;
      }
      return true;
    }, BrowserCollection::Order::kActivation);
    if (result) last_browser_ = result->GetWeakPtr();
    return result;
  }
  void Show(BrowserWindowInterface* browser) {
    if (base::CommandLine::ForCurrentProcess()->HasSwitch("headless")) return;
    if (browser && SpaceNavigationView::From(browser)) last_browser_ = browser->GetWeakPtr();
    browser = Target();
    if (!browser || capturing_) return;
    if (!ui_) {
      ui_ = [[TaiSearchUI alloc] init];
      ui_.owner = this;
    }
    if (ui_.panel.visible) { Hide(); return; }
    ResetAutocomplete();
    panel_browser_ = browser->GetWeakPtr();
    panel_space_ = SpaceNavigationView::From(browser)->active_space_id();
    profile_ = browser->GetProfile();
    profile_observer_.Observe(profile_);
    AutocompleteControllerConfig config;
    using ProviderType = AutocompleteProvider::Type;
    config.provider_types = static_cast<int>(ProviderType::kBookmark) |
        static_cast<int>(ProviderType::kBuiltin) |
        static_cast<int>(ProviderType::kHistoryQuick) |
        static_cast<int>(ProviderType::kHistoryUrl) |
        static_cast<int>(ProviderType::kSearch) |
        static_cast<int>(ProviderType::kShortcuts);
    config.disable_ml = true;
    config.show_iph_matches = false;
    autocomplete_ = std::make_unique<AutocompleteController>(
        std::make_unique<ChromeAutocompleteProviderClient>(profile_), config);
    autocomplete_->AddObserver(this);
    auto* sidebar = SpaceNavigationView::From(browser);
    auto* state = WorkspaceState::ForProfile(profile_);
    std::string context = "TAi";
    if (const auto* space = state->model().FindSpace(sidebar->active_space_id()))
      context = space->icon + " " + space->name;
    ui_.panel.title = base::SysUTF16ToNSString(LocalizedText16(profile_, "TAi 搜索", "TAi Search"));
    [ui_.panel setAccessibilityLabel:ui_.panel.title];
    [ui_ showWithPlaceholder:base::SysUTF16ToNSString(LocalizedText16(profile_,
        "搜索或输入网址", "Search or enter a URL"))
                       context:base::SysUTF8ToNSString(context)
                    closeLabel:base::SysUTF16ToNSString(LocalizedText16(profile_, "关闭搜索", "Close search"))];
    Query(@"");
  }
  void Hide(bool restore = true) {
    if (hiding_) return;
    hiding_ = true;
    if (ui_) [ui_ hideRestoringPreviousApp:restore];
    ResetAutocomplete();
    rows_.clear(); saved_matches_.clear();
    if (ui_) [ui_.table reloadData];
    hiding_ = false;
  }
  void ResetAutocomplete() {
    if (autocomplete_) {
      autocomplete_->RemoveObserver(this);
      autocomplete_->Stop(AutocompleteStopReason::kClobbered);
      autocomplete_.reset();
    }
    profile_observer_.Reset();
    profile_ = nullptr;
    panel_browser_.reset(); panel_space_.clear();
  }
  void OnProfileWillBeDestroyed(Profile*) override { Hide(); }
  std::vector<SearchRow> SavedMatches(std::u16string_view query, size_t limit) const {
    std::vector<SearchRow> matches;
    const auto* state = WorkspaceState::ForProfile(profile_);
    const auto needle = base::i18n::ToLower(query);
    std::set<std::string> seen;
    for (const auto& item : state->model().items()) {
      if (item.kind == SavedKind::kFolder ||
          (item.kind != SavedKind::kFavorite && item.space_id != panel_space_)) continue;
      const GURL url(item.url);
      if (!CanOpen(url) || !seen.insert(url.spec()).second) continue;
      const auto title = base::UTF8ToUTF16(item.title);
      if (!needle.empty() && base::i18n::ToLower(title + u" " + base::UTF8ToUTF16(item.url)).find(needle) == std::u16string::npos) continue;
      matches.push_back({url, title, base::UTF8ToUTF16(url.host()), false});
      if (matches.size() == limit) break;
    }
    return matches;
  }
  void Query(NSString* text) {
    if (!autocomplete_ || !profile_) return;
    auto* browser = panel_browser_.get();
    if (!browser || browser->IsDeleteScheduled() || !SpaceNavigationView::From(browser) ||
        SpaceNavigationView::From(browser)->active_space_id() != panel_space_) { Hide(); return; }
    auto input_text = base::SysNSStringToUTF16(text);
    const GURL typed(base::UTF16ToUTF8(input_text));
    if (typed.SchemeIs("tai")) {
      const auto canonical = CanonicalTaiInput(typed);
      if (!canonical) { rows_.clear(); [ui_ reloadRows]; return; }
      input_text = base::UTF8ToUTF16(canonical->spec());
    }
    if (input_text.empty()) {
      autocomplete_->Stop(AutocompleteStopReason::kClobbered);
      saved_matches_.clear();
      rows_ = SavedMatches({}, kMaxRows);
      [ui_ reloadRows];
      return;
    }
    saved_matches_ = SavedMatches(base::SysNSStringToUTF16(text), 3);
    AutocompleteInput input(input_text, metrics::OmniboxEventProto::OTHER,
                            ChromeAutocompleteSchemeClassifier(profile_));
    input.set_prevent_inline_autocomplete(true);
    // Local suggestions and the configured search engine's verbatim result are
    // enough here. Do not start remote suggest requests from the global panel.
    input.set_omit_asynchronous_matches(true);
    autocomplete_->Start(input);
    OnResultChanged(autocomplete_.get(), true);
  }
  void OnResultChanged(AutocompleteController* controller, bool) override {
    if (!ui_ || !ui_.panel.visible || controller != autocomplete_.get()) return;
    rows_ = saved_matches_;
    std::set<std::string> seen;
    for (const auto& row : rows_) seen.insert(row.url.spec());
    for (const auto& match : controller->result()) {
      if (!CanOpen(match.destination_url) || match.post_content ||
          !seen.insert(match.destination_url.spec()).second) continue;
      SearchRow row{match.destination_url, match.contents, match.description,
                    AutocompleteMatch::IsSearchType(match.type)};
      if (row.title.empty()) row.title = base::UTF8ToUTF16(row.url.spec());
      if (row.detail.empty() && !row.search) row.detail = base::UTF8ToUTF16(row.url.host());
      rows_.push_back(std::move(row));
      if (rows_.size() == kMaxRows) break;
    }
    [ui_ reloadRows];
  }
  size_t RowCount() const { return rows_.size(); }
  const SearchRow* Row(NSInteger index) const {
    return index < 0 || static_cast<size_t>(index) >= rows_.size() ? nullptr : &rows_[index];
  }
  void Accept(NSInteger index) {
    const auto* row = Row(index);
    auto* browser = panel_browser_.get();
    // A different window/Profile becoming current cannot redirect a visible
    // panel's results into that account environment.
    if (!row) return;
    if (!browser || browser->IsDeleteScheduled() || browser->GetProfile() != profile_ ||
        !SpaceNavigationView::From(browser) || SpaceNavigationView::From(browser)->active_space_id() != panel_space_) { Hide(); return; }
    const GURL url = row->url;
    if (!CanOpen(url)) return;
    Hide(false);
    NavigateParams params(browser, url, ui::PAGE_TRANSITION_TYPED);
    params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
    params.window_action = NavigateParams::WindowAction::kShowWindow;
    Navigate(&params);
    browser->GetWindow()->Show();
    browser->GetWindow()->Activate();
  }
 private:
  base::WeakPtr<BrowserWindowInterface> last_browser_;
  base::WeakPtr<BrowserWindowInterface> panel_browser_;
  std::string panel_space_;
  raw_ptr<Profile> profile_ = nullptr;
  base::ScopedObservation<Profile, ProfileObserver> profile_observer_{this};
  std::unique_ptr<AutocompleteController> autocomplete_;
  TaiSearchUI* __strong ui_ = nil;
  std::vector<SearchRow> rows_;
  std::vector<SearchRow> saved_matches_;
  std::string binding_;
  std::string status_ = "unassigned";
  std::optional<ui::Accelerator> accelerator_;
  bool attempted_ = false;
  bool registered_ = false;
  bool capturing_ = false;
  bool hiding_ = false;
  base::OneShotTimer capture_timer_;
};

bool UpdateGlobalSearch(BrowserWindowInterface* browser, std::string_view binding) {
  return GlobalSearchController::Get().Update(browser, binding);
}
bool GlobalSearchRegistered() { return GlobalSearchController::Get().registered(); }
bool CheckGlobalSearchInitialization() {
  TaiSearchUI* view = [[TaiSearchUI alloc] init];
  const bool ready = view.panel && view.search && view.table && view.closeButton &&
      [view numberOfRowsInTableView:view.table] == 0;
  [view.panel close];
  return ready;
}
std::string_view GlobalSearchStatus() { return GlobalSearchController::Get().status(); }
void ForgetGlobalSearchWindow(BrowserWindowInterface* browser) { GlobalSearchController::Get().Forget(browser); }
void ShowGlobalSearch(BrowserWindowInterface* browser) { GlobalSearchController::Get().Show(browser); }
void SetGlobalSearchCapture(bool capture) { GlobalSearchController::Get().Capture(capture); }
}  // namespace sidebar

@implementation TaiSearchPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return YES; }
@end

@implementation TaiSearchRow
- (void)drawSelectionInRect:(NSRect)dirtyRect {
  NSColor* color = [NSColor colorWithCalibratedRed:0.43 green:0.40 blue:0.83 alpha:0.18];
  [color setFill];
  [[NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 2, 3)
                                 xRadius:11 yRadius:11] fill];
}
@end

@implementation TaiSearchUI
@synthesize owner = _owner;
@synthesize panel = _panel;
@synthesize search = _search;
@synthesize table = _table;
@synthesize scroll = _scroll;
@synthesize context = _context;
@synthesize closeButton = _closeButton;
@synthesize previousApp = _previousApp;
@synthesize presenting = _presenting;
- (instancetype)init {
  self = [super init];
  if (!self) return nil;
  _panel = [[TaiSearchPanel alloc] initWithContentRect:NSMakeRect(0, 0, 660, 120)
      styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
        backing:NSBackingStoreBuffered defer:NO];
  _panel.delegate = self;
  _panel.level = NSFloatingWindowLevel;
  _panel.opaque = NO;
  _panel.backgroundColor = NSColor.clearColor;
  _panel.hasShadow = YES;
  _panel.hidesOnDeactivate = NO;
  _panel.releasedWhenClosed = NO;
  _panel.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace |
      NSWindowCollectionBehaviorFullScreenAuxiliary;
  _panel.title = @"TAi Search";
  [_panel setAccessibilityLabel:@"TAi Search"];
  NSVisualEffectView* surface = [[NSVisualEffectView alloc] initWithFrame:_panel.contentView.bounds];
  surface.material = NSVisualEffectMaterialPopover;
  surface.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  surface.state = NSVisualEffectStateActive;
  surface.wantsLayer = YES;
  surface.layer.cornerRadius = 22;
  surface.layer.masksToBounds = YES;
  // The native backdrop and window shadow are not clipped by CALayer's corner
  // radius. AppKit's material mask also shapes those surfaces at the compositor.
  NSImage* mask = [NSImage imageWithSize:NSMakeSize(45, 45) flipped:NO
      drawingHandler:^BOOL(NSRect rect) {
        [NSColor.blackColor setFill];
        [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:22 yRadius:22] fill];
        return YES;
      }];
  mask.capInsets = NSEdgeInsetsMake(22, 22, 22, 22);
  mask.resizingMode = NSImageResizingModeStretch;
  surface.maskImage = mask;
  _panel.contentView = surface;
  NSImageView* icon = [[NSImageView alloc] initWithFrame:NSMakeRect(24, 72, 24, 24)];
  icon.image = [NSImage imageWithSystemSymbolName:@"magnifyingglass" accessibilityDescription:nil];
  icon.contentTintColor = NSColor.secondaryLabelColor;
  icon.autoresizingMask = NSViewMinYMargin;
  [surface addSubview:icon];
  _search = [[NSSearchField alloc] initWithFrame:NSMakeRect(62, 62, 526, 42)];
  _search.font = [NSFont systemFontOfSize:23 weight:NSFontWeightMedium];
  _search.bordered = NO;
  _search.drawsBackground = NO;
  _search.focusRingType = NSFocusRingTypeNone;
  _search.autoresizingMask = NSViewMinYMargin | NSViewWidthSizable;
  _search.delegate = self;
  _search.sendsSearchStringImmediately = YES;
  [(NSSearchFieldCell*)_search.cell setSearchButtonCell:nil];
  [(NSSearchFieldCell*)_search.cell setCancelButtonCell:nil];
  [surface addSubview:_search];
  NSButton* close = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"xmark" accessibilityDescription:nil]
                                      target:self action:@selector(closePalette:)];
  close.frame = NSMakeRect(605, 72, 24, 24);
  close.bordered = NO;
  close.contentTintColor = NSColor.secondaryLabelColor;
  close.autoresizingMask = NSViewMinYMargin | NSViewMinXMargin;
  self.closeButton = close;
  [surface addSubview:close];
  NSBox* line = [[NSBox alloc] initWithFrame:NSMakeRect(22, 52, 616, 1)];
  line.boxType = NSBoxSeparator;
  line.autoresizingMask = NSViewMinYMargin | NSViewWidthSizable;
  [surface addSubview:line];
  _context = [NSTextField labelWithString:@""];
  _context.frame = NSMakeRect(24, 8, 612, 22);
  _context.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
  _context.textColor = NSColor.secondaryLabelColor;
  _context.lineBreakMode = NSLineBreakByTruncatingTail;
  _context.autoresizingMask = NSViewWidthSizable;
  [surface addSubview:_context];
  _table = [[NSTableView alloc] initWithFrame:NSMakeRect(0, 0, 616, 0)];
  _table.headerView = nil;
  _table.backgroundColor = NSColor.clearColor;
  // Automatic/inset table styles add vertical padding on recent macOS, which
  // clips a single suggestion and shows a scrollbar in an exactly sized list.
  _table.style = NSTableViewStylePlain;
  _table.usesAutomaticRowHeights = NO;
  _table.rowHeight = 59;
  _table.intercellSpacing = NSMakeSize(0, 0);
  _table.focusRingType = NSFocusRingTypeNone;
  _table.selectionHighlightStyle = NSTableViewSelectionHighlightStyleRegular;
  _table.allowsEmptySelection = YES;
  _table.delegate = self;
  _table.dataSource = self;
  _table.target = self;
  _table.action = @selector(openSelection:);
  NSTableColumn* column = [[NSTableColumn alloc] initWithIdentifier:@"suggestion"];
  column.width = 616;
  column.resizingMask = NSTableColumnAutoresizingMask;
  [_table addTableColumn:column];
  _table.columnAutoresizingStyle = NSTableViewLastColumnOnlyAutoresizingStyle;
  _scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(20, 32, 620, 0)];
  _scroll.documentView = _table;
  _scroll.drawsBackground = NO;
  _scroll.borderType = NSNoBorder;
  _scroll.automaticallyAdjustsContentInsets = NO;
  _scroll.contentInsets = NSEdgeInsetsMake(0, 0, 0, 0);
  _scroll.hasVerticalScroller = YES;
  _scroll.autohidesScrollers = YES;
  _scroll.scrollerStyle = NSScrollerStyleOverlay;
  _scroll.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [surface addSubview:_scroll];
  return self;
}
- (void)showWithPlaceholder:(NSString*)placeholder context:(NSString*)context closeLabel:(NSString*)closeLabel {
  self.presenting = YES;
  NSRunningApplication* previous = NSWorkspace.sharedWorkspace.frontmostApplication;
  self.previousApp = previous.processIdentifier != NSRunningApplication.currentApplication.processIdentifier ? previous : nil;
  [self.closeButton setAccessibilityLabel:closeLabel];
  self.search.placeholderString = placeholder;
  [self.search setAccessibilityLabel:placeholder];
  self.search.stringValue = @"";
  [self.table reloadData];
  self.context.stringValue = context;
  NSPoint mouse = NSEvent.mouseLocation;
  NSScreen* screen = NSScreen.mainScreen;
  for (NSScreen* candidate in NSScreen.screens) {
    if (NSPointInRect(mouse, candidate.frame)) { screen = candidate; break; }
  }
  NSRect visible = screen.visibleFrame;
  CGFloat width = std::min<CGFloat>(660, visible.size.width - 48);
  [self.panel setFrame:NSMakeRect(NSMidX(visible) - width / 2,
      NSMaxY(visible) - visible.size.height * 0.24 - 120, width, 120) display:NO];
  [self.panel makeKeyAndOrderFront:nil];
  [self.panel makeMainWindow];
  // The palette owns keyboard input while visible. Activate only this key
  // window, not all browser windows, then reassert it after app activation.
  [NSApp activateIgnoringOtherApps:YES];
  [self.panel makeKeyAndOrderFront:nil];
  [self.panel makeMainWindow];
  [self.panel makeFirstResponder:self.search];
  self.presenting = NO;
}
- (void)reloadRows {
  [self.table reloadData];
  NSInteger count = static_cast<NSInteger>(self.owner->RowCount());
  CGFloat height = 120 + count * 59;
  NSRect frame = self.panel.frame;
  frame.origin.y -= height - frame.size.height;
  frame.size.height = height;
  [self.panel setFrame:frame display:YES];
  [self.panel invalidateShadow];
  if (count) [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
}
- (void)hideRestoringPreviousApp:(BOOL)restore {
  const BOOL returnFocus = restore && self.panel.isKeyWindow && self.previousApp && NSApp.isActive;
  NSRunningApplication* previous = self.previousApp;
  self.previousApp = nil;
  [self.panel orderOut:nil];
  if (returnFocus && !previous.terminated)
    [previous activateWithOptions:NSApplicationActivateIgnoringOtherApps];
}
- (void)closePalette:(id)sender { self.owner->Hide(); }
- (void)windowDidResignKey:(NSNotification*)notification {
  if (self.panel.visible && !self.presenting) self.owner->Hide(false);
}
- (void)controlTextDidChange:(NSNotification*)notification { self.owner->Query(self.search.stringValue); }
- (BOOL)control:(NSControl*)control textView:(NSTextView*)view doCommandBySelector:(SEL)selector {
  if (selector == @selector(cancelOperation:)) { self.owner->Hide(); return YES; }
  if (selector == @selector(insertNewline:)) { self.owner->Accept(self.table.selectedRow); return YES; }
  if (selector == @selector(moveDown:) || selector == @selector(moveUp:)) {
    NSInteger count = static_cast<NSInteger>(self.owner->RowCount());
    if (!count) return YES;
    NSInteger current = self.table.selectedRow;
    NSInteger next = current + (selector == @selector(moveDown:) ? 1 : -1);
    if (current < 0) next = 0;
    next = (next + count) % count;
    [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:next] byExtendingSelection:NO];
    [self.table scrollRowToVisible:next];
    return YES;
  }
  return NO;
}
- (NSInteger)numberOfRowsInTableView:(NSTableView*)tableView {
  return self.owner ? static_cast<NSInteger>(self.owner->RowCount()) : 0;
}
- (NSTableRowView*)tableView:(NSTableView*)tableView rowViewForRow:(NSInteger)row {
  return [[TaiSearchRow alloc] initWithFrame:NSZeroRect];
}
- (NSView*)tableView:(NSTableView*)tableView viewForTableColumn:(NSTableColumn*)column row:(NSInteger)row {
  const auto* entry = self.owner->Row(row);
  if (!entry) return nil;
  NSView* view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, tableView.bounds.size.width, 59)];
  NSImageView* icon = [[NSImageView alloc] initWithFrame:NSMakeRect(14, 19, 21, 21)];
  icon.image = [NSImage imageWithSystemSymbolName:entry->search ? @"magnifyingglass" : @"globe"
                      accessibilityDescription:nil];
  icon.contentTintColor = [NSColor colorWithCalibratedRed:0.45 green:0.43 blue:0.72 alpha:1];
  [view addSubview:icon];
  NSTextField* title = [NSTextField labelWithString:base::SysUTF16ToNSString(entry->title)];
  title.frame = NSMakeRect(48, 28, tableView.bounds.size.width - 64, 23);
  title.font = [NSFont systemFontOfSize:16 weight:NSFontWeightMedium];
  title.lineBreakMode = NSLineBreakByTruncatingTail;
  title.autoresizingMask = NSViewWidthSizable;
  [view addSubview:title];
  NSTextField* detail = [NSTextField labelWithString:base::SysUTF16ToNSString(entry->detail)];
  detail.frame = NSMakeRect(48, 8, tableView.bounds.size.width - 64, 19);
  detail.font = [NSFont systemFontOfSize:12];
  detail.textColor = NSColor.secondaryLabelColor;
  detail.lineBreakMode = NSLineBreakByTruncatingTail;
  detail.autoresizingMask = NSViewWidthSizable;
  [view addSubview:detail];
  return view;
}
- (void)openSelection:(id)sender { self.owner->Accept(self.table.clickedRow); }
@end
