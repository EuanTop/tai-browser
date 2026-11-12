// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
// Reuse the upstream registry, panel layout, WebView and action lifecycle.
#include "sidebar_browser/host/native_panel.h"
#include "sidebar_browser/localization.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/supports_user_data.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_actions.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/side_panel/side_panel_content_proxy.h"
#include "chrome/browser/ui/side_panel/side_panel_entry.h"
#include "chrome/browser/ui/side_panel/side_panel_entry_scope.h"
#include "chrome/browser/ui/side_panel/side_panel_registry.h"
#include "chrome/browser/ui/side_panel/side_panel_ui.h"
#include "chrome/browser/ui/side_panel/side_panel_util.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/webui/webui_embedding_context.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "components/vector_icons/vector_icons.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents.h"
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/space_navigation_view.h"
#include "ui/actions/actions.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "ui/views/background.h"
#include "chrome/browser/ui/views/side_panel/side_panel.h"
#include "ui/color/color_provider.h"
#include "ui/gfx/canvas.h"
#include "cc/paint/paint_flags.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/color/color_id.h"
#include "ui/views/controls/button/label_button.h"
#include "ui/views/controls/webview/unhandled_keyboard_event_handler.h"
#include "ui/views/controls/webview/webview.h"
namespace sidebar {
namespace {
constexpr char kPanelContents[] = "tai-window-panel";
class PanelMarker final : public base::SupportsUserData::Data {};
bool Allowed(BrowserWindowInterface* browser) {
  return browser && !browser->GetProfile()->IsOffTheRecord() &&
      base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser");
}
class TaiPanelView;
// The registry owns this state through its entry callback, independently of the
// transient view that Chromium destroys on close. No global panel cache changes.
class PanelState final : public content::WebContentsDelegate,
                         public content::WebContentsObserver {
 public:
  content::WebContents* EnsureContents(BrowserWindowInterface* browser) {
    if (!contents_) {
      contents_ = content::WebContents::Create(
          content::WebContents::CreateParams(browser->GetProfile()));
      contents_->SetUserData(kPanelContents, std::make_unique<PanelMarker>());
      contents_->SetDelegate(this);
      webui::SetBrowserWindowInterface(contents_.get(), browser);
      Observe(contents_.get());
      content::NavigationController::LoadURLParams params(GURL("chrome://tai/panel.html"));
      params.transition_type = ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
      contents_->GetController().LoadURLWithParams(params);
    }
    return contents_.get();
  }
  void Attach(base::WeakPtr<TaiPanelView> view) { view_ = view; }
  void Detach() { view_.reset(); contents_->WasHidden(); }
  bool ready() const { return ready_; }
  void DocumentOnLoadCompletedInPrimaryMainFrame() override;
  bool HandleKeyboardEvent(content::WebContents*, const input::NativeWebKeyboardEvent& event) override;
 private:
  bool ready_ = false;
  std::unique_ptr<content::WebContents> contents_;
  base::WeakPtr<TaiPanelView> view_;
};
class TaiPanelView final : public views::WebView {
  METADATA_HEADER(TaiPanelView, views::WebView)
 public:
  TaiPanelView(BrowserWindowInterface* browser, std::shared_ptr<PanelState> state)
      : WebView(browser->GetProfile()), state_(std::move(state)) {
    SetWebContents(state_->EnsureContents(browser));
    state_->Attach(weak_factory_.GetWeakPtr());
    SetReady(state_->ready());
  }
  ~TaiPanelView() override {
    // Detach before our shared state can be destroyed. WebView does not own the
    // WebContents; a registry/window teardown releases it and its native handles.
    state_->Detach();
    SetWebContents(nullptr);
  }
  void SetReady(bool ready) { SidePanelUtil::GetSidePanelContentProxy(this)->SetAvailable(ready); }
  bool ForwardKeyboard(const input::NativeWebKeyboardEvent& event) {
    return keyboard_.HandleKeyboardEvent(event, GetFocusManager());
  }
 private:
  std::shared_ptr<PanelState> state_;
  views::UnhandledKeyboardEventHandler keyboard_;
  base::WeakPtrFactory<TaiPanelView> weak_factory_{this};
};
BEGIN_METADATA(TaiPanelView)
END_METADATA
void PanelState::DocumentOnLoadCompletedInPrimaryMainFrame() {
  ready_ = true;
  if (view_) view_->SetReady(true);
}
bool PanelState::HandleKeyboardEvent(content::WebContents*, const input::NativeWebKeyboardEvent& event) {
  return view_ && view_->ForwardKeyboard(event);
}
bool EnsureEntry(BrowserWindowInterface* browser) {
  if (!Allowed(browser)) return false;
  auto* registry = SidePanelRegistry::From(browser);
  auto* browser_actions = BrowserActions::From(browser);
  if (!registry || !browser_actions || !SidePanelUI::From(browser)) return false;
  // Only TAi is fixed to the right; keep the user's other panel preferences.
  ScopedDictPrefUpdate alignment(browser->GetProfile()->GetPrefs(), prefs::kSidePanelAlignmentOverrides);
  alignment->Set(SidePanelEntryIdToString(SidePanelEntryId::kTai), true);
  const SidePanelEntryKey key(SidePanelEntryId::kTai);
  if (registry->GetEntryForKey(key)) return true;
  auto* root = browser_actions->root_action_item();
  if (!actions::ActionManager::Get().FindAction(TaiPanelActionId(), root)) {
    root->AddChild(actions::ActionItem::Builder(base::BindRepeating(
        [](base::WeakPtr<BrowserWindowInterface> owner, actions::ActionItem*, actions::ActionInvocationContext) {
          if (owner) ToggleTaiPanel(owner.get());
        }, browser->GetWeakPtr()))
        .SetActionId(TaiPanelActionId()).SetText(u"Agent")
        .SetTooltipText(LocalizedText16(browser->GetProfile(), "TAi Agent 浏览器工具", "TAi Agent browser tools"))
        .SetImage(ui::ImageModel::FromVectorIcon(vector_icons::kChatIcon, ui::kColorIcon, 20))
        .Build());
  }
  auto entry = std::make_unique<SidePanelEntry>(key, base::BindRepeating(
      [](std::shared_ptr<PanelState> state, SidePanelEntryScope& scope) -> SidePanelNativeView {
        return std::make_unique<TaiPanelView>(&scope.GetBrowserWindowInterface(), std::move(state));
      }, std::make_shared<PanelState>()), base::BindRepeating([] { return 380; }));
  // Use Chromium's same header/close lifecycle as extension entries.
  entry->set_should_show_header(true);
  entry->set_should_show_ephemerally_in_toolbar(false);
  return registry->Register(std::move(entry));
}
}
void RefreshTaiPanelLabels(BrowserWindowInterface* browser) {
  if (!browser || !Allowed(browser)) return;
  auto* browser_actions = BrowserActions::From(browser);
  if (!browser_actions) return;
  if (auto* action = actions::ActionManager::Get().FindAction(TaiPanelActionId(), browser_actions->root_action_item()))
    action->SetTooltipText(LocalizedText16(browser->GetProfile(), "TAi Agent 浏览器工具", "TAi Agent browser tools"));
}
actions::ActionId TaiPanelActionId() {
  return SidePanelEntryIdToActionId(SidePanelEntryId::kTai).value();
}
bool IsTaiPanelContents(content::WebContents* contents) {
  return contents && contents->GetUserData(kPanelContents);
}
bool SetTaiPanelVisible(BrowserWindowInterface* browser, bool visible) {
  if (!Allowed(browser)) return false;
  auto* panel = SidePanelUI::From(browser);
  if (!panel) return false;
  if (!visible) {
    if (panel->GetCurrentEntryId() == SidePanelEntryId::kTai) panel->Close();
    return true;
  }
  if (!EnsureEntry(browser)) return false;
  panel->Show(SidePanelEntryId::kTai, SidePanelOpenTrigger::kToolbarButton);
  return true;
}
bool ToggleTaiPanel(BrowserWindowInterface* browser) {
  if (!Allowed(browser)) return false;
  auto* panel = SidePanelUI::From(browser);
  return SetTaiPanelVisible(browser, !panel || panel->GetCurrentEntryId() != SidePanelEntryId::kTai);
}
base::DictValue DescribeTaiPanel(BrowserWindowInterface* browser, content::WebContents* caller) {
  base::DictValue result; result.Set("available", Allowed(browser));
  result.Set("embedded", IsTaiPanelContents(caller));
  if (!Allowed(browser)) return result;
  auto* panel = SidePanelUI::From(browser);
  result.Set("showing", panel && panel->GetCurrentEntryId() == SidePanelEntryId::kTai && panel->IsSidePanelShowing());
  if (auto* view = BrowserView::GetBrowserViewForBrowser(browser)) {
    if (auto* shell = view->side_panel()) {
      result.Set("panelVisible", panel && panel->IsSidePanelShowing());
      result.Set("rightAligned", shell->IsRightAligned());
      bool native_header = false;
      for (views::View* child : shell->children()) if (std::string_view(child->GetClassName()) == "SidePanelHeader") native_header = true;
      result.Set("nativeHeader", native_header);
    }
  }
  result.Set("windowId", browser->GetSessionID().id());
  result.Set("tabCount", browser->GetTabStripModel()->count());
  auto* workspace = WorkspaceState::ForProfile(browser->GetProfile());
  result.Set("profileId", workspace->profile_id());
  if (auto* sidebar = SpaceNavigationView::From(browser)) result.Set("activeSpaceId", sidebar->active_space_id());
  return result;
}
namespace {
class UnifiedPanelBackground final : public views::Background {
 public:
  explicit UnifiedPanelBackground(BrowserView& browser) : browser_(&browser) {}
  void Paint(gfx::Canvas* canvas, views::View* view) const override {
    PaintProductBackdrop(canvas, view, browser_);
    auto bounds = view->GetLocalBounds(); bounds.Inset(gfx::Insets::TLBR(0, 9, 9, 9));
    cc::PaintFlags flags; flags.setAntiAlias(true);
    flags.setColor(view->GetColorProvider()->GetColor(ui::kColorSysSurface));
    canvas->DrawRoundRect(gfx::RectF(bounds), 12, flags);
  }
 private:
  raw_ptr<BrowserView> browser_;
};
}
std::unique_ptr<views::Background> CreateUnifiedPanelBackground(BrowserView& browser) {
  return std::make_unique<UnifiedPanelBackground>(browser);
}
}
