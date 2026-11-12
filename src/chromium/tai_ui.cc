// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/tai_ui.h"
#include <algorithm>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include "base/command_line.h"
#include "base/check.h"
#include "base/base64.h"
#include "base/files/file_util.h"
#include "base/no_destructor.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/ui/select_file_policy/chrome_select_file_policy.h"
#include "chrome/browser/ui/dialogs/browser_dialogs.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/chrome_web_dialog_view.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "ui/base/base_window.h"
#include "ui/gfx/geometry/rounded_corners_f.h"
#include "ui/views/widget/widget.h"
#include "ui/web_dialogs/web_dialog_delegate.h"
#include "sidebar_browser/host/native_host.h"
#include "sidebar_browser/host/native_panel.h"
#include "sidebar_browser/host/page_identity.h"
#include "sidebar_browser/space_navigation_view.h"
#include "sidebar_browser/localization.h"
#include "sidebar_browser/sidebar_session.h"
#include "base/strings/utf_string_conversions.h"
#include "base/strings/escape.h"
#include "chrome/browser/ui/webui/webui_embedding_context.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "base/memory/ref_counted_memory.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "sidebar_browser/tai_resources.h"
#include "sidebar_browser/host_bundles.h"
#include "sidebar_browser/brand_resources.h"
#if BUILDFLAG(IS_MAC)
#include "sidebar_browser/agent_icon_mac.h"
#endif
#include "sidebar_browser/workspace_commands.h"
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/shortcuts.h"
#if BUILDFLAG(IS_MAC)
#include "sidebar_browser/global_search_mac.h"
#endif

namespace sidebar {
namespace {
base::DictValue ReadWelcomeExport(const base::FilePath& path) {
  constexpr size_t kMaximumExportBytes = 4 * 1024 * 1024;
  std::string contents;
  if (!base::ReadFileToStringWithMaxSize(path, &contents, kMaximumExportBytes)) {
    return HostFailure("", contents.size() == kMaximumExportBytes
                               ? "IMPORT_FILE_LIMIT" : "IMPORT_READ_FAILED");
  }
  return HostSuccess("", base::Value(base::UTF8ToUTF16(contents)));
}

constexpr char kRetiredHtml[] = R"HTML(<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>TAi Browser</title></head><body><main><h1>此内置功能已停止提供</h1><p>已有数据仍保留在原位置。请使用 Chromium 扩展添加所需工具。</p><a href="chrome://extensions/">管理扩展</a> · <a href="chrome://tai/">TAi 设置</a></main></body></html>)HTML";
std::string DecodeBrand(std::string_view text) {
  std::string data;
  CHECK(base::Base64Decode(text, &data));
  return data;
}
std::optional<std::string_view> Resource(std::string_view path) {
  path = path.substr(0, path.find_first_of("?#"));
  if (path.empty() || path == "index.html") return resources::kHtml;
  if (path == "tai.css") return resources::kCss;
  if (path == "tai.js") return resources::kJs;
  if (path == "i18n.js") return resources::kI18nJs;
  if (path == "shortcuts.js") return resources::kShortcutsJs;
  if (path == "shortcuts.css") return resources::kShortcutsCss;
  if (path == "agent-setup.js") return resources::kAgentSetupJs;
  if (path == "agent-setup.css") return resources::kAgentSetupCss;
  if (path == "settings-agent.js") return resources::kSettingsAgentJs;
  if (path == "panel.html") return resources::kPanelHtml;
  if (path == "panel.css") return resources::kPanelCss;
  if (path == "panel-shell.js") return resources::kPanelJs;
  if (path == "library.html") return kRetiredHtml;
  if (path == "home.html") return resources::kHomeHtml;
  if (path == "home.css") return resources::kHomeCss;
  if (path == "home.js") return resources::kHomeJs;
  if (path == "help.html") return resources::kHelpHtml;
  if (path == "help.css") return resources::kHelpCss;
  if (path == "help.js") return resources::kHelpJs;
  if (path == "welcome.html") return resources::kWelcomeHtml;
  if (path == "welcome.css") return resources::kWelcomeCss;
  if (path == "welcome.js") return resources::kWelcomeJs;
  if (path == "welcome-import.js") return host_bundles::kWelcomeImport;
  if (path == "components.html") return kRetiredHtml;
  if (path == "brand-standard-hero.png") { static const base::NoDestructor<std::string> data(DecodeBrand(brand_resources::kStandardHero)); return *data; }
  if (path == "brand-pride-hero.png") { static const base::NoDestructor<std::string> data(DecodeBrand(brand_resources::kPrideHero)); return *data; }
  if (path == "brand-product-icon.png") { static const base::NoDestructor<std::string> data(DecodeBrand(brand_resources::kAboutIcon)); return *data; }
  if (path == "brand-standard-icon.png") { static const base::NoDestructor<std::string> data(DecodeBrand(brand_resources::kStandardIcon)); return *data; }
  if (path == "brand-pride-icon.png") { static const base::NoDestructor<std::string> data(DecodeBrand(brand_resources::kPrideIcon)); return *data; }
#if BUILDFLAG(IS_MAC)
  if (path == "agent-chatgpt.png") {
    static const base::NoDestructor<std::string> data(MacAgentIconPng("codex"));
    return *data;
  }
  if (path == "agent-claude.png") {
    static const base::NoDestructor<std::string> data(MacAgentIconPng("claude"));
    return *data;
  }
  if (path == "agent-pi.png") {
    static const base::NoDestructor<std::string> data(MacAgentIconPng("pi"));
    return *data;
  }
#endif
  return std::nullopt;
}
constexpr char kWelcomeSessionKey[] = "tai-welcome-session";

struct WelcomeSession final : public base::SupportsUserData::Data {
  bool startup_released = false;
  bool start_at_import = false;
  base::WeakPtr<views::Widget> widget;
  base::CallbackListSubscription load_subscription;
  std::vector<base::WeakPtr<BrowserWindowInterface>> deferred_browsers;
};

WelcomeSession* GetWelcomeSession(Profile* profile) {
  auto* session = static_cast<WelcomeSession*>(profile->GetUserData(kWelcomeSessionKey));
  if (session) return session;
  auto created = std::make_unique<WelcomeSession>();
  session = created.get();
  profile->SetUserData(kWelcomeSessionKey, std::move(created));
  return session;
}

class WelcomeDialog final : public ui::WebDialogDelegate {
 public:
  explicit WelcomeDialog(bool first_run) : first_run_(first_run) {
    set_dialog_content_url(GURL("chrome://tai/welcome.html"));
    set_dialog_title(u"TAi Browser");
    set_accessible_dialog_title(u"TAi Browser");
    set_dialog_size(kSize);
    set_show_dialog_title(false);
    set_can_close(true);
    set_dialog_frame_kind(FrameKind::kDialog);
  }

  static constexpr gfx::Size kSize{510, 490};
  bool ShouldCloseDialogOnEscape() const override { return !first_run_; }
  void OnDialogClosed(const std::string&) override { delete this; }

 private:
  const bool first_run_;
};

class HelpDialog final : public ui::WebDialogDelegate {
 public:
  explicit HelpDialog(Profile* profile) {
    const auto title = LocalizedText16(profile, "TAi Browser 帮助", "TAi Browser Help");
    set_dialog_content_url(GURL("chrome://tai/help.html"));
    set_dialog_title(title);
    set_accessible_dialog_title(title);
    set_dialog_size(gfx::Size(550, 560));
    set_can_close(true);
  }

  void OnDialogClosed(const std::string&) override { delete this; }
};

struct HelpSession final : public base::SupportsUserData::Data {
  base::WeakPtr<views::Widget> widget;
};

bool OpenWelcomeDialog(Profile* profile, WelcomeSession& session,
                       bool start_at_import = false) {
  if (session.widget) {
    session.widget->Activate();
    return true;
  }
  views::Widget::InitParams params(
      views::Widget::InitParams::NATIVE_WIDGET_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_WINDOW_FRAMELESS);
  params.remove_standard_frame = true;
  params.rounded_corners = gfx::RoundedCornersF(24);
  params.shadow_type = views::Widget::InitParams::ShadowType::kDrop;
  auto window = chrome::ShowWebDialogWithParams(
      gfx::NativeView(), profile,
      new WelcomeDialog(!session.deferred_browsers.empty()), std::move(params),
      /*show=*/false);
  auto* widget = views::Widget::GetWidgetForNativeWindow(window);
  if (!widget) return false;
  session.start_at_import = start_at_import;
  session.widget = widget->GetWeakPtr();
  widget->CenterWindow(WelcomeDialog::kSize);
  widget->Show();
  return true;
}

void RevealDeferredBrowsers(WelcomeSession& session, const GURL& destination) {
  session.startup_released = true;
  auto browsers = std::exchange(session.deferred_browsers, {});
  for (auto& browser : browsers) {
    if (browser) browser->GetWindow()->Show();
  }
  if (destination.is_empty()) return;
  const auto browser = std::ranges::find_if(browsers, [](const auto& entry) {
    return static_cast<bool>(entry);
  });
  if (browser == browsers.end()) return;
  NavigateParams params(browser->get(), destination, ui::PAGE_TRANSITION_LINK);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
}

void OnWelcomeStateLoaded(Profile* profile) {
  auto* state = WorkspaceState::ForProfile(profile);
  if (!state->loaded()) return;
  auto& session = *GetWelcomeSession(profile);
  session.load_subscription = {};
  if (!state->welcome_pending() || !OpenWelcomeDialog(profile, session))
    RevealDeferredBrowsers(session, GURL());
}

class TaiHandler final : public content::WebUIMessageHandler, public ui::SelectFileDialog::Listener {
 public:
  explicit TaiHandler(Profile* profile) : state_(WorkspaceState::ForProfile(profile)), profile_(profile) {}
  ~TaiHandler() override { weak_.InvalidateWeakPtrs(); ClosePicker(); ReleaseSurfaces(); }
  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback("taiGetCaptureTargets", base::BindRepeating(&TaiHandler::CaptureTargets, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiGetPanelState", base::BindRepeating(&TaiHandler::PanelState, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiSetPanelVisible", base::BindRepeating(&TaiHandler::PanelVisible, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiOpenComponents", base::BindRepeating(&TaiHandler::OpenComponents, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiOpenSettings", base::BindRepeating(&TaiHandler::OpenSettings, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiGetHostState", base::BindRepeating(&TaiHandler::HostState, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiHost", base::BindRepeating(&TaiHandler::Host, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiPickLibrary", base::BindRepeating(&TaiHandler::PickLibrary, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiPickSource", base::BindRepeating(&TaiHandler::PickSource, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiCreateTask", base::BindRepeating(&TaiHandler::CreateTask, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiRevealTaskPage", base::BindRepeating(&TaiHandler::RevealTaskPage, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiSetTaskPaused", base::BindRepeating(&TaiHandler::SetTaskPaused, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiRevokeTask", base::BindRepeating(&TaiHandler::RevokeTask, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiHostFixture", base::BindRepeating(&TaiHandler::Fixture, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiSetShortcutCapture", base::BindRepeating(&TaiHandler::ShortcutCapture, base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "taiShowWelcome", base::BindRepeating(
            &TaiHandler::ShowWelcome, base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "taiPrepareWelcome", base::BindRepeating(
            &TaiHandler::PrepareWelcome, base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "taiCompleteWelcome", base::BindRepeating(
            &TaiHandler::CompleteWelcome, base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "taiPickWelcomeExport", base::BindRepeating(
            &TaiHandler::PickWelcomeExport, base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "taiImportWelcome", base::BindRepeating(
            &TaiHandler::ImportWelcome, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiGetState", base::BindRepeating(
        &TaiHandler::GetState, base::Unretained(this)));
    web_ui()->RegisterMessageCallback("taiCommand", base::BindRepeating(
        &TaiHandler::Command, base::Unretained(this)));
  }
 private:
  void OnJavascriptAllowed() override {
    module_subscription_ = NativeHost::ForProfile(profile_)->ObserveModules(base::BindRepeating(&TaiHandler::ModulesChanged, base::Unretained(this)));
    subscription_ = state_->Observe(base::BindRepeating(
        &TaiHandler::Changed, base::Unretained(this)));
  }
  void OnJavascriptDisallowed() override {
    module_subscription_ = {};
    subscription_ = {};
    ClosePicker();
    welcome_import_pending_ = false;
    ReleaseSurfaces();
    weak_.InvalidateWeakPtrs();
  }
  void ModulesChanged() { if (IsJavascriptAllowed()) FireWebUIListener("tai-modules-changed", base::Value()); }
  void RefreshGlobalSearch() {
#if BUILDFLAG(IS_MAC)
    if (auto* owner = Owner()) UpdateGlobalSearch(owner, ShortcutBinding(*state_, "global_search"));
#endif
  }
  void Changed() {
    RefreshGlobalSearch();
    if (IsJavascriptAllowed()) FireWebUIListener("tai-state-changed", DescribeWorkspace(*state_));
  }
  void ShortcutCapture(const base::ListValue& args) {
    if (args.size() != 2 || !args[0].is_string() || !args[1].is_bool()) return;
    AllowJavascript();
    ResolveJavascriptCallback(args[0], base::Value(SetShortcutCapture(web_ui()->GetWebContents(), args[1].GetBool())));
  }
  bool IsWelcomeDocument() {
    return web_ui()->GetWebContents()->GetLastCommittedURL().path() ==
           "/welcome.html";
  }
  bool IsWelcomeDialog(const WelcomeSession& session) {
    return IsWelcomeDocument() && session.widget &&
           session.widget->GetNativeWindow() ==
               web_ui()->GetWebContents()->GetTopLevelNativeWindow();
  }
  void PrepareWelcome(const base::ListValue& args) {
    if (!Callback(args, 1) || !IsWelcomeDocument()) return;
    auto& session = *GetWelcomeSession(profile_);
    if (IsWelcomeDialog(session)) {
      const char* surface = !session.deferred_browsers.empty()
          ? "startup"
          : session.start_at_import ? "import" : "dialog";
      ResolveJavascriptCallback(args[0], base::Value(surface));
      return;
    }
    // An old tab can be restored after an upgrade. Route it to the window
    // without interrupting the user when the restored tab is in the background.
    auto* owner = Owner();
    if (owner && owner->GetTabStripModel()->GetActiveWebContents() ==
                     web_ui()->GetWebContents()) {
      OpenWelcomeDialog(profile_, session);
    }
    ResolveJavascriptCallback(args[0], base::Value("tab"));
  }
  void ShowWelcome(const base::ListValue& args) {
    if (!Callback(args, 1)) return;
    const auto path =
        web_ui()->GetWebContents()->GetLastCommittedURL().path();
    const bool allowed = (path == "/" || path == "/index.html") &&
                         Gesture() && Owner();
    ResolveJavascriptCallback(
        args[0], base::Value(allowed && OpenTaiImportDialog(profile_)));
  }
  void CompleteWelcome(const base::ListValue& args) {
    if (!Callback(args, 2) || !args[1].is_string()) return;
    const auto& next = args[1].GetString();
    GURL destination;
    if (next == "passwords") {
      destination = GURL("chrome://password-manager/settings?import=true");
    } else if (next == "safari") {
      destination = GURL("chrome://settings/importData");
    } else if (!next.empty()) {
      ResolveJavascriptCallback(args[0], base::Value(false));
      return;
    }
    auto& session = *GetWelcomeSession(profile_);
    if (!IsWelcomeDialog(session) || !Gesture() || !state_->CompleteWelcome()) {
      ResolveJavascriptCallback(args[0], base::Value(false));
      return;
    }
    ResolveJavascriptCallback(args[0], base::Value(true));
    session.widget->Close();
    if (!session.deferred_browsers.empty())
      RevealDeferredBrowsers(session, destination);
  }
  void ImportWelcome(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    // A successful native file selection authorizes one write in this card,
    // even if the system picker was open past transient user activation.
    const bool selected = std::exchange(welcome_import_pending_, false);
    ResolveJavascriptCallback(
        args[0], IsWelcomeDialog(*GetWelcomeSession(profile_)) && selected
                     ? ImportWelcomeSpaces(*state_, args[1])
                     : HostFailure("", "USER_GESTURE_REQUIRED"));
  }
  void PickWelcomeExport(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    if (!IsWelcomeDialog(*GetWelcomeSession(profile_)) || !Gesture() || dialog_) {
      ResolveJavascriptCallback(args[0], HostFailure("", "USER_GESTURE_REQUIRED"));
      return;
    }
    if (!args[1].is_string()) {
      ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS"));
      return;
    }
    const auto& source = args[1].GetString();
    ui::SelectFileDialog::FileTypeInfo types;
    types.allowed_paths = ui::SelectFileDialog::FileTypeInfo::NATIVE_PATH;
    if (source == "arc") {
      types.extensions = {{FILE_PATH_LITERAL("md"), FILE_PATH_LITERAL("markdown"),
                           FILE_PATH_LITERAL("json")}};
    } else if (source == "chrome" || source == "safari") {
      types.extensions = {{FILE_PATH_LITERAL("html"), FILE_PATH_LITERAL("htm")}};
      if (source == "chrome") {
        types.extensions.front().push_back(FILE_PATH_LITERAL("json"));
        types.include_all_files = true;  // Chrome's Bookmarks can have no suffix.
      }
    } else {
      ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS"));
      return;
    }
    welcome_import_pending_ = false;
    picker_callback_ = args[0].GetString();
    picker_kind_ = Picker::kWelcome;
    dialog_ = ui::SelectFileDialog::Create(
        this, std::make_unique<ChromeSelectFilePolicy>(web_ui()->GetWebContents()));
    dialog_->SelectFile(
        ui::SelectFileDialog::SELECT_OPEN_FILE,
        LocalizedText16(profile_, "选择导出文件", "Choose an export file"),
        base::FilePath(), &types, 1, base::FilePath::StringType(),
        web_ui()->GetWebContents()->GetTopLevelNativeWindow(), nullptr);
  }
  void GetState(const base::ListValue& args) {
    if (args.size() != 1 || !args[0].is_string() || args[0].GetString().size() > 120) return;
    AllowJavascript();
    RefreshGlobalSearch();
    ResolveJavascriptCallback(args[0], DescribeWorkspace(*state_));
  }
  void Command(const base::ListValue& args) {
    if (args.size() != 2 || !args[0].is_string() || args[0].GetString().size() > 120) return;
    AllowJavascript();
    ResolveJavascriptCallback(args[0], ExecuteWorkspaceCommand(*state_, args[1]));
  }
  bool Callback(const base::ListValue& args, size_t count) {
    if (args.size() != count || !args[0].is_string() || args[0].GetString().size() > 120) return false;
    AllowJavascript(); return true;
  }
  NativeHost::Reply ReplyTo(std::string callback) {
    return base::BindOnce([](base::WeakPtr<TaiHandler> self, std::string callback, base::DictValue result) {
      if (self && self->IsJavascriptAllowed()) self->ResolveJavascriptCallback(base::Value(callback), std::move(result));
    }, weak_.GetWeakPtr(), std::move(callback));
  }
  BrowserWindowInterface* Owner() {
    auto* contents = web_ui()->GetWebContents();
    if (auto* owner = webui::GetBrowserWindowInterface(contents)) return owner->GetProfile() == profile_ ? owner : nullptr;
    for (auto* candidate : GetAllBrowserWindowInterfaces()) if (candidate->GetProfile() == profile_ &&
        candidate->GetTabStripModel()->GetIndexOfWebContents(contents) != TabStripModel::kNoTab) return candidate;
    return nullptr;
  }
  void PanelState(const base::ListValue& args) {
    if (!Callback(args, 1)) return;
    ResolveJavascriptCallback(args[0], DescribeTaiPanel(Owner(), web_ui()->GetWebContents()));
  }
  void CaptureTargets(const base::ListValue& args) {
    if (!Callback(args, 1)) return;
    base::ListValue pages;
    auto* owner = Owner();
    auto* sidebar = owner ? SpaceNavigationView::From(owner) : nullptr;
    if (owner && sidebar) {
      auto* tabs = owner->GetTabStripModel();
      for (int index = 0; index < tabs->count(); ++index) {
        auto* contents = tabs->GetWebContentsAt(index);
        const auto binding = ReadOrganization(contents);
        const auto* saved = binding ? state_->model().FindItem(binding->item_id) : nullptr;
        const bool favorite = saved && saved->kind == SavedKind::kFavorite;
        if (!binding || binding->placeholder || (binding->space_id != sidebar->active_space_id() && !favorite) ||
            !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) continue;
        PageIdentity::CreateForWebContents(contents);
        auto* identity = PageIdentity::FromWebContents(contents);
        base::DictValue item;
        item.Set("profileId", state_->profile_id()); item.Set("spaceId", sidebar->active_space_id());
        item.Set("pageId", identity->id()); item.Set("pageRevision", identity->revision());
        item.Set("title", base::UTF16ToUTF8(contents->GetTitle()));
        item.Set("url", contents->GetLastCommittedURL().spec());
        item.Set("active", contents == tabs->GetActiveWebContents());
        pages.Append(std::move(item));
      }
    }
    ResolveJavascriptCallback(args[0], std::move(pages));
  }
  void PanelVisible(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    if (!Gesture() || !args[1].is_bool()) { ResolveJavascriptCallback(args[0], HostFailure("", "USER_GESTURE_REQUIRED")); return; }
    const bool changed = SetTaiPanelVisible(Owner(), args[1].GetBool());
    ResolveJavascriptCallback(args[0], changed ? HostSuccess("", base::Value(true)) : HostFailure("", "WINDOW_UNAVAILABLE"));
  }
  void OpenSettings(const base::ListValue& args) {
    if (!Callback(args, 1)) return;
    auto* owner = Owner();
    if (!Gesture() || !owner) { ResolveJavascriptCallback(args[0], HostFailure("", "USER_GESTURE_REQUIRED")); return; }
    auto* sidebar = SpaceNavigationView::From(owner);
    const std::string query = sidebar ? "?space=" + base::EscapeQueryParamValue(sidebar->active_space_id(), true) : "";
    NavigateParams params(owner, GURL("chrome://tai/" + query + "#agent"), ui::PAGE_TRANSITION_AUTO_BOOKMARK);
    params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB; Navigate(&params);
    ResolveJavascriptCallback(args[0], HostSuccess("", base::Value(true)));
  }
  void OpenComponents(const base::ListValue& args) {
    if (Callback(args, 2)) ResolveJavascriptCallback(args[0], HostFailure("", "COMMAND_UNAVAILABLE"));
  }
  bool Gesture() { return web_ui()->GetWebContents()->GetPrimaryMainFrame()->HasTransientUserActivation(); }
  void HostState(const base::ListValue& args) {
    if (!Callback(args, 1)) return;
    ResolveJavascriptCallback(args[0], NativeHost::ForProfile(profile_)->Describe());
  }
  void Host(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    auto* host = NativeHost::ForProfile(profile_); host_ = host->GetWeakPtr();
    const auto* input = args[1].is_dict() ? &args[1].GetDict() : nullptr;
    const auto* command = input ? input->FindString("command") : nullptr;
    const auto* payload = input ? input->FindDict("payload") : nullptr;
    const auto* handle = payload ? payload->FindString("handle") : nullptr;
    if (payload && payload->FindString("op") && *payload->FindString("op") == "reader.copyPath" && !Gesture()) {
      ResolveJavascriptCallback(args[0], HostFailure(input->FindString("id") ? *input->FindString("id") : "", "USER_GESTURE_REQUIRED")); return;
    }
    host->ExecuteUI(args[1], base::BindOnce([](base::WeakPtr<TaiHandler> self,
        base::WeakPtr<NativeHost> host, std::string callback, std::string command,
        std::string handle, base::DictValue result) {
      if (result.FindBool("ok").value_or(false)) {
        const auto* value = result.FindDict("value");
        const auto* created = value ? value->FindString("handle") : nullptr;
        if (command == "modules.preview" && created) {
          if (self) self->surfaces_.insert(*created);
          else if (host) host->ReleaseSurface(*created);
        }
        if (self && command == "modules.dispose") self->surfaces_.erase(handle);
      }
      if (self && self->IsJavascriptAllowed()) self->ResolveJavascriptCallback(base::Value(callback), std::move(result));
    }, weak_.GetWeakPtr(), host_, args[0].GetString(), command ? *command : std::string(),
       handle ? *handle : std::string()));
  }
  void PickLibrary(const base::ListValue& args) {
    if (Callback(args, 1)) ResolveJavascriptCallback(args[0], HostFailure("", "COMMAND_UNAVAILABLE"));
  }
  void PickSource(const base::ListValue& args) { Pick(args, true); }
  void Pick(const base::ListValue& args, bool source) {
    if (!Callback(args, 1)) return;
    if (!Gesture() || dialog_) { ResolveJavascriptCallback(args[0], HostFailure("", "USER_GESTURE_REQUIRED")); return; }
    picker_callback_ = args[0].GetString();
    picker_kind_ = source ? Picker::kSource : Picker::kLibrary;
    dialog_ = ui::SelectFileDialog::Create(this, std::make_unique<ChromeSelectFilePolicy>(web_ui()->GetWebContents()));
    ui::SelectFileDialog::FileTypeInfo types; types.allowed_paths = ui::SelectFileDialog::FileTypeInfo::NATIVE_PATH;
    if (source) { types.extensions = {{FILE_PATH_LITERAL("json"), FILE_PATH_LITERAL("html"), FILE_PATH_LITERAL("htm")}}; types.include_all_files = true; }
    dialog_->SelectFile(source ? ui::SelectFileDialog::SELECT_OPEN_FILE : ui::SelectFileDialog::SELECT_FOLDER,
        source ? u"选择 Chrome / Arc 导出资料" : u"选择 TAi 资料库文件夹", base::FilePath(), &types, 0,
        base::FilePath::StringType(), web_ui()->GetWebContents()->GetTopLevelNativeWindow(), nullptr);
  }
  void ClosePicker() { if (dialog_) { dialog_->ListenerDestroyed(); dialog_ = nullptr; } picker_callback_.clear(); }
  void FileSelected(const ui::SelectedFileInfo& file, int) override {
    auto callback = std::move(picker_callback_); dialog_ = nullptr;
    if (!IsJavascriptAllowed() || callback.empty()) return;
    if (picker_kind_ == Picker::kWelcome) {
      base::ThreadPool::PostTaskAndReplyWithResult(
          FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_VISIBLE},
          base::BindOnce(&ReadWelcomeExport, file.path()),
          base::BindOnce(&TaiHandler::WelcomeExportRead, weak_.GetWeakPtr(),
                         std::move(callback)));
      return;
    }
    auto* host = NativeHost::ForProfile(profile_);
    if (picker_kind_ == Picker::kSource) host->GrantSource(file.path(), ReplyTo(std::move(callback)));
    else host->GrantLibrary(file.path(), ReplyTo(std::move(callback)));
  }
  void WelcomeExportRead(std::string callback, base::DictValue result) {
    if (!IsJavascriptAllowed() || !IsWelcomeDialog(*GetWelcomeSession(profile_)))
      return;
    welcome_import_pending_ = result.FindBool("ok").value_or(false);
    ResolveJavascriptCallback(base::Value(callback), std::move(result));
  }
  void FileSelectionCanceled() override {
    auto callback = std::move(picker_callback_); dialog_ = nullptr;
    if (IsJavascriptAllowed() && !callback.empty()) std::move(ReplyTo(callback)).Run(HostFailure("", "CANCELED"));
  }
  void CreateTask(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    if (!Gesture() || !args[1].is_dict()) { ResolveJavascriptCallback(args[0], HostFailure("", "USER_GESTURE_REQUIRED")); return; }
    const auto& input = args[1].GetDict(); const auto* space = input.FindString("spaceId");
    const auto* commands = input.FindList("commands"); const auto* libraries = input.FindList("libraries");
    std::vector<std::string> allowed, grants;
    if (!space || !commands || !libraries || input.size() > 6 ||
        (input.contains("remember") && !input.FindBool("remember")) ||
        (input.contains("provider") && !input.FindString("provider")) ||
        (input.contains("reconnectTaskId") && !input.FindString("reconnectTaskId"))) { ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS")); return; }
    for (const auto& command : *commands) { if (!command.is_string()) { ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS")); return; } allowed.push_back(command.GetString()); }
    for (const auto& library : *libraries) { if (!library.is_string()) { ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS")); return; } grants.push_back(library.GetString()); }
    for (const auto [key, value] : input) if (key != "spaceId" && key != "commands" && key != "libraries" && key != "provider" && key != "reconnectTaskId" && key != "remember") {
      ResolveJavascriptCallback(args[0], HostFailure("", "INVALID_ARGUMENTS")); return;
    }
    auto* owner = Owner();
    auto window = owner ? owner->GetWeakPtr() : base::WeakPtr<BrowserWindowInterface>();
    NativeHost::ForProfile(profile_)->CreateTask(*space, std::move(allowed), std::move(grants), window, ReplyTo(args[0].GetString()),
        input.FindString("provider") ? *input.FindString("provider") : "other",
        input.FindString("reconnectTaskId") ? *input.FindString("reconnectTaskId") : "",
        input.FindBool("remember").value_or(false));
  }
  void RevealTaskPage(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    auto callback = args[0].Clone();
    const bool shown = Gesture() && args[1].is_string() &&
        NativeHost::ForProfile(profile_)->RevealTaskPage(args[1].GetString(), Owner());
    if (IsJavascriptAllowed()) ResolveJavascriptCallback(callback, shown);
  }
  void SetTaskPaused(const base::ListValue& args) {
    if (!Callback(args, 3)) return;
    const bool changed = Gesture() && args[1].is_string() && args[2].is_bool() &&
        NativeHost::ForProfile(profile_)->SetTaskPaused(args[1].GetString(), Owner(), args[2].GetBool());
    ResolveJavascriptCallback(args[0], changed);
  }
  void RevokeTask(const base::ListValue& args) {
    if (!Callback(args, 2) || !args[1].is_string()) return;
    ResolveJavascriptCallback(args[0], NativeHost::ForProfile(profile_)->RevokeTask(args[1].GetString()));
  }
  void Fixture(const base::ListValue& args) {
    if (!Callback(args, 2)) return;
    auto* cli = base::CommandLine::ForCurrentProcess();
    if (cli->GetSwitchValueASCII("test-type") != "tai-host" || !args[1].is_string()) {
      ResolveJavascriptCallback(args[0], HostFailure("", "COMMAND_UNAVAILABLE")); return;
    }
    if (args[1].GetString() != "source") {
      ResolveJavascriptCallback(args[0], HostFailure("", "COMMAND_UNAVAILABLE")); return;
    }
    auto* host = NativeHost::ForProfile(profile_);
    const bool source = true;
    const auto path = cli->GetSwitchValuePath(source ? "tai-host-fixture-source" : "tai-host-fixture-directory");
    if (path.empty()) { ResolveJavascriptCallback(args[0], HostFailure("", "COMMAND_UNAVAILABLE")); return; }
    if (source) host->GrantSource(path, ReplyTo(args[0].GetString()));
    else host->GrantLibrary(path, ReplyTo(args[0].GetString()));
  }
  void ReleaseSurfaces() {
    if (host_) for (const auto& handle : surfaces_) host_->ReleaseSurface(handle);
    surfaces_.clear();
  }
  std::set<std::string> surfaces_;
  base::WeakPtr<NativeHost> host_;
  raw_ptr<WorkspaceState> state_;
  base::CallbackListSubscription subscription_, module_subscription_;
  raw_ptr<Profile> profile_;
  scoped_refptr<ui::SelectFileDialog> dialog_;
  std::string picker_callback_;
  enum class Picker { kLibrary, kSource, kWelcome };
  Picker picker_kind_ = Picker::kLibrary;
  bool welcome_import_pending_ = false;
  base::WeakPtrFactory<TaiHandler> weak_{this};
};
}  // namespace

bool OpenTaiImportDialog(Profile* profile) {
  if (!profile || profile->IsOffTheRecord() ||
      !base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {
    return false;
  }
  return OpenWelcomeDialog(profile, *GetWelcomeSession(profile),
                           /*start_at_import=*/true);
}

bool OpenTaiHelpDialog(Profile* profile) {
  if (!profile || !base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser"))
    return false;
  profile = profile->GetOriginalProfile();
  constexpr char kHelpSessionKey[] = "tai-help-session";
  auto* session = static_cast<HelpSession*>(profile->GetUserData(kHelpSessionKey));
  if (!session) {
    auto created = std::make_unique<HelpSession>();
    session = created.get();
    profile->SetUserData(kHelpSessionKey, std::move(created));
  }
  if (session->widget) {
    session->widget->Activate();
    return true;
  }
  auto window = chrome::ShowWebDialog(gfx::NativeView(), profile,
                                      new HelpDialog(profile));
  if (auto* widget = views::Widget::GetWidgetForNativeWindow(window)) {
    session->widget = widget->GetWeakPtr();
    return true;
  }
  return false;
}

bool DeferBrowserForWelcome(BrowserWindowInterface* browser) {
  if (!base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") ||
      browser->GetType() != BrowserWindowInterface::TYPE_NORMAL ||
      browser->GetProfile()->IsOffTheRecord() ||
      browser->GetWindow()->IsVisible()) {
    return false;
  }
  auto* profile = browser->GetProfile();
  auto* state = WorkspaceState::ForProfile(profile);
  if (state->loaded() && !state->welcome_pending()) return false;
  auto& session = *GetWelcomeSession(profile);
  if (session.startup_released) return false;
  if (std::ranges::none_of(session.deferred_browsers, [browser](const auto& weak) {
        return weak.get() == browser;
      })) {
    session.deferred_browsers.push_back(browser->GetWeakPtr());
  }
  if (state->loaded()) {
    OnWelcomeStateLoaded(profile);
  } else if (!session.load_subscription) {
    session.load_subscription = state->Observe(
        base::BindRepeating(&OnWelcomeStateLoaded, profile));
  }
  return true;
}

bool TaiUIConfig::IsWebUIEnabled(content::BrowserContext* context) {
  return base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&
         !Profile::FromBrowserContext(context)->IsOffTheRecord();
}
TaiUI::TaiUI(content::WebUI* web_ui) : WebUIController(web_ui) {
  auto* profile = Profile::FromWebUI(web_ui);
  auto* source = content::WebUIDataSource::CreateAndAdd(profile, "tai");
  source->SetResourcePathToResponse("", resources::kHtml);
  source->SetResourcePathToResponse("index.html", resources::kHtml);
  source->SetResourcePathToResponse("tai.css", resources::kCss);
  source->SetResourcePathToResponse("i18n.js", resources::kI18nJs);
  source->SetResourcePathToResponse("shortcuts.js", resources::kShortcutsJs);
  source->SetResourcePathToResponse("shortcuts.css", resources::kShortcutsCss);
  source->SetResourcePathToResponse("tai.js", resources::kJs);
  source->SetResourcePathToResponse("agent-setup.js", resources::kAgentSetupJs);
  source->SetResourcePathToResponse("agent-setup.css", resources::kAgentSetupCss);
  source->SetResourcePathToResponse("settings-agent.js", resources::kSettingsAgentJs);
  source->SetResourcePathToResponse("panel.html", resources::kPanelHtml);
  source->SetResourcePathToResponse("panel.css", resources::kPanelCss);
  source->SetResourcePathToResponse("panel-shell.js", resources::kPanelJs);
  source->SetResourcePathToResponse("library.html", kRetiredHtml);
  for (const char* path : {"help.html", "help.css", "help.js"})
    source->SetResourcePathToResponse(path, *Resource(path));
  for (const char* path : {"home.html", "home.css", "home.js", "welcome.html", "welcome.css", "welcome.js", "welcome-import.js", "components.html", "brand-standard-hero.png", "brand-pride-hero.png", "brand-product-icon.png", "brand-standard-icon.png", "brand-pride-icon.png"})
    source->SetResourcePathToResponse(path, *Resource(path));
#if BUILDFLAG(IS_MAC)
  for (const char* path : {"agent-chatgpt.png", "agent-claude.png", "agent-pi.png"})
    source->SetResourcePathToResponse(path, *Resource(path));
#endif
  // Pinned Chromium's non-V2 URL loader uses a request filter; V2 consumes
  // the same immutable byte map above. No paths or URLs are opened from input.
  source->SetRequestFilter(
      base::BindRepeating([](const std::string&) { return true; }),
      base::BindRepeating([](const std::string& path,
                            content::WebUIDataSource::GotDataCallback callback) {
        const auto data = Resource(path);
        if (!data) { std::move(callback).Run(nullptr); return; }
        std::move(callback).Run(base::MakeRefCounted<base::RefCountedString>(std::string(*data)));
      }));
  source->OverrideContentSecurityPolicy(network::mojom::CSPDirectiveName::FrameSrc, "frame-src chrome-untrusted://tai-content;");
  source->OverrideContentSecurityPolicy(network::mojom::CSPDirectiveName::ConnectSrc, "connect-src 'none';");
  web_ui->AddRequestableScheme(content::kChromeUIUntrustedScheme);
  web_ui->AddMessageHandler(std::make_unique<TaiHandler>(profile));
}
TaiUI::~TaiUI() = default;
}  // namespace sidebar
