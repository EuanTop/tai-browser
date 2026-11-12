// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/shortcuts.h"

#include <algorithm>
#include <array>
#include <map>
#include <vector>

#include "base/strings/string_number_conversions.h"
#include "base/no_destructor.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/supports_user_data.h"
#include "base/time/time.h"
#include "build/build_config.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/ui/accelerator_table.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#if BUILDFLAG(IS_MAC)
#include "chrome/browser/global_keyboard_shortcuts_mac.h"
#include "sidebar_browser/global_search_mac.h"
#endif
#include "content/public/browser/web_contents.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "sidebar_browser/space_navigation_view.h"
#include "sidebar_browser/workspace_state.h"
#include "ui/base/accelerators/command.h"

namespace sidebar {
namespace {
struct Action {
  std::string id, zh, en, group, binding;
  int command = 0;
  std::vector<std::string> aliases;
};

const std::vector<Action>& Actions() {
  static const base::NoDestructor<std::vector<Action>> actions([] {
    std::vector<Action> result = {
      {"toggle_sidebar", "显示或隐藏侧栏", "Show or hide sidebar", "organization", "Command+S", IDC_TOGGLE_VERTICAL_TABS_COLLAPSE},
      {"global_search", "全局搜索浮层", "Global search", "browser", "Alt+Command+N"},
      {"settings", "TAi 设置", "TAi settings", "browser", "Command+Comma", IDC_OPTIONS},
      {"copy_url", "复制网页地址", "Copy URL", "navigation", "Command+Shift+C"},
      {"copy_markdown", "复制 Markdown 链接", "Copy URL as Markdown", "navigation", "Alt+Command+Shift+C"},
      {"clear_temporaries", "清理当前 Space 的临时标签", "Clear temporary tabs in this Space", "organization", "Command+Shift+K"},
      {"new_space", "新建 Space", "New Space", "organization", ""},
      {"next_space", "下一个 Space", "Next Space", "organization", ""},
      {"previous_space", "上一个 Space", "Previous Space", "organization", ""},
      {"new_folder", "新建文件夹", "New folder", "organization", ""},
      {"pin_tab", "收藏当前标签", "Pin current tab", "organization", "Command+D"},
      {"favorite_tab", "添加到常用网站", "Add to favorites", "organization", ""},
      {"new_tab", "新建标签", "New tab", "navigation", "Command+T", IDC_NEW_TAB},
      {"close_tab", "关闭当前标签", "Close current tab", "navigation", "Command+W", IDC_CLOSE_TAB},
      {"restore_tab", "恢复最近关闭的标签", "Reopen last closed tab", "navigation", "Command+Shift+T", IDC_RESTORE_TAB},
      {"next_tab", "下一个标签", "Next tab", "navigation", "Alt+Command+Right", IDC_SELECT_NEXT_TAB, { "Command+Shift+BracketRight", "Ctrl+PageDown"}},
      {"previous_tab", "上一个标签", "Previous tab", "navigation", "Alt+Command+Left", IDC_SELECT_PREVIOUS_TAB, { "Command+Shift+BracketLeft", "Ctrl+PageUp"}},
      {"recent_tab", "最近使用的标签", "Recently used tab", "navigation", "Ctrl+Tab"},
      {"previous_recent_tab", "反向切换最近使用标签", "Previous recently used tab", "navigation", "Ctrl+Shift+Tab"},
      {"focus_location", "搜索或输入网址", "Search or enter a URL", "navigation", "Command+L", IDC_FOCUS_LOCATION},
      {"back", "后退", "Go back", "navigation", "Command+BracketLeft", IDC_BACK, {"Command+Left"}},
      {"forward", "前进", "Go forward", "navigation", "Command+BracketRight", IDC_FORWARD, {"Command+Right"}},
      {"reload", "刷新", "Reload", "navigation", "Command+R", IDC_RELOAD},
      {"hard_reload", "忽略缓存刷新", "Reload ignoring cache", "navigation", "Command+Shift+R", IDC_RELOAD_BYPASSING_CACHE},
      {"save_page", "网页另存为", "Save page as", "browser", "Command+Shift+S", IDC_SAVE_PAGE},
      {"find", "在网页中查找", "Find in page", "navigation", "Command+F", IDC_FIND},
      {"find_next", "查找下一个", "Find next", "navigation", "Command+G", IDC_FIND_NEXT},
      {"find_previous", "查找上一个", "Find previous", "navigation", "Command+Shift+G", IDC_FIND_PREVIOUS},
      {"history", "历史记录", "History", "browser", "Command+Y", IDC_SHOW_HISTORY},
      {"downloads", "下载", "Downloads", "browser", "Command+Shift+J", IDC_SHOW_DOWNLOADS, {"Alt+Command+L"}},
      {"devtools", "开发者工具", "Developer tools", "browser", "Alt+Command+I", IDC_DEV_TOOLS, {"F12"}},
      {"view_source", "查看网页源代码", "View page source", "browser", "Alt+Command+U", IDC_VIEW_SOURCE},
      {"fullscreen", "进入或退出全屏", "Enter or exit full screen", "browser", "Ctrl+Command+F", IDC_FULLSCREEN},
      {"zoom_in", "放大", "Zoom in", "browser", "Command+Equal", IDC_ZOOM_PLUS, {"Command+Shift+Equal"}},
      {"zoom_out", "缩小", "Zoom out", "browser", "Command+Minus", IDC_ZOOM_MINUS},
      {"zoom_reset", "实际大小", "Actual size", "browser", "Command+0", IDC_ZOOM_NORMAL},
      {"new_window", "新建窗口", "New window", "browser", "Command+N", IDC_NEW_WINDOW},
      {"close_window", "关闭窗口", "Close window", "browser", "Command+Shift+W", IDC_CLOSE_WINDOW},
    };
    for (int index = 1; index <= 9; ++index) {
      const auto number = base::NumberToString(index);
      result.push_back({"space_" + number, "前往 Space " + number,
                        "Go to Space " + number, "organization", "Ctrl+" + number});
      if (index < 9) result.push_back({"tab_" + number, "前往侧栏标签 " + number,
          "Go to sidebar tab " + number, "navigation", "Command+" + number,
          IDC_SELECT_TAB_0 + index - 1});
    }
    result.push_back({"last_tab", "前往最后一个侧栏标签", "Go to last sidebar tab",
                      "navigation", "Command+9", IDC_SELECT_LAST_TAB});
    return result;
  }());
  return *actions;
}

const Action* FindAction(std::string_view id) {
  const auto& actions = Actions();
  const auto found = std::ranges::find(actions, id, &Action::id);
  return found == actions.end() ? nullptr : &*found;
}
std::string Binding(const Action& action, const base::DictValue& overrides) {
  if (const auto* record = overrides.FindDict(action.id)) {
    if (const auto* value = record->FindString("binding")) return *value;
  }
  return action.binding;
}
std::string Priority(const Action& action, const base::DictValue& overrides) {
  if (const auto* record = overrides.FindDict(action.id)) {
    if (const auto* value = record->FindString("priority")) return *value;
  }
  return "browser";
}
bool Same(std::string_view text, const ui::Accelerator& accelerator) {
  const auto parsed = ParseShortcut(text);
  return parsed && *parsed == accelerator;
}
bool IsDefaultKey(const ui::Accelerator& accelerator) {
  for (const auto& action : Actions()) {
    if (Same(action.binding, accelerator)) return true;
    for (const auto& alias : action.aliases)
      if (Same(alias, accelerator)) return true;
  }
  return false;
}
bool IsProtectedKey(const ui::Accelerator& accelerator) {
  // Keep editing, accessibility, app switching and input-method shortcuts out
  // of browser overrides. Plain Option is used to type accented characters.
  const std::array<std::string_view, 35> reserved = {
    "Command+A", "Command+C", "Command+V", "Command+X", "Command+Z",
    "Command+Shift+Z", "Command+Shift+V", "Command+Q", "Command+H",
    "Command+M", "Command+Tab", "Command+Shift+Tab", "Command+Space",
    "Alt+Command+Space", "Alt+Command+H", "Alt+Command+M",
    "Ctrl+Command+Q", "Ctrl+Space", "Ctrl+Shift+Space", "Ctrl+Up",
    "Ctrl+Down", "Ctrl+Left", "Ctrl+Right", "Ctrl+Alt+Command+8",
    "Alt+Command+F5", "Alt+Command+C", "Ctrl+Command+Space",
    "Command+Left", "Command+Right", "Command+Up", "Command+Down",
    "Command+Shift+Left", "Command+Shift+Right", "Command+Shift+Up", "Command+Shift+Down"};
  for (const auto key : reserved) if (Same(key, accelerator)) return true;
  if (!accelerator.IsCmdDown() && !accelerator.IsCtrlDown() &&
      !(accelerator.key_code() >= ui::VKEY_F1 && accelerator.key_code() <= ui::VKEY_F12)) return true;
  if (!accelerator.IsCmdDown() && accelerator.IsCtrlDown() &&
      accelerator.key_code() >= ui::VKEY_A && accelerator.key_code() <= ui::VKEY_Z) return true;
  if (IsDefaultKey(accelerator)) return false;
  // Preserve Chromium commands outside this manager rather than silently
  // overriding Print, Open File, incognito, extension management, etc.
  const int commands[] = {IDC_OPEN_FILE, IDC_PRINT, IDC_BASIC_PRINT,
      IDC_NEW_INCOGNITO_WINDOW, IDC_SHOW_BOOKMARK_BAR,
      IDC_SHOW_BOOKMARK_MANAGER, IDC_BOOKMARK_THIS_TAB,
      IDC_DEV_TOOLS_CONSOLE, IDC_DEV_TOOLS_INSPECT, IDC_CLEAR_BROWSING_DATA,
      IDC_SHOW_AVATAR_MENU, IDC_FOCUS_TOOLBAR, IDC_FOCUS_BOOKMARKS,
      IDC_FOCUS_MENU_BAR, IDC_FOCUS_SEARCH, IDC_SHOW_APP_MENU,
      IDC_EMAIL_PAGE_LOCATION};
  for (const int command : commands) {
    ui::Accelerator original;
    if (GetAcceleratorForCommandId(command, &original) && original == accelerator)
      return true;
  }
  return false;
}

const char kCaptureKey[] = "tai-shortcut-capture";
class CaptureState final : public base::SupportsUserData::Data {
 public:
  explicit CaptureState(content::RenderFrameHost* frame)
      : document(frame->GetWeakDocumentPtr()) {}
  const content::WeakDocumentPtr document;
  const base::TimeTicks until = base::TimeTicks::Now() + base::Seconds(30);
};
bool Capturing(content::WebContents* contents) {
  if (!contents) return false;
  auto* capture = static_cast<CaptureState*>(contents->GetUserData(kCaptureKey));
  return capture && base::TimeTicks::Now() < capture->until &&
      capture->document.AsRenderFrameHostIfValid() == contents->GetPrimaryMainFrame();
}
bool IsModifiedKey(const ui::Accelerator& accelerator) {
  return accelerator.IsCmdDown() || accelerator.IsCtrlDown() ||
      (accelerator.key_code() >= ui::VKEY_F1 && accelerator.key_code() <= ui::VKEY_F12);
}

bool Execute(BrowserWindowInterface* browser, const Action& action,
             const ui::Accelerator& accelerator) {
  if (accelerator.IsRepeat() &&
      (action.id == "global_search" || action.id == "new_tab" || action.id == "new_window" ||
       action.id == "new_space" || action.id == "new_folder" ||
       action.id == "toggle_sidebar" || action.id == "clear_temporaries" ||
       action.id == "settings" || action.id == "pin_tab" ||
       action.id == "favorite_tab")) return true;
  if (action.id == "recent_tab" || action.id == "previous_recent_tab") {
    if (auto* sidebar = SpaceNavigationView::From(browser))
      sidebar->CycleRecentTab(action.id == "recent_tab" ? 1 : -1, accelerator.modifiers());
    return true;
  }
#if BUILDFLAG(IS_MAC)
  if (action.id == "global_search") { ShowGlobalSearch(browser); return true; }
#endif
  // Own organization commands keep their native browser counterparts intact.
  if (action.id == "toggle_sidebar" || action.id == "settings" || action.command == 0) {
    if (auto* sidebar = SpaceNavigationView::From(browser)) sidebar->PerformShortcut(action.id);
    return true;
  }
  if (chrome::IsCommandEnabled(browser, action.command))
    chrome::ExecuteCommand(browser, action.command, accelerator.time_stamp());
  // Disabled commands remain consumed, preventing another command from
  // firing merely because, for example, Back is currently unavailable.
  return true;
}
}  // namespace

std::optional<ui::Accelerator> ParseShortcut(std::string_view binding) {
  if (binding.empty() || binding.size() > 64) return std::nullopt;
  auto tokens = base::SplitStringPiece(binding, "+", base::KEEP_WHITESPACE,
                                       base::SPLIT_WANT_ALL);
  if (tokens.empty() || tokens.size() > 5) return std::nullopt;
  // Reject duplicate/unknown modifiers rather than accepting parser quirks.
  int flags = 0;
  for (size_t index = 0; index + 1 < tokens.size(); ++index) {
    int bit = tokens[index] == "Ctrl" ? ui::EF_CONTROL_DOWN :
              tokens[index] == "Alt" ? ui::EF_ALT_DOWN :
              tokens[index] == "Command" ? ui::EF_COMMAND_DOWN :
              tokens[index] == "Shift" ? ui::EF_SHIFT_DOWN : 0;
    if (!bit || (flags & bit)) return std::nullopt;
    flags |= bit;
  }
  const auto key = tokens.back();
  ui::KeyboardCode extra = ui::VKEY_UNKNOWN;
  if (key == "BracketLeft") extra = ui::VKEY_OEM_4;
  if (key == "BracketRight") extra = ui::VKEY_OEM_6;
  if (key == "Equal") extra = ui::VKEY_OEM_PLUS;
  if (key == "Minus") extra = ui::VKEY_OEM_MINUS;
  if (key.size() >= 2 && key.front() == 'F') {
    int number = 0;
    if (base::StringToInt(key.substr(1), &number) && number >= 1 && number <= 12)
      extra = static_cast<ui::KeyboardCode>(ui::VKEY_F1 + number - 1);
  }
  if (extra != ui::VKEY_UNKNOWN) {
    if (!flags && !(extra >= ui::VKEY_F1 && extra <= ui::VKEY_F12)) return std::nullopt;
    return ui::Accelerator(extra, flags);
  }
  if (!flags) return std::nullopt;
  const auto parsed = ui::Command::StringToAccelerator("Ctrl+" + std::string(key));
  if (parsed.key_code() == ui::VKEY_UNKNOWN) return std::nullopt;
  return ui::Accelerator(parsed.key_code(), flags);
}

std::optional<std::string> ValidateShortcutOverrides(const base::DictValue& overrides) {
  if (overrides.size() > Actions().size()) return "INVALID_SHORTCUT";
  for (const auto [id, value] : overrides) {
    if (!FindAction(id) || !value.is_dict()) return "INVALID_SHORTCUT";
    const auto& record = value.GetDict();
    const auto* binding = record.FindString("binding");
    const auto* priority = record.FindString("priority");
    if (record.size() != 2 || !binding || !priority ||
        (*priority != "browser" && *priority != "website")) return "INVALID_SHORTCUT";
    if (id == "global_search" && *priority != "browser") return "INVALID_SHORTCUT";
    if (!binding->empty()) {
      auto parsed = ParseShortcut(*binding);
      if (!parsed) return "INVALID_SHORTCUT";
      if (IsProtectedKey(*parsed)) return "RESERVED_SHORTCUT";
    }
  }
  std::map<ui::Accelerator, std::string> assigned;
  for (const auto& action : Actions()) {
    const auto binding = Binding(action, overrides);
    if (binding.empty()) continue;
    const auto accelerator = ParseShortcut(binding);
    if (!accelerator) return "INVALID_SHORTCUT";
    if (!assigned.emplace(*accelerator, action.id).second) return "SHORTCUT_CONFLICT";
  }
  for (const auto& action : Actions()) {
    if (Binding(action, overrides) != action.binding) continue;
    for (const auto& alias : action.aliases) {
      const auto parsed = ParseShortcut(alias);
      if (!parsed) return "INVALID_SHORTCUT";
      const auto found = assigned.find(*parsed);
      if (found != assigned.end() && found->second != action.id) return "SHORTCUT_CONFLICT";
      assigned.emplace(*parsed, action.id);
    }
  }
  return std::nullopt;
}

std::string ShortcutBinding(const WorkspaceState& state, std::string_view id) {
  const auto* action = FindAction(id);
  return action ? Binding(*action, state.shortcut_overrides()) : std::string();
}
base::ListValue DescribeShortcuts(const WorkspaceState& state) {
  base::ListValue list;
  for (const auto& action : Actions()) {
    base::DictValue item;
    item.Set("id", action.id);
    item.Set("label", state.language() == "en" ? action.en : action.zh);
    item.Set("labelZh", action.zh); item.Set("labelEn", action.en);
    item.Set("group", action.group);
    item.Set("global", action.id == "global_search");
#if BUILDFLAG(IS_MAC)
    if (action.id == "global_search") item.Set("status", std::string(GlobalSearchStatus()));
#endif
    item.Set("binding", Binding(action, state.shortcut_overrides()));
    item.Set("defaultBinding", action.binding);
    item.Set("priority", Priority(action, state.shortcut_overrides()));
    item.Set("modified", state.shortcut_overrides().contains(action.id));
    base::ListValue aliases;
    if (Binding(action, state.shortcut_overrides()) == action.binding)
      for (const auto& alias : action.aliases) aliases.Append(alias);
    item.Set("aliases", std::move(aliases));
    list.Append(std::move(item));
  }
  return list;
}

bool IsGlobalSearchKey(BrowserWindowInterface* browser, const ui::Accelerator& accelerator) {
  if (!browser || !SpaceNavigationView::From(browser)) return false;
  const auto* action = FindAction("global_search");
  auto* state = WorkspaceState::ForProfile(browser->GetProfile());
  return state->loaded() && (Same(Binding(*action, state->shortcut_overrides()), accelerator) ||
      Same(action->binding, accelerator));
}

ShortcutResult RouteShortcut(BrowserWindowInterface* browser,
                             const ui::Accelerator& accelerator,
                             ShortcutPhase phase) {
  if (browser && SpaceNavigationView::From(browser))
    SpaceNavigationView::From(browser)->ReleaseRecentTabCycle(accelerator.modifiers());
  if (!browser || browser->IsDeleteScheduled() || !SpaceNavigationView::From(browser) ||
      accelerator.key_state() != ui::Accelerator::KeyState::PRESSED)
    return ShortcutResult::kUnmatched;
  if (!IsModifiedKey(accelerator)) return ShortcutResult::kUnmatched;
  auto* state = WorkspaceState::ForProfile(browser->GetProfile());
  if (!state->loaded()) return ShortcutResult::kUnmatched;
  if (Capturing(browser->GetTabStripModel()->GetActiveWebContents()) && IsModifiedKey(accelerator))
    return phase == ShortcutPhase::kBeforeResponder ? ShortcutResult::kDeferred : ShortcutResult::kHandled;
  const auto& overrides = state->shortcut_overrides();
  const Action* matched = nullptr;
  bool deferred_alias = false;
  for (const auto& action : Actions()) {
    if (Same(Binding(action, overrides), accelerator)) { matched = &action; break; }
  }
  if (!matched) {
    for (const auto& action : Actions()) {
      if (Binding(action, overrides) != action.binding) continue;
      for (const auto& alias : action.aliases) if (Same(alias, accelerator)) {
        matched = &action;
        // Preserve standard native text navigation for Cmd+arrows.
        deferred_alias = alias == "Command+Left" || alias == "Command+Right";
        break;
      }
      if (matched) break;
    }
  }
  if (matched) {
    if (phase == ShortcutPhase::kBeforeResponder &&
        (deferred_alias || Priority(*matched, overrides) == "website"))
      return ShortcutResult::kDeferred;
    Execute(browser, *matched, accelerator);
    return ShortcutResult::kHandled;
  }
  // An old managed key becomes a webpage key, never an unrelated native
  // command. This includes Chromium's former sidebar key and Save Page Cmd+S.
  if (IsDefaultKey(accelerator) || Same("Command+Shift+L", accelerator))
    return phase == ShortcutPhase::kBeforeResponder ? ShortcutResult::kDeferred : ShortcutResult::kHandled;
  return ShortcutResult::kUnmatched;
}

bool SetShortcutCapture(content::WebContents* contents, bool capturing) {
  if (!contents) return false;
  const auto& url = contents->GetLastCommittedURL();
  if (!url.SchemeIs("chrome") || url.host() != "tai" ||
      !(url.path() == "/" || url.path() == "/index.html")) return false;
  if (capturing && contents->GetPrimaryMainFrame())
    contents->SetUserData(kCaptureKey, std::make_unique<CaptureState>(contents->GetPrimaryMainFrame()));
  else if (capturing) return false;
  else contents->RemoveUserData(kCaptureKey);
#if BUILDFLAG(IS_MAC)
  SetGlobalSearchCapture(capturing);
#endif
  return true;
}

bool GetManagedShortcutForCommand(BrowserWindowInterface* browser, int command,
                                 ui::Accelerator* accelerator) {
  if (command <= 0 || !browser || !SpaceNavigationView::From(browser)) return false;
  auto* state = WorkspaceState::ForProfile(browser->GetProfile());
  if (!state->loaded()) return false;
  if (command == IDC_BOOKMARK_THIS_TAB || command == IDC_NEW_SPLIT_TAB) { *accelerator = ui::Accelerator(); return true; }
  if (command == IDC_DEV_TOOLS_INSPECT) {
    *accelerator = *ParseShortcut("Alt+Command+C"); return true;
  }
  for (const auto& action : Actions()) if (action.command == command) {
    *accelerator = ParseShortcut(Binding(action, state->shortcut_overrides())).value_or(ui::Accelerator());
    return true;
  }
  return false;
}

void RunShortcutValidationChecks(base::ListValue& checks) {
  auto expect = [&checks](std::string name, bool passed) {
    base::DictValue item;
    item.Set("check", std::move(name)); item.Set("passed", passed);
    checks.Append(std::move(item));
  };
  auto put = [](base::DictValue& overrides, std::string id, std::string binding,
                std::string priority = "browser") {
    base::DictValue value;
    value.Set("binding", std::move(binding)); value.Set("priority", std::move(priority));
    overrides.Set(std::move(id), std::move(value));
  };
  base::DictValue overrides;
  put(overrides, "global_search", "", "browser");
  expect("global search can be explicitly unassigned", !ValidateShortcutOverrides(overrides));
  put(overrides, "global_search", "Alt+Command+N", "website");
  expect("global shortcut cannot claim webpage-first semantics", ValidateShortcutOverrides(overrides) == "INVALID_SHORTCUT");
  overrides.clear(); put(overrides, "new_space", "Alt+Command+N");
  expect("global shortcut participates in ordinary binding collision validation", ValidateShortcutOverrides(overrides) == "SHORTCUT_CONFLICT");
  overrides.clear();
  expect("shortcut defaults have no effective binding or alias collision",
         !ValidateShortcutOverrides(overrides));
  expect("shortcut parser supports modifier combinations and native punctuation/function keys",
         ParseShortcut("Ctrl+Alt+Command+Shift+C").has_value() &&
         ParseShortcut("Command+BracketLeft").has_value() &&
         ParseShortcut("F12").has_value() && ParseShortcut("Ctrl+PageDown").has_value() &&
         !ParseShortcut("Command+Command+C") && !ParseShortcut("A"));
  put(overrides, "new_space", "Command+R");
  expect("shortcut cannot shadow another action's default", ValidateShortcutOverrides(overrides) == "SHORTCUT_CONFLICT");
  put(overrides, "reload", "");
  expect("shortcut can be reassigned after its previous action is explicitly unbound", !ValidateShortcutOverrides(overrides));
  overrides.clear(); put(overrides, "new_space", "F12");
  expect("shortcut validation includes Chromium alternate bindings", ValidateShortcutOverrides(overrides) == "SHORTCUT_CONFLICT");
  overrides.clear(); put(overrides, "new_space", "Command+C");
  expect("shortcut validation preserves standard text editing", ValidateShortcutOverrides(overrides) == "RESERVED_SHORTCUT");
  put(overrides, "new_space", "Command+Q");
  expect("shortcut validation preserves app and OS commands", ValidateShortcutOverrides(overrides) == "RESERVED_SHORTCUT");
  put(overrides, "new_space", "Command+P");
  expect("shortcut validation preserves unmanaged Chromium commands", ValidateShortcutOverrides(overrides) == "RESERVED_SHORTCUT");
  overrides.clear(); put(overrides, "new_space", "Command+Shift+E", "website");
  expect("shortcut accepts explicit webpage-first policy", !ValidateShortcutOverrides(overrides));
  put(overrides, "new_space", "Command+Shift+E", "unknown");
  expect("shortcut rejects unsupported priority before committing", ValidateShortcutOverrides(overrides) == "INVALID_SHORTCUT");
}
}  // namespace sidebar
