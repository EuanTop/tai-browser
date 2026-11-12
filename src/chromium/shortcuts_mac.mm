// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/shortcuts_mac.h"

#import <AppKit/AppKit.h>
#include <Carbon/Carbon.h>
#include <CoreGraphics/CGEventSource.h>

#include "base/memory/weak_ptr.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/thread_pool.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "sidebar_browser/branding.h"
#include "sidebar_browser/localization.h"
#include "sidebar_browser/shortcuts.h"
#include "sidebar_browser/space_navigation_view.h"
#include "sidebar_browser/workspace_state.h"
#include "ui/base/accelerators/platform_accelerator_cocoa.h"
#include "ui/base/l10n/l10n_util_mac.h"
#include "ui/base/resource/data_pack.h"
#include "ui/base/resource/resource_bundle.h"
#include "ui/events/keycodes/keyboard_code_conversion_mac.h"
#include "ui/views/widget/widget.h"

namespace {
struct SpaceSymbol {
  const char* name;
  std::string_view chinese;
  std::string_view english;
};
constexpr SpaceSymbol kSpaceSymbols[] = {
    {"", "无图标", "No Icon"},
    {"house", "主页", "Home"},
    {"folder", "文件夹", "Folder"},
    {"briefcase", "工作", "Work"},
    {"book.closed", "阅读", "Reading"},
    {"graduationcap", "学习", "Study"},
    {"chevron.left.forwardslash.chevron.right", "代码", "Code"},
    {"paintpalette", "创作", "Art"},
    {"globe", "网页", "Web"},
    {"music.note", "音乐", "Music"},
    {"star", "星标", "Star"},
};
NSImage* SpaceSymbolImage(const char* name) {
  if (!*name) return nil;
  auto* image = [NSImage imageWithSystemSymbolName:base::SysUTF8ToNSString(name)
                          accessibilityDescription:nil];
  [image setTemplate:YES];
  return image;
}
}  // namespace

@interface TaiSpacesMenuController : NSObject <NSMenuDelegate>
- (void)setBrowser:(BrowserWindowInterface*)browser;
- (BrowserWindowInterface*)activeBrowser;
@end

@implementation TaiSpacesMenuController {
  base::WeakPtr<BrowserWindowInterface> _browser;
  base::WeakPtr<BrowserWindowInterface> _menuBrowser;
}

- (BrowserWindowInterface*)activeBrowser {
  if (!_browser) return nullptr;
  auto* view = BrowserView::GetBrowserViewForBrowser(_browser.get());
  return view && view->GetWidget() && view->GetWidget()->IsActive()
             ? _browser.get()
             : nullptr;
}

- (void)setBrowser:(BrowserWindowInterface*)browser {
  _browser = browser ? browser->GetWeakPtr() : nullptr;
}

- (void)runAction:(NSMenuItem*)item {
  if (auto* navigation = sidebar::SpaceNavigationView::From(_menuBrowser.get())) {
    navigation->PerformShortcut(base::SysNSStringToUTF8(item.representedObject));
  }
}

- (void)selectSpace:(NSMenuItem*)item {
  auto* browser = _menuBrowser.get();
  auto* navigation = sidebar::SpaceNavigationView::From(browser);
  if (!navigation) return;
  const auto& spaces = sidebar::WorkspaceState::ForProfile(browser->GetProfile())
                           ->model().spaces();
  const auto id = base::SysNSStringToUTF8(item.representedObject);
  for (size_t i = 0; i < spaces.size(); ++i) {
    if (spaces[i].id == id) {
      navigation->PerformShortcut("space_" + std::to_string(i + 1));
      return;
    }
  }
}

- (void)setSpaceIcon:(NSMenuItem*)item {
  auto* browser = _menuBrowser.get();
  auto* navigation = sidebar::SpaceNavigationView::From(browser);
  if (!navigation) return;
  sidebar::WorkspaceState::ForProfile(browser->GetProfile())->SetSpaceMenuIcon(
      navigation->active_space_id(), base::SysNSStringToUTF8(item.representedObject));
}

- (void)menuNeedsUpdate:(NSMenu*)menu {
  [menu removeAllItems];
  auto* browser = [self activeBrowser];
  // Menu tracking can temporarily make the browser lose key-window status.
  // Dispatch against the same window whose Spaces the menu displayed.
  _menuBrowser = browser ? browser->GetWeakPtr() : nullptr;
  auto* profile = browser ? browser->GetProfile() : nullptr;
  auto* workspace = profile ? sidebar::WorkspaceState::ForProfile(profile) : nullptr;
  auto* navigation = sidebar::SpaceNavigationView::From(browser);
  const bool ready = navigation && workspace && workspace->loaded();
  auto add = [&](std::string_view zh, std::string_view en, NSString* action,
                 bool enabled) {
    auto* item = [[NSMenuItem alloc]
        initWithTitle:base::SysUTF8ToNSString(sidebar::LocalizedText(profile, zh, en))
               action:@selector(runAction:)
        keyEquivalent:@""];
    item.target = self;
    item.representedObject = action;
    item.enabled = enabled;
    [menu addItem:item];
  };
  const bool multiple = ready && workspace->model().spaces().size() > 1;
  add("新建 Space", "New Space", @"new_space", ready);
  add("上一个 Space", "Previous Space", @"previous_space", multiple);
  add("下一个 Space", "Next Space", @"next_space", multiple);
  if (!ready || workspace->model().spaces().empty()) return;

  [menu addItem:[NSMenuItem separatorItem]];
  for (const auto& space : workspace->model().spaces()) {
    const auto title = space.icon.empty() ? space.name : space.icon + "  " + space.name;
    auto* item = [[NSMenuItem alloc] initWithTitle:base::SysUTF8ToNSString(title)
                                          action:@selector(selectSpace:)
                                   keyEquivalent:@""];
    item.target = self;
    item.representedObject = base::SysUTF8ToNSString(space.id);
    item.state = space.id == navigation->active_space_id() ? NSControlStateValueOn
                                                            : NSControlStateValueOff;
    const auto chosen = workspace->SpaceMenuIcon(space.id);
    for (const auto& symbol : kSpaceSymbols) {
      if (chosen == symbol.name) {
        item.image = SpaceSymbolImage(symbol.name);
        break;
      }
    }
    [menu addItem:item];
  }

  const auto& active_id = navigation->active_space_id();
  if (workspace->load_error() || !workspace->model().FindSpace(active_id)) return;
  [menu addItem:[NSMenuItem separatorItem]];
  NSString* title = base::SysUTF8ToNSString(
      sidebar::LocalizedText(profile, "当前 Space 的菜单图标", "Current Space Menu Icon"));
  auto* icon_picker = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  icon_picker.submenu = [[NSMenu alloc] initWithTitle:title];
  const auto chosen = workspace->SpaceMenuIcon(active_id);
  for (const auto& symbol : kSpaceSymbols) {
    auto* item = [[NSMenuItem alloc]
        initWithTitle:base::SysUTF8ToNSString(
                          sidebar::LocalizedText(profile, symbol.chinese, symbol.english))
               action:@selector(setSpaceIcon:)
        keyEquivalent:@""];
    item.target = self;
    item.representedObject = base::SysUTF8ToNSString(symbol.name);
    item.image = SpaceSymbolImage(symbol.name);
    item.state = chosen == symbol.name ? NSControlStateValueOn : NSControlStateValueOff;
    [icon_picker.submenu addItem:item];
  }
  [menu addItem:icon_picker];
}
@end

namespace sidebar {
namespace {
TaiSpacesMenuController* SpacesMenuController() {
  static TaiSpacesMenuController* controller = [[TaiSpacesMenuController alloc] init];
  return controller;
}

NSString* SpacesMenuTitle(Profile* profile) {
  return base::SysUTF8ToNSString(LocalizedText(profile, "空间", "Spaces"));
}
// Weak keys avoid retaining dynamic/replaced menu items. The values preserve
// the original hints and title for a non-TAi window in the same application.
NSMapTable<NSMenuItem*, NSDictionary*>* OriginalItems() {
  static NSMapTable<NSMenuItem*, NSDictionary*>* originals =
      [NSMapTable weakToStrongObjectsMapTable];
  return originals;
}
NSMapTable<NSMenuItem*, NSMutableDictionary*>* MenuLabels() {
  static NSMapTable<NSMenuItem*, NSMutableDictionary*>* labels =
      [NSMapTable weakToStrongObjectsMapTable];
  return labels;
}

std::unique_ptr<ui::DataPack> LoadMenuLocale(std::string_view locale) {
  auto pack = std::make_unique<ui::DataPack>(ui::kScaleFactorNone);
  if (!pack->LoadFromPath(ui::ResourceBundle::GetLocaleFilePath(locale))) return nullptr;
  return pack;
}

struct MenuLocalePacks {
  std::unique_ptr<ui::DataPack> english;
  std::unique_ptr<ui::DataPack> chinese;
};

MenuLocalePacks& Locales() {
  static base::NoDestructor<MenuLocalePacks> packs;
  return *packs;
}

void PrepareMenuLocales() {
  static bool requested = false;
  if (requested) return;
  requested = true;
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
      base::BindOnce([] {
        return MenuLocalePacks{LoadMenuLocale("en-US"), LoadMenuLocale("zh-CN")};
      }),
      base::BindOnce([](MenuLocalePacks packs) {
        Locales() = std::move(packs);
        if (auto* active = [SpacesMenuController() activeBrowser])
          UpdateShortcutMenu(active);
      }));
}

NSString* LocalizedMenuLabel(NSMenuItem* item, std::string_view language) {
  NSMutableDictionary* label = [MenuLabels() objectForKey:item];
  if (!label) return nil;
  const bool chinese_locale = language == "zh-CN";
  NSString* key = chinese_locale ? @"zh-CN" : @"en";
  if (NSString* cached = label[key]) return cached;
  const auto* pack = chinese_locale ? Locales().chinese.get() : Locales().english.get();
  if (!pack) return nil;
  const auto data = pack->GetStringView([label[@"id"] unsignedShortValue]);
  if (!data) return nil;
  std::u16string title;
  if (pack->GetTextEncodingType() == ui::ResourceHandle::UTF8) {
    title = base::UTF8ToUTF16(*data);
  } else if (pack->GetTextEncodingType() == ui::ResourceHandle::UTF16) {
    title = base::SysNSStringToUTF16([[NSString alloc]
        initWithBytes:data->data() length:data->size()
             encoding:NSUTF16LittleEndianStringEncoding]);
  }
  if (title.empty()) return nil;
  if ([label[@"argument"] length])
    title = base::ReplaceStringPlaceholders(
        title, base::SysNSStringToUTF16(label[@"argument"]), nullptr);
  NSString* localized = l10n_util::FixUpWindowsStyleLabel(title);
  label[key] = localized;
  return localized;
}

int CommandForItem(NSMenuItem* item) {
  if (item.tag > 0) return static_cast<int>(item.tag);
  // Chromium's Close Window menu uses a Cocoa selector instead of a tag.
  if (item.action == @selector(performClose:)) return IDC_CLOSE_WINDOW;
  if (item.action == @selector(toggleFullScreen:)) return IDC_FULLSCREEN;
  return 0;
}

void UpdateDockIcon(Profile* profile) {
  const auto* workspace = WorkspaceState::ForProfile(profile);
  if (!workspace->loaded()) return;
  static bool pride_applied = false;
  const bool pride = workspace->edition() == "pride";
  if (pride == pride_applied) return;
  if (!pride) {
    [NSApp setApplicationIconImage:nil];
    pride_applied = false;
    return;
  }
  static NSImage* const pride_icon = []() -> NSImage* {
    std::string bytes;
    if (!base::Base64Decode(brand_resources::kPrideIcon, &bytes)) return nil;
    return [[NSImage alloc]
        initWithData:[NSData dataWithBytes:bytes.data() length:bytes.size()]];
  }();
  if (pride_icon) {
    [NSApp setApplicationIconImage:pride_icon];
    pride_applied = true;
  }
}

void UpdateItems(NSMenu* menu, BrowserWindowInterface* browser,
                 std::string_view language) {
  for (NSMenuItem* item in menu.itemArray) {
    if (item.submenu.delegate == SpacesMenuController()) {
      item.title = SpacesMenuTitle(browser ? browser->GetProfile() : nullptr);
      item.submenu.title = item.title;
    } else if (item.submenu) {
      UpdateItems(item.submenu, browser, language);
    }
    const int command = CommandForItem(item);
    ui::Accelerator accelerator;
    const bool managed = command > 0 && browser &&
        GetManagedShortcutForCommand(browser, command, &accelerator);
    NSString* title = browser ? LocalizedMenuLabel(item, language) : nil;
    if (browser) {
      const auto localize = [browser](std::string_view zh, std::string_view en) {
        return base::SysUTF8ToNSString(LocalizedText(browser->GetProfile(), zh, en));
      };
      if (command == IDC_OPTIONS) title = localize("TAi 设置…", "TAi Settings…");
      if (command == IDC_ABOUT && item.action == @selector(orderFrontStandardAboutPanel:))
        title = localize("关于 TAi Browser", "About TAi Browser");
      if (command == IDC_IMPORT_SETTINGS)
        title = localize("从其他浏览器导入…", "Import from Another Browser…");
      if (command == IDC_TOGGLE_VERTICAL_TABS_COLLAPSE)
        title = localize("显示或隐藏侧栏", "Show or Hide Sidebar");
    }
    if (command == IDC_HELP_PAGE_VIA_MENU && HasTaiBrand()) {
      title = base::SysUTF8ToNSString(LocalizedText(
          browser ? browser->GetProfile() : nullptr,
          "TAi Browser 帮助", "TAi Browser Help"));
    }
    NSDictionary* original = [OriginalItems() objectForKey:item];
    if (!managed && !title) {
      if (original) {
        item.keyEquivalent = original[@"key"];
        item.keyEquivalentModifierMask = [original[@"modifiers"] unsignedIntegerValue];
        item.title = original[@"title"];
        if (item.submenu) item.submenu.title = item.title;
        [OriginalItems() removeObjectForKey:item];
      }
      continue;
    }
    if (!original) {
      [OriginalItems() setObject:@{@"key":item.keyEquivalent,
          @"modifiers":@(item.keyEquivalentModifierMask), @"title":item.title}
                         forKey:item];
    }
    if (title && ![item.title isEqualToString:title]) {
      item.title = title;
      if (item.submenu) item.submenu.title = title;
    }
    if (!managed) continue;
    if (accelerator.key_code() == ui::VKEY_UNKNOWN ||
        (command == IDC_FULLSCREEN && item.alternate)) {
      item.keyEquivalent = @"";
      item.keyEquivalentModifierMask = 0;
    } else {
      KeyEquivalentAndModifierMask* equivalent =
          ui::GetKeyEquivalentAndModifierMaskFromAccelerator(accelerator);
      item.keyEquivalent = equivalent.keyEquivalent;
      item.keyEquivalentModifierMask = equivalent.modifierMask;
    }
  }
}
}  // namespace

ui::KeyboardCode GlobalSearchKeyCode(unsigned short native_code) {
  const auto [character, dead] = ui::NsKeyCodeAndModifiersToCharacter(native_code, 0);
  const auto code = !dead ? ui::KeyboardCodeFromCharCode(character) : ui::VKEY_UNKNOWN;
  return code == ui::VKEY_UNKNOWN ? ui::KeyboardCodeFromKeyCode(native_code) : code;
}
bool ShortcutModifierIsDown(int modifier) {
  // Query only the held MRU modifier while this browser window is active.
  // This also covers accessibility key equivalents that omit flagsChanged.
  auto down = [](CGKeyCode code) {
    return CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, code);
  };
  if (modifier == ui::EF_CONTROL_DOWN) return down(kVK_Control) || down(kVK_RightControl);
  if (modifier == ui::EF_COMMAND_DOWN) return down(kVK_Command) || down(kVK_RightCommand);
  if (modifier == ui::EF_ALT_DOWN) return down(kVK_Option) || down(kVK_RightOption);
  return false;
}
NSMenuItem* BuildTaiSpacesMenu() {
  NSString* title = SpacesMenuTitle(nullptr);
  auto* item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  item.submenu = [[NSMenu alloc] initWithTitle:title];
  item.submenu.autoenablesItems = NO;
  item.submenu.delegate = SpacesMenuController();
  [SpacesMenuController() menuNeedsUpdate:item.submenu];
  return item;
}

void RegisterTaiMenuLabel(NSMenuItem* item, int resource_id,
                          const std::u16string& format_argument) {
  if (resource_id && HasTaiBrand()) {
    NSDictionary* current = [MenuLabels() objectForKey:item];
    if ([current[@"id"] intValue] == resource_id &&
        base::SysNSStringToUTF16(current[@"argument"]) == format_argument) {
      return;
    }
    [MenuLabels() setObject:[@{@"id": @(resource_id),
                              @"argument": base::SysUTF16ToNSString(format_argument)}
                             mutableCopy]
                     forKey:item];
  }
}

NSString* TaiDynamicMenuLabel(NSMenuItem* item, int resource_id) {
  auto* browser = [SpacesMenuController() activeBrowser];
  if (!browser) return nil;
  RegisterTaiMenuLabel(item, resource_id, {});
  return LocalizedMenuLabel(
      item, WorkspaceState::ForProfile(browser->GetProfile())->language());
}

void UpdateShortcutMenu(BrowserWindowInterface* browser) {
  if (browser) {
    auto* view = BrowserView::GetBrowserViewForBrowser(browser);
    // An inactive Profile must never replace the active window's global menu.
    if (!view || !view->GetWidget() || !view->GetWidget()->IsActive()) return;
    if (!SpaceNavigationView::From(browser)) browser = nullptr;
  }
  if (browser) {
    UpdateDockIcon(browser->GetProfile());
    PrepareMenuLocales();
  }
  [SpacesMenuController() setBrowser:browser];
  const std::string language = browser
      ? WorkspaceState::ForProfile(browser->GetProfile())->language() : "";
  if (NSApp.mainMenu) UpdateItems(NSApp.mainMenu, browser, language);
}
}  // namespace sidebar
