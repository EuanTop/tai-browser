// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/agent_activity.h"

#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "build/build_config.h"
#include "base/i18n/rtl.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"
#include "components/vector_icons/vector_icons.h"
#if BUILDFLAG(IS_MAC)
#include "sidebar_browser/agent_icon_mac.h"
#endif
#include "sidebar_browser/host/page_identity.h"
#include "sidebar_browser/localization.h"
#include "sidebar_browser/sidebar_session.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/base/mojom/menu_source_type.mojom.h"
#include "ui/color/color_id.h"
#include "ui/events/event.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/gfx/text_elider.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/layout/flex_layout_types.h"
#include "ui/views/view_class_properties.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_observer.h"

namespace sidebar {
namespace {

constexpr int kAgentActivityChipId = 0x534245;
constexpr auto kRecentVisibleTime = base::Seconds(5);
constexpr auto kRecentBackgroundTime = base::Seconds(30);
constexpr size_t kMaxActive = 32;
constexpr size_t kMaxRecent = 8;

std::u16string SafeLabel(std::u16string_view label, size_t max_length) {
  auto text = gfx::TruncateString(base::CollapseWhitespace(label, false),
                                  max_length, gfx::CHARACTER_BREAK);
  base::i18n::SanitizeUserSuppliedString(&text);
  return text;
}

std::u16string ProviderLabel(std::string_view provider) {
  if (provider == "codex") return u"ChatGPT";
  if (provider == "claude") return u"Claude Code";
  if (provider == "pi") return u"Pi";
  return u"Agent";
}

ui::ImageModel ProviderIcon(std::string_view provider) {
#if BUILDFLAG(IS_MAC)
  auto icon = MacAgentIcon(provider);
  if (!icon.IsEmpty()) return icon;
#endif
  if (provider != "other") return {};
  return ui::ImageModel::FromVectorIcon(vector_icons::kCodeIcon,
                                       ui::kColorSysOnSurfaceVariant, 14);
}

struct Activity {
  uint64_t id = 0;
  std::string page_id;
  std::string space_id;
  std::u16string page_title;
  std::u16string space_name;
  std::string provider_key;
  std::u16string provider;
  std::u16string operation;
};

class AgentActivityChip final : public views::MdTextButton,
                                public views::WidgetObserver,
                                public ui::SimpleMenuModel::Delegate {
  METADATA_HEADER(AgentActivityChip, views::MdTextButton)

 public:
  AgentActivityChip() : views::MdTextButton({}, {}, views::style::CONTEXT_BUTTON_MD, false) {
    SetID(kAgentActivityChipId);
    SetVisible(false);
    SetStyle(ui::ButtonStyle::kText);
    SetHorizontalAlignment(gfx::ALIGN_LEFT);
    SetMaxSize(gfx::Size(236, 30));
    SetCustomPadding(gfx::Insets::TLBR(3, 6, 3, 9));
    SetCornerRadius(14);
    SetImageLabelSpacing(6);
    SetElideBehavior(gfx::ELIDE_TAIL);
    SetBgColorIdOverride(ui::kColorSysSurfaceVariant);
    SetEnabledTextColors(ui::kColorSysOnSurface);
    SetCallback(base::BindRepeating(&AgentActivityChip::Press,
                                    weak_factory_.GetWeakPtr()));
    SetProperty(views::kFlexBehaviorKey,
                views::FlexSpecification(
                    views::LayoutOrientation::kHorizontal,
                    views::MinimumFlexSizeRule::kScaleToZero,
                    views::MaximumFlexSizeRule::kPreferred)
                    .WithOrder(100));
    GetViewAccessibility().SetLiveRegionContainer(
        views::ViewAccessibility::LiveRegionStatus::kPolite);
  }

  base::ScopedClosureRunner Start(BrowserWindowInterface& window,
                                  Activity activity) {
    window_ = window.GetWeakPtr();
    const uint64_t id = ++next_id_;
    activity.id = id;
    if (active_.size() >= kMaxActive) active_.erase(active_.begin());
    hold_timer_.Stop();
    active_.emplace(id, std::move(activity));
    Render();
    return base::ScopedClosureRunner(
        base::BindOnce(&AgentActivityChip::Finish, weak_factory_.GetWeakPtr(), id));
  }

 private:
  void AddedToWidget() override {
    views::MdTextButton::AddedToWidget();
    widget_observation_.Observe(GetWidget());
  }

  void RemovedFromWidget() override {
    widget_observation_.Reset();
    views::MdTextButton::RemovedFromWidget();
  }

  void OnWidgetDestroying(views::Widget*) override {
    widget_observation_.Reset();
  }

  void OnWidgetActivationChanged(views::Widget*, bool active) override {
    if (active && active_.empty() && !recent_.empty()) {
      HoldRecent(kRecentVisibleTime);
    }
  }

  void Finish(uint64_t id) {
    auto entry = active_.find(id);
    if (entry == active_.end()) return;
    Activity finished = std::move(entry->second);
    active_.erase(entry);
    auto& recent = recent_[finished.page_id];
    if (recent.id < finished.id) recent = std::move(finished);
    if (recent_.size() > kMaxRecent) {
      const auto oldest = std::ranges::min_element(
          recent_, {}, [](const auto& pair) { return pair.second.id; });
      recent_.erase(oldest);
    }
    if (active_.empty()) {
      HoldRecent(GetWidget() && GetWidget()->IsActive() ? kRecentVisibleTime
                                                        : kRecentBackgroundTime);
    }
    Render();
  }

  void HoldRecent(base::TimeDelta duration) {
    hold_timer_.Start(FROM_HERE, duration,
                      base::BindOnce(&AgentActivityChip::HideRecent,
                                     weak_factory_.GetWeakPtr()));
  }

  void HideRecent() {
    recent_.clear();
    Render();
  }

  std::vector<Activity> Targets() const {
    auto pages = recent_;
    for (const auto& [id, activity] : active_) {
      auto& current = pages[activity.page_id];
      if (current.id < id) current = activity;
    }
    std::vector<Activity> sorted;
    for (const auto& [page, activity] : pages) sorted.push_back(activity);
    std::ranges::sort(sorted, std::greater<>(), &Activity::id);
    return sorted;
  }

  int TabIndex(const Activity& activity) const {
    auto* tabs = window_ ? window_->GetTabStripModel() : nullptr;
    if (!tabs) return TabStripModel::kNoTab;
    for (int i = 0; i < tabs->count(); ++i) {
      auto* contents = tabs->GetWebContentsAt(i);
      const auto* page = PageIdentity::FromWebContents(contents);
      const auto binding = ReadOrganization(contents);
      if (page && page->id() == activity.page_id && binding &&
          !binding->placeholder && binding->space_id == activity.space_id) {
        return i;
      }
    }
    return TabStripModel::kNoTab;
  }

  void GoTo(const Activity& activity) {
    const int index = TabIndex(activity);
    if (index != TabStripModel::kNoTab) {
      window_->GetTabStripModel()->ActivateTabAt(index);
    }
  }

  void Press(const ui::Event& event) {
    auto targets = Targets();
    std::erase_if(targets, [this](const auto& activity) {
      return TabIndex(activity) == TabStripModel::kNoTab;
    });
    if (targets.empty()) return;
    if (targets.size() == 1) {
      GoTo(targets.front());
      return;
    }
    if (menu_runner_ && menu_runner_->IsRunning()) return;
    menu_runner_.reset();
    menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
    menu_targets_ = std::move(targets);
    for (size_t i = 0; i < menu_targets_.size(); ++i) {
      const auto& activity = menu_targets_[i];
      menu_model_->AddItemWithIcon(static_cast<int>(i) + 1,
                                   SafeLabel(activity.page_title, 64),
                                   ProviderIcon(activity.provider_key));
      menu_model_->SetMinorText(i, base::StrCat(
          {activity.space_name, u" · ", activity.provider, u" · ", activity.operation}));
    }
    menu_runner_ = std::make_unique<views::MenuRunner>(
        menu_model_.get(), views::MenuRunner::NO_FLAGS);
    menu_runner_->RunMenuAt(
        GetWidget(), nullptr, GetBoundsInScreen(),
        views::MenuAnchorPosition::kTopRight,
        event.IsKeyEvent() ? ui::mojom::MenuSourceType::kKeyboard
                           : ui::mojom::MenuSourceType::kMouse);
  }

  void ExecuteCommand(int command, int flags) override {
    if (command > 0 && static_cast<size_t>(command) <= menu_targets_.size()) {
      GoTo(menu_targets_[command - 1]);
    }
  }

  void Render() {
    const auto targets = Targets();
    if (targets.empty()) {
      SetVisible(false);
      SetText({});
      SetTooltipText({});
      return;
    }
    auto* profile = window_ ? window_->GetProfile() : nullptr;
    const auto& latest = targets.front();
    SetImageModel(STATE_NORMAL, ProviderIcon(latest.provider_key));
    const auto details = base::StrCat(
        {latest.provider, u" · ", latest.operation, u" · ", latest.space_name,
         u" / ", latest.page_title});
    if (targets.size() == 1) {
      SetText(latest.page_title);
      SetTooltipText(details);
      GetViewAccessibility().SetName(details);
    } else {
      const auto count = base::NumberToString16(targets.size());
      const auto title = base::StrCat(
          {u"Agent · ", count, LocalizedText16(profile, " 个页面", " pages")});
      SetText(base::StrCat({title, u" ▾"}));
      SetTooltipText(LocalizedText16(profile, "查看 Agent 访问的页面",
                                     "Show pages visited by Agent"));
      GetViewAccessibility().SetName(title);
    }
    SetVisible(true);
  }

  uint64_t next_id_ = 0;
  base::WeakPtr<BrowserWindowInterface> window_;
  std::map<uint64_t, Activity> active_;
  std::map<std::string, Activity> recent_;
  std::vector<Activity> menu_targets_;
  std::unique_ptr<ui::SimpleMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
  base::OneShotTimer hold_timer_;
  base::ScopedObservation<views::Widget, views::WidgetObserver>
      widget_observation_{this};
  base::WeakPtrFactory<AgentActivityChip> weak_factory_{this};
};

BEGIN_METADATA(AgentActivityChip)
END_METADATA

}  // namespace

void AddAgentActivityChip(views::View& toolbar) {
  toolbar.AddChildView(std::make_unique<AgentActivityChip>());
}

base::ScopedClosureRunner ShowAgentPageActivity(
    BrowserWindowInterface& window,
    std::string_view provider,
    std::string_view space_id,
    std::string_view space_name,
    std::string_view page_id,
    std::u16string_view page_title,
    AgentPageActivity operation) {
  auto* view = BrowserView::GetBrowserViewForBrowser(&window);
  if (!view || !view->toolbar()) return {};
  auto* chip = static_cast<AgentActivityChip*>(
      view->toolbar()->GetViewByID(kAgentActivityChipId));
  if (!chip) return {};

  auto* profile = window.GetProfile();
  std::u16string verb;
  switch (operation) {
    case AgentPageActivity::kOpen:
      verb = LocalizedText16(profile, "打开页面", "Page open");
      break;
    case AgentPageActivity::kRead:
      verb = LocalizedText16(profile, "读取页面", "Page read");
      break;
    case AgentPageActivity::kAct:
      verb = LocalizedText16(profile, "操作页面", "Page action");
      break;
    case AgentPageActivity::kScreenshot:
      verb = LocalizedText16(profile, "网页截图", "Page screenshot");
      break;
  }
  return chip->Start(window,
      {0, std::string(page_id), std::string(space_id), SafeLabel(page_title, 90),
       SafeLabel(base::UTF8ToUTF16(space_name), 40), std::string(provider),
       ProviderLabel(provider),
       std::move(verb)});
}

}  // namespace sidebar
