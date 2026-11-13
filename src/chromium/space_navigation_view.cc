// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "build/build_config.h"
#include "sidebar_browser/space_navigation_view.h"
#include "sidebar_browser/shortcuts.h"
#include "sidebar_browser/internal_urls.h"
#if BUILDFLAG(IS_MAC)
#include "sidebar_browser/shortcuts_mac.h"
#include "sidebar_browser/global_search_mac.h"
#endif
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/views/event_monitor.h"
#include "sidebar_browser/host/native_panel.h"
#include "sidebar_browser/reload_menu.h"
#include "sidebar_browser/localization.h"
#include "extensions/buildflags/buildflags.h"
#if BUILDFLAG(ENABLE_EXTENSIONS_CORE)
#include "chrome/browser/extensions/extension_url_overrides.h"
#endif
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <set>
#include <string_view>
#include <utility>
#include "base/auto_reset.h"
#include "base/i18n/rtl.h"
#include "base/task/bind_post_task.h"
#include "base/no_destructor.h"
#include "base/logging.h"
#include "cc/paint/paint_flags.h"
#include "cc/paint/paint_shader.h"
#include "cc/paint/display_item_list.h"
#include "base/pickle.h"
#include "base/run_loop.h"
#include "base/timer/elapsed_timer.h"
#include "base/timer/timer.h"
#include "base/trace_event/trace_event.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/vertical_tab_strip_region_view.h"
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"
#include "chrome/browser/ui/views/location_bar/location_bar_view.h"
#include "chrome/browser/ui/omnibox/omnibox_view.h"
#include "chrome/browser/ui/views/frame/themed_background.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "ui/color/color_provider.h"
#include "chrome/browser/ui/views/frame/custom_corners_background.h"
#include "chrome/browser/ui/tabs/tab_model.h"
#include "ui/base/clipboard/clipboard_format_type.h"
#include "ui/base/dragdrop/drag_drop_types.h"
#include "ui/base/dragdrop/mojom/drag_drop_types.mojom.h"
#include "ui/base/dragdrop/drop_target_event.h"
#include "ui/base/dragdrop/os_exchange_data.h"
#include "ui/compositor/layer.h"
#include "ui/compositor/layer_solid_color.h"
#include "ui/compositor/layer_tree_owner.h"
#include "ui/compositor/scoped_layer_animation_settings.h"
#include "ui/gfx/animation/animation.h"
#include "ui/gfx/animation/animation_delegate.h"
#include "ui/gfx/animation/slide_animation.h"
#include "ui/gfx/geometry/transform.h"
#include "ui/views/animation/animation_builder.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/color_utils.h"
#include "ui/views/button_drag_utils.h"
#include "ui/views/bubble/bubble_dialog_delegate_view.h"
#include "ui/views/widget/widget.h"
#include "base/command_line.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/uuid.h"
#include "chrome/app/vector_icons/vector_icons.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/favicon/favicon_service_factory.h"
#include "components/favicon/core/favicon_service.h"
#include "components/favicon_base/favicon_types.h"
#include "chrome/browser/sessions/session_service.h"
#include "chrome/browser/sessions/session_service_factory.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "chrome/browser/ui/browser_live_tab_context.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/view_ids.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller.h"
#include "chrome/browser/ui/tabs/tab_group_model.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/vector_icons/vector_icons.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/web_contents.h"
#include "ui/color/color_provider_key.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider_manager.h"
#include "ui/color/color_mixer.h"
#include "ui/color/color_recipe.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents_observer.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColorSpace.h"
#include "ui/views/paint_info.h"
#include "base/strings/escape.h"
#include "sidebar_browser/workspace_state.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/base/mojom/menu_source_type.mojom.h"
#include "ui/events/event.h"
#include "ui/gfx/image/image.h"
#include "ui/native_theme/native_theme.h"
#include "ui/native_theme/overlay_scrollbar_constants.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/background.h"
#include "ui/views/border.h"
#include "ui/views/controls/button/image_button.h"
#include "ui/views/controls/button/image_button_factory.h"
#include "ui/views/controls/button/label_button.h"
#include "ui/views/controls/label.h"
#include "ui/views/controls/menu/menu_runner.h"
#include "ui/views/controls/scroll_view.h"
#include "ui/views/controls/scrollbar/overlay_scroll_bar.h"
#include "ui/views/controls/separator.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/view_tracker.h"
#include "ui/views/view_class_properties.h"
#include "ui/views/view_observer.h"
#include "ui/views/view_utils.h"

namespace sidebar {
namespace {
constexpr int kSpaceSlideOffset = 36;
constexpr auto kSpaceSlideDuration = base::Milliseconds(200);
// Stedding Spaces B32/B35 timing and gesture geometry.
constexpr float kSwipeAxisLock = 15.f;
constexpr float kSwipeCommitDistance = 75.f;
constexpr float kSwipeFlickDistance = 16.f;
constexpr float kSwipeFlickSpeed = 0.5f;
constexpr auto kSwipeFlickWindow = base::Milliseconds(80);
constexpr auto kSwipeFlickMinimumSpan = base::Milliseconds(20);
constexpr float kSwipeEntryShare = 0.4f;
constexpr float kSwipeEntryOpacity = 0.4f;
constexpr float kSwipeEdgeGive = 40.f;
constexpr auto kSwipeEntryDuration = base::Milliseconds(240);
constexpr auto kSwipeReturnDuration = base::Milliseconds(180);
constexpr int kRename = 1, kFolder = 2, kSave = 3, kFavorite = 4,
              kRemove = 5, kClose = 6, kNewSpace = 7, kMoveRoot = 8, kAppearance = 9, kNewWindow = 10, kSettings = 11, kSpaceIcon = 12,
              kToggleFolder = 13, kCloseFolderTabs = 14, kMoveFolderToSpace = 15,
              kMoveFolderBase = 100, kSwitchSpaceBase = 100000,
              kMoveFolderToSpaceBase = 200000;
std::string NewId() { return base::Uuid::GenerateRandomV4().AsLowercaseString(); }
// The pinned Chromium keeps 25 recently closed entries. Keep each clear below
// that limit rather than silently claiming that an arbitrary batch is undoable.
constexpr int kClearBatchLimit = 20;
constexpr int kDockLeftInset = 16, kDockRightInset = 8;

struct SpaceDockLayout {
  bool compact;
  int slots;
  bool operator==(const SpaceDockLayout&) const = default;
};

SpaceDockLayout GetSpaceDockLayout(int width, int count, bool collapsed) {
  if (collapsed) return {false, 1};
  const int reserved = kDockLeftInset + kDockRightInset + 2 * 28 + 3;
  const int available = std::max(width - reserved, 0);
  const int regular_slots = std::clamp(available / 33, 1, 14);
  if (count <= regular_slots) return {false, count};
  return {true, std::min(count, std::clamp(1 + (available - 28 - 33) / 16, 1, 16))};
}
std::u16string CleanName(std::u16string_view text) {
  std::u16string name(text);
  base::TrimWhitespace(name, base::TRIM_ALL, &name);
  if (name.size() > 80) name.resize(80);
  return name;
}
// Chromium updates the scrollbar layer whenever the thumb bounds change.
// Gate its thumb layer separately so only vertical input can reveal the rail.
class SidebarScrollBar final : public views::OverlayScrollBar {
 public:
  METADATA_HEADER(SidebarScrollBar, views::OverlayScrollBar)
 public:
  SidebarScrollBar() : OverlayScrollBar(Orientation::kVertical) {
    GetThumb()->layer()->SetOpacity(0.f);
    SetCanProcessEventsWithinSubtree(false);
  }
  int GetThickness() const override { return 8; }

  bool OnMouseWheel(const ui::MouseWheelEvent& event) override {
    RevealForScroll(event.x_offset(), event.y_offset());
    return OverlayScrollBar::OnMouseWheel(event);
  }

  void ObserveScrollEvent(const ui::ScrollEvent& event) override {
    OverlayScrollBar::ObserveScrollEvent(event);
    if (event.type() == ui::EventType::kScroll)
      RevealForScroll(event.x_offset(), event.y_offset());
  }

  void OnGestureEvent(ui::GestureEvent* event) override {
    if (event->type() == ui::EventType::kGestureScrollUpdate)
      RevealForScroll(event->details().scroll_x(), event->details().scroll_y());
    OverlayScrollBar::OnGestureEvent(event);
  }

  bool IsThumbRevealed() const {
    return GetThumb()->layer()->GetTargetOpacity() > 0.f;
  }

 private:
  void RevealForScroll(float x, float y) {
    if (!GetVisible() || GetMaxPosition() == 0 || std::abs(y) <= std::abs(x))
      return;
    layer()->SetOpacity(1.f);
    GetThumb()->layer()->SetOpacity(1.f);
    SetCanProcessEventsWithinSubtree(true);
    ScheduleHide();
  }

  void ScheduleHide() {
    idle_timer_.Start(FROM_HERE, ui::GetOverlayScrollbarFadeDelay(), this,
                      &SidebarScrollBar::HideWhenIdle);
  }

  void HideWhenIdle() {
    if (GetVisible() &&
        (IsMouseHovered() || (GetWidget() && GetWidget()->HasCapture()))) {
      ScheduleHide();
      return;
    }
    SetCanProcessEventsWithinSubtree(false);
    auto* thumb_layer = GetThumb()->layer();
    ui::ScopedLayerAnimationSettings fade(thumb_layer->GetAnimator());
    fade.SetTransitionDuration(base::Milliseconds(160));
    thumb_layer->SetOpacity(0.f);
  }

  base::OneShotTimer idle_timer_;
};
BEGIN_METADATA(SidebarScrollBar)
END_METADATA

class SidebarButton : public views::LabelButton {
 public:
  METADATA_HEADER(SidebarButton, views::LabelButton)
 public:
  using views::LabelButton::label;
  SidebarButton(PressedCallback callback, std::u16string text, bool selected,
                bool dark, int radius = 8, bool paint_background = true)
      : views::LabelButton(std::move(callback), text),
        selected_(selected), dark_(dark), radius_(radius),
        paint_background_(paint_background) {
    SetHorizontalAlignment(text.empty() ? gfx::ALIGN_CENTER : gfx::ALIGN_LEFT);
    SetImageLabelSpacing(text.empty() ? 0 : 10);
    SetBorder(views::CreateEmptyBorder(gfx::Insets::VH(6, 9)));
    SetMinSize(gfx::Size(0, 38));
    label()->SetFontList(label()->font_list().DeriveWithSizeDelta(2));
    label()->SetElideBehavior(gfx::ELIDE_TAIL);
    label()->SetSubpixelRenderingEnabled(false);
    // Colors follow the Space palette, including in inactive windows.
    label()->SetAutoColorReadabilityEnabled(false);
    SetAppearDisabledInInactiveWidget(false);
    SetEnabledTextColors(dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53));
    UpdateBackground();
  }
  void SetDropMark(int mark) { drop_mark_ = mark; SchedulePaint(); }
  void PaintButtonContents(gfx::Canvas* canvas) override {
    views::LabelButton::PaintButtonContents(canvas);
    if (!drop_mark_) return;
    const SkColor color = dark_ ? SK_ColorWHITE : SkColorSetRGB(54, 76, 150);
    gfx::Rect bounds = GetLocalBounds(); bounds.Inset(1);
    if (drop_mark_ == 1) bounds.set_height(2);
    else if (drop_mark_ == 2) { bounds.set_y(bounds.bottom()-2); bounds.set_height(2); }
    if (drop_mark_ < 3) canvas->FillRect(bounds, color);
    else { cc::PaintFlags flags; flags.setColor(color); flags.setStyle(cc::PaintFlags::kStroke_Style);
      flags.setStrokeWidth(2); flags.setAntiAlias(true); canvas->DrawRoundRect(gfx::RectF(bounds), 7, flags); }
  }
  void StateChanged(ButtonState old) override {
    views::LabelButton::StateChanged(old); UpdateBackground();
  }
 private:
  void UpdateBackground() {
    if (!paint_background_) return;
    const bool hovered = GetState() == STATE_HOVERED || GetState() == STATE_PRESSED;
    if (selected_ || hovered) {
      SetBackground(views::CreateRoundedRectBackground(
          SkColorSetARGB(dark_ ? (selected_ ? 45 : 25) : (selected_ ? 180 : 75),
                         255, 255, 255), radius_));
    } else { SetBackground(nullptr); }
  }
  int drop_mark_ = 0;
  const bool selected_, dark_;
  const int radius_;
  const bool paint_background_;
};
BEGIN_METADATA(SidebarButton)
END_METADATA

constexpr int kTabRowActionWidth = 26;
constexpr int kTabRowActionHeight = 28;
constexpr int kTabRowActionInset = 5;

class TabRowCloseButton final : public views::ImageButton {
  METADATA_HEADER(TabRowCloseButton, views::ImageButton)

 public:
  TabRowCloseButton(PressedCallback callback, bool saved, SkColor ink,
                    std::u16string label)
      : views::ImageButton(std::move(callback)), ink_(ink) {
    SetImageHorizontalAlignment(ALIGN_CENTER);
    SetImageVerticalAlignment(ALIGN_MIDDLE);
    SetImageModel(STATE_NORMAL, ui::ImageModel::FromVectorIcon(
                                    saved ? kRemoveIcon : kCloseIcon, ink, 14));
    SetTooltipText(label);
    GetViewAccessibility().SetName(label);
    SetFocusBehavior(FocusBehavior::ALWAYS);
    SetRequestFocusOnPress(false);
  }

 private:
  void StateChanged(ButtonState old_state) override {
    ImageButton::StateChanged(old_state);
    SchedulePaint();
  }

  void OnPaintBackground(gfx::Canvas* canvas) override {
    if (GetState() != STATE_HOVERED && GetState() != STATE_PRESSED &&
        !HasFocus()) {
      return;
    }
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(SkColorSetA(ink_, GetState() == STATE_PRESSED ? 49 : 30));
    canvas->DrawCircle(gfx::PointF(GetLocalBounds().CenterPoint()), 10, flags);
  }

  const SkColor ink_;
};
BEGIN_METADATA(TabRowCloseButton)
END_METADATA

class TabRow final : public views::View, public views::ViewObserver {
  METADATA_HEADER(TabRow, views::View)

 public:
  TabRow(views::Button::PressedCallback activate,
         views::Button::PressedCallback close, std::u16string title,
         std::u16string close_label, bool selected, bool dark,
         bool collapsed, bool saved, int depth)
      : selected_(selected), dark_(dark) {
    SetBorder(views::CreateEmptyBorder(gfx::Insets::TLBR(0, depth * 12, 0, 0)));
    SetUseDefaultFillLayout(true);
    SetNotifyEnterExitOnChild(true);
    title_button_ = AddChildView(std::make_unique<SidebarButton>(
        std::move(activate), collapsed ? std::u16string() : title,
        false, dark, 8, false));
    if (close) title_button_->SetFocusBehavior(FocusBehavior::ALWAYS);
    title_button_->SetTooltipText(title);
    if (collapsed) {
      title_button_->GetViewAccessibility().SetName(title);
    } else {
      // Reserve the trailing slot in every row, including swipe previews.
      title_button_->SetBorder(views::CreateEmptyBorder(gfx::Insets::TLBR(
          6, 9, 6, kTabRowActionWidth + kTabRowActionInset + 3)));
      if (close) {
        close_button_ = AddChildView(std::make_unique<TabRowCloseButton>(
            std::move(close), saved,
            dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53),
            std::move(close_label)));
        close_button_->SetProperty(views::kViewIgnoredByLayoutKey, true);
        close_button_->SetVisible(false);
        close_button_->AddObserver(this);
      }
    }
    title_button_->AddObserver(this);
    title_state_subscription_ = title_button_->AddStateChangedCallback(
        base::BindRepeating(&TabRow::UpdateAppearance, base::Unretained(this)));
  }

  ~TabRow() override {
    title_button_->RemoveObserver(this);
    if (close_button_) close_button_->RemoveObserver(this);
  }

  SidebarButton* title_button() const { return title_button_; }

 private:
  void OnBoundsChanged(const gfx::Rect& previous_bounds) override {
    if (!close_button_) return;
    const auto content = GetContentsBounds();
    close_button_->SetBounds(
        std::max(content.x(),
                 content.right() - kTabRowActionWidth - kTabRowActionInset),
        content.y() + (content.height() - kTabRowActionHeight) / 2,
        kTabRowActionWidth, kTabRowActionHeight);
  }

  void OnMouseEntered(const ui::MouseEvent& event) override {
    hovered_ = true;
    UpdateAppearance();
  }

  void OnMouseExited(const ui::MouseEvent& event) override {
    hovered_ = false;
    UpdateAppearance();
  }

  void OnViewFocused(views::View* view) override { UpdateAppearance(); }
  void OnViewBlurred(views::View* view) override { UpdateAppearance(); }

  void UpdateAppearance() {
    if (close_button_) {
      const bool show_close =
          hovered_ || title_button_->HasFocus() || close_button_->HasFocus();
      if (close_button_->GetVisible() != show_close)
        close_button_->SetVisible(show_close);
    }
    SchedulePaint();
  }

  void OnPaintBackground(gfx::Canvas* canvas) override {
    const bool pressed = title_button_->GetState() == views::Button::STATE_PRESSED;
    const bool emphasized = hovered_ || title_button_->HasFocus() ||
                            (close_button_ && close_button_->HasFocus());
    if (!selected_ && !emphasized && !pressed) return;
    int alpha = dark_ ? 22 : 70;
    if (selected_) alpha = dark_ ? 45 : 180;
    if (pressed) alpha += dark_ ? 12 : 24;
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(SkColorSetARGB(alpha, 255, 255, 255));
    const auto bounds = GetMirroredRect(GetContentsBounds());
    canvas->DrawRoundRect(gfx::RectF(bounds), 8, flags);
  }

  const bool selected_;
  const bool dark_;
  bool hovered_ = false;
  raw_ptr<SidebarButton> title_button_;
  raw_ptr<TabRowCloseButton> close_button_ = nullptr;
  base::CallbackListSubscription title_state_subscription_;
};
BEGIN_METADATA(TabRow)
END_METADATA

class NewTabButton final : public SidebarButton {
  METADATA_HEADER(NewTabButton, SidebarButton)
 public:
  NewTabButton(PressedCallback callback, std::u16string label, bool dark)
      : SidebarButton(std::move(callback), std::move(label), false, dark, 14),
        ink_(dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53)) {
    SetMinSize(gfx::Size(0, 40));
    UpdateInk();
  }

 private:
  void StateChanged(ButtonState old_state) override {
    SidebarButton::StateChanged(old_state);
    UpdateInk();
  }
  void OnFocus() override {
    SidebarButton::OnFocus();
    UpdateInk();
  }
  void OnBlur() override {
    SidebarButton::OnBlur();
    UpdateInk();
  }
  void UpdateInk() {
    const bool emphasized = HasFocus() || GetState() == STATE_HOVERED ||
                            GetState() == STATE_PRESSED;
    const SkColor color = emphasized ? ink_ : SkColorSetA(ink_, 160);
    SetEnabledTextColors(color);
    SetImageModel(STATE_NORMAL, ui::ImageModel::FromVectorIcon(kAddIcon, color, 20));
  }

  const SkColor ink_;
};
BEGIN_METADATA(NewTabButton)
END_METADATA

class SpaceDockButton final : public SidebarButton {
  METADATA_HEADER(SpaceDockButton, SidebarButton)
 public:
  SpaceDockButton(PressedCallback callback, std::u16string icon,
                  bool selected, bool compact, bool dark)
      : SidebarButton(std::move(callback), std::move(icon), selected, dark),
        compact_(compact), dark_(dark) {
    const gfx::Size size(compact ? 15 : 32, 32);
    SetBorder(views::CreateEmptyBorder(gfx::Insets()));
    SetMinSize(size);
    SetPreferredSize(size);
    SetHorizontalAlignment(gfx::ALIGN_CENTER);
    label()->SetFontList(label()->font_list().DeriveWithSizeDelta(compact ? -3 : 2));
    if (compact_) {
      label()->SetPaintToLayer();
      label()->layer()->SetFillsBoundsOpaquely(false);
      label()->layer()->SetOpacity(0.f);
      reveal_.SetSlideDuration(base::Milliseconds(140));
    }
  }

  void StateChanged(ButtonState old_state) override {
    SidebarButton::StateChanged(old_state);
    UpdateReveal();
  }

  void OnFocus() override {
    SidebarButton::OnFocus();
    UpdateReveal();
  }

  void OnBlur() override {
    SidebarButton::OnBlur();
    UpdateReveal();
  }

  void PaintButtonContents(gfx::Canvas* canvas) override {
    SidebarButton::PaintButtonContents(canvas);
    if (!compact_) return;
    const float value = reveal_.GetCurrentValue();
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(SkColorSetA(dark_ ? SK_ColorWHITE : SkColorSetRGB(40, 47, 81),
                              static_cast<uint8_t>(154 * (1.f - value))));
    canvas->DrawCircle(gfx::PointF(width() / 2.f, height() / 2.f),
                       2.5f - value, flags);
  }

 private:
  void AnimationProgressed(const gfx::Animation* animation) override {
    if (animation != &reveal_) {
      SidebarButton::AnimationProgressed(animation);
      return;
    }
    label()->layer()->SetOpacity(reveal_.GetCurrentValue());
    SchedulePaint();
  }

  void UpdateReveal() {
    if (!compact_) return;
    const bool revealed = GetState() == STATE_HOVERED ||
                          GetState() == STATE_PRESSED || HasFocus();
    if (!gfx::Animation::ShouldRenderRichAnimation()) {
      reveal_.Reset(revealed ? 1 : 0);
      AnimationProgressed(&reveal_);
    } else if (revealed) {
      reveal_.Show();
    } else {
      reveal_.Hide();
    }
  }

  const bool compact_;
  const bool dark_;
  gfx::SlideAnimation reveal_{this};
};
BEGIN_METADATA(SpaceDockButton)
END_METADATA

std::unique_ptr<SidebarButton> IconButton(views::Button::PressedCallback callback,
    const gfx::VectorIcon& icon, bool dark, int size = 18) {
  auto button = std::make_unique<SidebarButton>(std::move(callback), std::u16string(), false, dark);
  button->SetBorder(views::CreateEmptyBorder(gfx::Insets()));
  button->SetMinSize(gfx::Size());
  button->SetImageModel(views::Button::STATE_NORMAL, ui::ImageModel::FromVectorIcon(
      icon, dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53), size));
  return button;
}
void TraceDrag(std::string_view message) {
  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser-drag-trace"))
    LOG(WARNING) << "Sidebar drag: " << message;
}
views::BoxLayoutView* Row(views::View* parent, int gap = 2) {
  auto* row = parent->AddChildView(std::make_unique<views::BoxLayoutView>());
  row->SetBetweenChildSpacing(gap);
  row->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  return row;
}

class SpaceChooserBubble final : public views::BubbleDialogDelegate {
 public:
  SpaceChooserBubble(Profile* profile, views::View* anchor,
                     const std::vector<WorkspaceSpace>& spaces,
                     const std::string& active_id, bool dark,
                     base::RepeatingCallback<void(std::string)> select)
      : views::BubbleDialogDelegate(anchor, views::BubbleBorder::BOTTOM_LEFT) {
    SetTitle(LocalizedText16(profile, "所有 Space", "All Spaces"));
    SetButtons(static_cast<int>(ui::mojom::DialogButton::kNone));
    auto scroll = std::make_unique<views::ScrollView>();
    scroll->SetHorizontalScrollBarMode(views::ScrollView::ScrollBarMode::kDisabled);
    scroll->SetBackgroundColor(std::nullopt);
    scroll->ClipHeightTo(0, 334);
    auto* contents = scroll->SetContents(std::make_unique<views::BoxLayoutView>());
    contents->SetOrientation(views::BoxLayout::Orientation::kVertical);
    contents->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
    contents->SetBetweenChildSpacing(4);
    contents->SetInsideBorderInsets(gfx::Insets::TLBR(2, 0, 4, 4));
    for (const auto& space : spaces) {
      const bool active = space.id == active_id;
      auto* row = Row(contents, 4);
      row->SetPreferredSize(gfx::Size(256, 35));
      if (active) {
        row->SetBackground(views::CreateRoundedRectBackground(
            dark ? SkColorSetRGB(60, 61, 79) : SkColorSetRGB(232, 233, 248), 9));
      }
      auto* swatch = row->AddChildView(std::make_unique<views::View>());
      swatch->SetPreferredSize(gfx::Size(4, 22));
      const SkColor color = space.color ? space.color :
          (dark ? SkColorSetRGB(152, 156, 208) : SkColorSetRGB(117, 123, 180));
      swatch->SetBackground(views::CreateRoundedRectBackground(color, 2));
      auto* button = row->AddChildView(std::make_unique<SidebarButton>(
          base::BindRepeating(select, space.id),
          base::UTF8ToUTF16(space.icon + "  " + space.name), false, dark));
      button->SetMinSize(gfx::Size(0, 35));
      button->GetViewAccessibility().SetName(base::UTF8ToUTF16(space.name));
      button->GetViewAccessibility().SetIsSelected(active);
      button->SetTooltipText(base::UTF8ToUTF16(space.name));
      row->SetFlexForView(button, 1, true);
    }
    SetContentsView(std::move(scroll));
  }
};
// The operating system carries an opaque nonce. It never supplies a trusted
// pointer, tab handle or profile identifier to our drop handler.
struct SidebarDrag {
  std::string nonce, key;
  base::WeakPtr<SpaceNavigationView> source;
};
SidebarDrag& CurrentDrag() {
  static base::NoDestructor<SidebarDrag> drag;
  return *drag;
}
const ui::ClipboardFormatType& SidebarDragFormat() {
  static const base::NoDestructor<ui::ClipboardFormatType> format(
      ui::ClipboardFormatType::CustomPlatformType("org.sidebar-browser.tab"));
  return *format;
}
// One widget-space spectrum, shared by frame and sidebar. A vertical wash
// keeps the reading area calm without reducing Pride to a purple solid fill.
void PaintSidebarBackdrop(gfx::Canvas* canvas, const views::View* view,
                          const SpaceNavigationView* sidebar,
                          const SkPath* path = nullptr) {
  cc::PaintFlags flags; flags.setAntiAlias(true); flags.setColor(sidebar->SidebarColor());
  const auto draw = [&] { if (path) canvas->DrawPath(*path, flags); else canvas->DrawRect(view->GetLocalBounds(), flags); };
  if (!sidebar->HasPrideBackdrop() || !view->GetWidget()) { draw(); return; }
  gfx::Point origin;
  views::View::ConvertPointToTarget(view, view->GetWidget()->GetRootView(), &origin);
  gfx::Point sidebar_origin;
  views::View::ConvertPointToTarget(sidebar, view->GetWidget()->GetRootView(),
                                    &sidebar_origin);
  const float start = sidebar_origin.x() - origin.x();
  const float width = std::max(1, sidebar->width());
  const SkPoint points[] = {{start, 0}, {start + width, 0}};
  const bool dark = sidebar->IsDark();
  const std::array<SkColor,6> light = {0xFFEBD7E2,0xFFF4DEC9,0xFFF0E8C9,0xFFD5E9DE,0xFFC9DDF3,0xFFE0D2F2};
  const std::array<SkColor,6> night = {0xFF493446,0xFF524137,0xFF494631,0xFF2B473D,0xFF31466A,0xFF45345D};
  std::array<SkColor4f,6> spectrum;
  for (int i=0;i<6;++i) spectrum[i] = SkColor4f::FromColor(dark ? night[i] : light[i]);
  flags.setColor(SK_ColorWHITE);
  flags.setShader(cc::PaintShader::MakeLinearGradient(points,spectrum.data(),nullptr,6,SkTileMode::kClamp)); draw();
  const auto base = sidebar->SidebarColor();
  const SkColor4f wash[] = {SkColor4f::FromColor(SkColorSetA(base,55)), SkColor4f::FromColor(base)};
  const SkPoint vertical[] = {{0,-static_cast<float>(origin.y())},{0,580.0f-origin.y()}};
  flags.setShader(cc::PaintShader::MakeLinearGradient(vertical,wash,nullptr,2,SkTileMode::kClamp)); draw();
}
class SidebarBackdrop final : public views::Background {
 public:
  explicit SidebarBackdrop(SpaceNavigationView* sidebar) : sidebar_(sidebar) {}
  void Paint(gfx::Canvas* canvas, views::View* view) const override { PaintSidebarBackdrop(canvas,view,sidebar_); }
 private:
  raw_ptr<SpaceNavigationView> sidebar_;
};
// Reuse Chromium's complete toolbar/omnibox palettes rather than manually
// inventing text, hover, focus, disabled and security-warning colors. The
// window's key.color_mode stays unchanged: it also drives webpage media queries.
#include "ui/color/color_id_map_macros.inc"
constexpr std::pair<ui::ColorId, std::string_view> kChromePaletteColors[] = {CHROME_COLOR_IDS};
#include "ui/color/color_id_map_macros.inc"
constexpr int kPageAccentHues = 12;

int PageAccentIndex(SkColor canvas, SkColor space_color, bool pride) {
  const auto channels = {SkColorGetR(canvas), SkColorGetG(canvas), SkColorGetB(canvas)};
  const auto [low, high] = std::minmax(channels);
  if (high - low >= 20) space_color = canvas;
  if (!space_color) return pride ? 9 : 8;
  color_utils::HSL hsl;
  color_utils::SkColorToHSL(space_color, &hsl);
  return hsl.s >= 0.08 ? static_cast<int>(hsl.h * kPageAccentHues) % kPageAccentHues
                       : (pride ? 9 : 8);
}

class PageChromePalette final : public ui::ColorProviderKey::InitializerSupplier {
 public:
  PageChromePalette(bool dark, int accent) : dark_(dark),
      focus_color_(color_utils::HSLToSkColor(
          {(accent + 0.5) / kPageAccentHues, 0.43, dark ? 0.76 : 0.36},
          SK_AlphaOPAQUE)) {}
  void AddColorMixers(ui::ColorProvider* provider, const ui::ColorProviderKey& key) const override {
    auto reference_key = key;
    reference_key.app_controller = nullptr;
    reference_key.color_mode = dark_ ? ui::ColorProviderKey::ColorMode::kDark
                                     : ui::ColorProviderKey::ColorMode::kLight;
    const auto* reference = ui::ColorProviderManager::Get().GetColorProviderFor(reference_key);
    auto& mixer = provider->AddMixer();
    for (const auto& [id, name] : kChromePaletteColors) {
      if (name.starts_with("kColorToolbar") || name.starts_with("kColorOmnibox") ||
          name.starts_with("kColorLocationBar")) mixer[id] = {reference->GetColor(id)};
    }
    // Views and the WebUI toolbar use different Chromium focus tokens.
    mixer[ui::kColorFocusableBorderFocused] = {focus_color_};
    mixer[ui::kColorSysStateFocusRing] = {focus_color_};
  }
 private:
  const bool dark_;
  const SkColor focus_color_;
};
class PageChromeEdgeBackground final : public views::Background {
 public:
  PageChromeEdgeBackground(BrowserView& browser, bool layer_based)
      : browser_(&browser), layer_based_(layer_based) {}
  void Paint(gfx::Canvas* canvas, views::View* view) const override {
    canvas->DrawColor(Color(view));
  }
  void OnViewThemeChanged(views::View* view) override {
    if (layer_based_) {
      if (!view->layer()) view->SetPaintToLayer(ui::LAYER_SOLID_COLOR);
      view->layer()->AsSolidColor()->SetColor(SkColor4f::FromColor(Color(view)));
    }
    view->SchedulePaint();
  }
 private:
  SkColor Color(views::View* view) const {
    return PageChromeColor(browser_).value_or(
        view->GetColorProvider()->GetColor(kColorToolbarContentAreaSeparator));
  }
  raw_ptr<BrowserView> browser_;
  const bool layer_based_;
};
class SidebarFrameBackground final : public CustomCornersBackground {
 public:
  SidebarFrameBackground(views::View& view, BrowserView& browser, bool toolbar = false)
      : CustomCornersBackground(view, browser, toolbar ? ColorChoice(ToolbarTheme()) : ColorChoice(FrameTheme()),
                                toolbar ? ColorChoice(FrameTheme()) : ColorChoice(ToolbarTheme())), browser_(&browser), toolbar_(toolbar) {}
  void Paint(gfx::Canvas* canvas, views::View* view) const override {
    if (!is_visible()) return;
    auto* sidebar = SpaceNavigationView::From(browser_->browser());
    if (!sidebar || toolbar_) { CustomCornersBackground::Paint(canvas, view); return; }
    const auto path = GetBackgroundPath();
    PaintSidebarBackdrop(canvas,view,sidebar,&path);
  }
 private:
  raw_ptr<BrowserView> browser_;
  const bool toolbar_;
};
class SpaceAppearanceBubble final : public views::BubbleDialogDelegate {
 public:
  SpaceAppearanceBubble(Profile* profile, views::View* anchor, std::string value,
                       base::RepeatingCallback<bool(std::string)> apply)
      : views::BubbleDialogDelegate(anchor, views::BubbleBorder::TOP_LEFT), profile_(profile) {
    SetTitle(LocalizedText16(profile_, "Space 颜色", "Space color"));
    SetButtonLabel(ui::mojom::DialogButton::kOk, LocalizedText16(profile_, "应用", "Apply"));
    SetButtonLabel(ui::mojom::DialogButton::kCancel, LocalizedText16(profile_, "取消", "Cancel"));
    auto* contents = SetContentsView(std::make_unique<views::BoxLayoutView>());
    contents->SetOrientation(views::BoxLayout::Orientation::kVertical);
    contents->SetBetweenChildSpacing(12);
    contents->SetInsideBorderInsets(gfx::Insets(8));
    field_ = contents->AddChildView(std::make_unique<views::Textfield>());
    field_->SetText(base::UTF8ToUTF16(value)); field_->SetPlaceholderText(u"#RRGGBB");
    field_->GetViewAccessibility().SetName(LocalizedText16(profile_, "颜色代码（#RRGGBB，留空恢复默认）", "Color code (#RRGGBB; leave empty for default)"));
    field_->SetPreferredSize(gfx::Size(300, 32));
    auto* palette = Row(contents, 6);
    for (const auto* hex : {"#E6E6DE", "#CCDDF2", "#D8CCE9", "#EFCED6",
                            "#EAD8AC", "#CDDECD", "#52616D", "#35333F"}) {
      auto* swatch = palette->AddChildView(std::make_unique<views::LabelButton>(
          base::BindRepeating([](views::Textfield* field, std::string color) {
            field->SetText(base::UTF8ToUTF16(color));
          }, base::Unretained(field_.get()), std::string(hex))));
      swatch->SetPreferredSize(gfx::Size(30, 30)); swatch->SetTooltipText(base::UTF8ToUTF16(hex));
      swatch->SetBackground(views::CreateRoundedRectBackground(*ParseSpaceColor(hex), 15));
    }
    auto* hint = contents->AddChildView(std::make_unique<views::Label>(LocalizedText16(profile_, "选择色板或输入颜色代码；留空恢复默认。", "Choose a swatch or enter a color code. Leave empty for default.")));
    hint->SetSubpixelRenderingEnabled(false);
    error_ = contents->AddChildView(std::make_unique<views::Label>());
    error_->SetSubpixelRenderingEnabled(false);
    SetAcceptCallbackWithClose(base::BindRepeating(
        [](SpaceAppearanceBubble* self, base::RepeatingCallback<bool(std::string)> apply) {
          auto value = base::UTF16ToUTF8(self->field_->GetText());
          base::TrimWhitespaceASCII(value, base::TRIM_ALL, &value);
          if (!ParseSpaceColor(value)) { self->error_->SetText(LocalizedText16(self->profile_, "请输入 #RRGGBB 格式的颜色。", "Enter a color in #RRGGBB format.")); return false; }
          return apply.Run(std::move(value));
        }, base::Unretained(this), std::move(apply)));
  }
 private:
  raw_ptr<Profile> profile_;
  raw_ptr<views::Textfield> field_;
  raw_ptr<views::Label> error_;
};

}  // namespace

class FolderRevealView final : public views::View, public gfx::AnimationDelegate {
 public:
  METADATA_HEADER(FolderRevealView, views::View)
 public:
  FolderRevealView(int child_depth, bool expanded)
      : child_depth_(child_depth), expanded_(expanded) {
    contents_ = AddChildView(std::make_unique<views::BoxLayoutView>());
    contents_->SetOrientation(views::BoxLayout::Orientation::kVertical);
    contents_->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
    contents_->SetBetweenChildSpacing(3);
    // A normal View clips its children as it paints. Keep the subtree in the
    // Space's layer so its rows stay part of the same Space swipe.
    reveal_.SetSlideDuration(base::Milliseconds(200));
    reveal_.SetTweenType(gfx::Tween::EASE_IN_OUT);
    Finish();
  }
  ~FolderRevealView() override = default;

  views::BoxLayoutView* contents() const { return contents_; }
  int child_depth() const { return child_depth_; }
  bool is_animating() const { return reveal_.is_animating(); }
  void SetExpanded(bool expanded, bool animate, base::OnceClosure finished) {
    expanded_ = expanded;
    if (!animate) {
      Finish();
      return;
    }
    finished_ = std::move(finished);
    SetVisible(true);
    SetCanProcessEventsWithinSubtree(false);
    if (expanded_) reveal_.Show();
    else reveal_.Hide();
    if (!reveal_.is_animating()) AnimationEnded(&reveal_);
  }
  void Finish() {
    finished_.Reset();
    reveal_.Reset(expanded_ ? 1.0 : 0.0);
    Settle();
  }

 private:
  void Settle() {
    SetVisible(expanded_);
    SetCanProcessEventsWithinSubtree(expanded_);
    PreferredSizeChanged();
  }
  gfx::Size CalculatePreferredSize(const views::SizeBounds& available) const override {
    auto size = contents_->GetPreferredSize(views::SizeBounds(available.width(), {}));
    size.set_height(std::lround(size.height() * reveal_.GetCurrentValue()));
    return size;
  }
  void Layout(PassKey) override {
    contents_->SetBounds(0, 0, width(), contents_->GetHeightForWidth(width()));
    LayoutSuperclass<views::View>(this);
  }
  void AnimationProgressed(const gfx::Animation*) override {
    PreferredSizeChanged();
  }
  void AnimationEnded(const gfx::Animation*) override {
    Settle();
    if (finished_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, std::move(finished_));
    }
  }

  const int child_depth_;
  bool expanded_;
  base::OnceClosure finished_;
  raw_ptr<views::BoxLayoutView> contents_;
  gfx::SlideAnimation reveal_{this};
};
BEGIN_METADATA(FolderRevealView)
END_METADATA

namespace {
constexpr int kPageEdgeSamples = 128;

bool SimilarColors(SkColor a, SkColor b, int tolerance = 10) {
  const auto close = [tolerance](int first, int second) {
    return std::abs(first - second) <= tolerance;
  };
  return close(SkColorGetR(a), SkColorGetR(b)) &&
         close(SkColorGetG(a), SkColorGetG(b)) &&
         close(SkColorGetB(a), SkColorGetB(b));
}

// Reject mixed edges, such as images or side-by-side panels. A few pixels of
// foreground ink should not prevent a solid header from supplying its color.
std::optional<SkColor> UniformPageEdge(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing() || bitmap.width() != kPageEdgeSamples ||
      bitmap.height() != 1) {
    return std::nullopt;
  }
  // The compositor can return display-space pixels. The browser palette
  // consumes sRGB, so convert before comparing with the document color.
  SkBitmap srgb;
  const auto info = SkImageInfo::MakeN32(
      kPageEdgeSamples, 1, kUnpremul_SkAlphaType, SkColorSpace::MakeSRGB());
  srgb.allocPixels(info);
  if (!bitmap.readPixels(info, srgb.getPixels(), srgb.rowBytes(), 0, 0))
    return std::nullopt;
  std::array<SkColor, kPageEdgeSamples> pixels;
  std::array<uint8_t, kPageEdgeSamples> red, green, blue;
  for (int x = 0; x < kPageEdgeSamples; ++x) {
    const SkColor pixel = srgb.getColor(x, 0);
    if (SkColorGetA(pixel) != SK_AlphaOPAQUE) return std::nullopt;
    pixels[x] = pixel;
    red[x] = SkColorGetR(pixel);
    green[x] = SkColorGetG(pixel);
    blue[x] = SkColorGetB(pixel);
  }
  auto median = [](auto& channel) {
    auto center = channel.begin() + kPageEdgeSamples / 2;
    std::nth_element(channel.begin(), center, channel.end());
    return *center;
  };
  const SkColor center = SkColorSetRGB(median(red), median(green), median(blue));
  int matches = 0;
  int r = 0, g = 0, b = 0;
  for (const SkColor pixel : pixels) {
    if (!SimilarColors(pixel, center)) continue;
    ++matches;
    r += SkColorGetR(pixel);
    g += SkColorGetG(pixel);
    b += SkColorGetB(pixel);
  }
  if (matches * 10 < kPageEdgeSamples * 9) return std::nullopt;
  return SkColorSetRGB(r / matches, g / matches, b / matches);
}
}  // namespace

// Only the active document in a visible, regular browser window is sampled.
class SpaceNavigationView::PageChromeObserver final : public content::WebContentsObserver {
 public:
  explicit PageChromeObserver(base::RepeatingClosure changed) : changed_(std::move(changed)) {}

  void SetActiveContents(content::WebContents* contents, bool sample_edge) {
    if (web_contents() == contents && sample_edge_ == sample_edge) return;
    Observe(contents);
    sample_edge_ = sample_edge;
    ResetSample();
    ScheduleSample();
  }

  std::optional<SkColor> edge_color() const { return edge_color_; }

 private:
  void DidChangeThemeColor() override { PageColorsChanged(); }
  void OnBackgroundColorChanged() override { PageColorsChanged(); }
  void DidFirstVisuallyNonEmptyPaint() override { ScheduleSample(); }
  void DidStopLoading() override { ScheduleSample(); }
  void PrimaryMainFrameWasResized(bool width_changed) override {
    if (width_changed) ScheduleSample();
  }
  void DidGetUserInteraction(const blink::WebInputEvent&) override {
    ScheduleSample();
  }
  void OnVisibilityChanged(content::Visibility visibility) override {
    if (visibility == content::Visibility::VISIBLE) ScheduleSample();
  }
  void PrimaryPageChanged(content::Page&) override {
    ResetSample();
    PageColorsChanged();
  }
  void WebContentsDestroyed() override {
    SetActiveContents(nullptr, false);
    changed_.Run();
  }

  void PageColorsChanged() {
    changed_.Run();
    ScheduleSample();
  }

  void ResetSample() {
    edge_color_.reset();
    timer_.Stop();
    sample_pending_ = false;
    ++document_generation_;
  }

  bool CanSample() const {
    return sample_edge_ && web_contents() && !web_contents()->IsCrashed() &&
           web_contents()->GetLastCommittedURL().SchemeIsHTTPOrHTTPS() &&
           web_contents()->GetVisibility() == content::Visibility::VISIBLE;
  }

  void ScheduleSample() {
    if (!CanSample() || timer_.IsRunning()) return;
    if (copy_in_flight_) {
      sample_pending_ = true;
      return;
    }
    timer_.Start(FROM_HERE, base::Milliseconds(180), this,
                 &PageChromeObserver::SampleEdge);
  }

  void SampleEdge() {
    if (!CanSample()) return;
    auto* view = web_contents()->GetRenderWidgetHostView();
    if (!view || !view->IsSurfaceAvailableForCopy()) return;
    const gfx::Size viewport = view->GetVisibleViewportSize();
    if (viewport.width() < 80 || viewport.height() < 4) return;
    // Exclude the vertical scrollbar and the first pixel of the surface.
    const gfx::Rect strip(0, 2, viewport.width() - 16, 2);
    copy_in_flight_ = true;
    view->CopyFromSurfaceSecure(
        strip, gfx::Size(kPageEdgeSamples, 1), base::Milliseconds(500),
        base::BindPostTaskToCurrentDefault(base::BindOnce(
            &PageChromeObserver::OnEdgeCopied, weak_factory_.GetWeakPtr(),
            document_generation_, web_contents()->GetPrimaryPage().GetWeakPtr())));
  }

  void OnEdgeCopied(unsigned generation, base::WeakPtr<content::Page> page,
                    const content::CopyFromSurfaceResult& result) {
    copy_in_flight_ = false;
    if (std::exchange(sample_pending_, false)) ScheduleSample();
    if (!result || !CanSample() || generation != document_generation_ ||
        page.get() != &web_contents()->GetPrimaryPage()) {
      return;
    }
    auto color = UniformPageEdge(result->bitmap);
    if (edge_color_ == color) return;
    edge_color_ = color;
    changed_.Run();
  }

  base::RepeatingClosure changed_;
  std::optional<SkColor> edge_color_;
  base::OneShotTimer timer_;
  bool sample_edge_ = false;
  bool copy_in_flight_ = false;
  bool sample_pending_ = false;
  unsigned document_generation_ = 0;
  base::WeakPtrFactory<PageChromeObserver> weak_factory_{this};
};

class SpaceNavigationView::ClearObserver final : public content::WebContentsObserver {
 public:
  ClearObserver(content::WebContents* contents, base::OnceClosure cancelled)
      : WebContentsObserver(contents), cancelled_(std::move(cancelled)) {}
  void BeforeUnloadFired(bool proceed) override { if (!proceed) Cancel(); }
  void BeforeUnloadDialogCancelled() override { Cancel(); }
 private:
  void Cancel() {
    // The owner removes this observer from pending_clear_. Defer that removal
    // until the current WebContents observer dispatch has returned.
    if (cancelled_) base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, std::move(cancelled_));
  }
  base::OnceClosure cancelled_;
};

DEFINE_USER_DATA(SpaceNavigationView);
SpaceNavigationView* SpaceNavigationView::From(BrowserWindowInterface* browser) {
  return browser ? Get(browser->GetUnownedUserDataHost()) : nullptr;
}
SpaceNavigationView::SpaceNavigationView(
    BrowserWindowInterface* browser,
    tabs::VerticalTabStripStateController* state_controller)
    : browser_(browser), model_(browser->GetTabStripModel()),
      workspace_(WorkspaceState::ForProfile(browser->GetProfile())),
      state_controller_(state_controller),
      scoped_data_(browser->GetUnownedUserDataHost(), *this) {
  SetOrientation(views::BoxLayout::Orientation::kVertical);
  SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
  // Shared favorites and the title have their own fixed place above the
  // Space list. A large favorites grid can scroll within its own viewport.
  auto favorites = std::make_unique<views::ScrollView>();
  favorites->ClipHeightTo(0, 148);
  favorites->SetVerticalScrollBar(std::make_unique<SidebarScrollBar>());
  favorites->SetBackgroundColor(std::nullopt);
  favorites->SetDrawOverflowIndicator(false);
  favorites->SetHorizontalScrollBarMode(views::ScrollView::ScrollBarMode::kDisabled);
  favorites_body_ = favorites->SetContents(std::make_unique<views::BoxLayoutView>());
  favorites_body_->SetOrientation(views::BoxLayout::Orientation::kVertical);
  favorites_body_->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
  favorites_body_->SetBetweenChildSpacing(3);
  favorites_body_->SetInsideBorderInsets(gfx::Insets::TLBR(8, 8, 0, 8));
  AddChildView(std::move(favorites));
  title_clip_ = AddChildView(std::make_unique<views::BoxLayoutView>());
  title_clip_->SetOrientation(views::BoxLayout::Orientation::kVertical);
  title_clip_->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
  title_clip_->SetInsideBorderInsets(gfx::Insets::TLBR(0, 8, 0, 8));
  title_clip_->SetPaintToLayer();
  title_clip_->layer()->SetFillsBoundsOpaquely(false);
  title_clip_->layer()->SetMasksToBounds(true);
  auto scroll = std::make_unique<views::ScrollView>();
  // The flex layout supplies the viewport. The height of its scrolling
  // contents must not become the native window's minimum height.
  scroll->ClipHeightTo(0, 0);
  scroll->SetID(0x534253);
  scroll->SetVerticalScrollBar(std::make_unique<SidebarScrollBar>());
  scroll->SetBackgroundColor(std::nullopt);
  scroll->SetDrawOverflowIndicator(false);
  scroll->SetHorizontalScrollBarMode(views::ScrollView::ScrollBarMode::kDisabled);
  body_ = scroll->SetContents(std::make_unique<views::BoxLayoutView>());
  body_->SetPaintToLayer();
  body_->layer()->SetFillsBoundsOpaquely(false);
  body_->layer()->SetMasksToBounds(true);
  body_->SetOrientation(views::BoxLayout::Orientation::kVertical);
  body_->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
  body_->SetBetweenChildSpacing(3);
  body_->SetInsideBorderInsets(gfx::Insets::TLBR(0, 8, 12, 8));
  auto* scrolling = AddChildView(std::move(scroll));
  SetFlexForView(scrolling, 1);
  dock_ = Row(this, 1);
  dock_->SetInsideBorderInsets(gfx::Insets::TLBR(6, kDockLeftInset, 6, kDockRightInset));
  collapsed_ = state_controller->IsCollapsed();
  collapse_subscription_ = state_controller->RegisterOnCollapseChanged(
      base::BindRepeating([](SpaceNavigationView* self,
                            tabs::VerticalTabStripCollapseState state) {
        if (state == tabs::VerticalTabStripCollapseState::kCollapsing) return;
        self->collapsed_ = state == tabs::VerticalTabStripCollapseState::kCollapsed;
        self->ScheduleRefresh();
      }, base::Unretained(this)));
  workspace_subscription_ = workspace_->Observe(base::BindRepeating(
      [](SpaceNavigationView* view) {
        if (!view->committing_folder_change_) view->ScheduleRefresh();
      }, base::Unretained(this)));
  page_chrome_observer_ = std::make_unique<PageChromeObserver>(base::BindRepeating(
      &SpaceNavigationView::SchedulePageChromeRefresh, weak_factory_.GetWeakPtr()));
  model_->AddObserver(this);
  ScheduleRefresh();
  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser-smoke-test")) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&SpaceNavigationView::RunSmokeTest,
                                 weak_factory_.GetWeakPtr(), state_controller, 0),
        base::Seconds(2));
  }
}
SpaceNavigationView::~SpaceNavigationView() {
  DetachWindowInputHandlers();
#if BUILDFLAG(IS_MAC)
  ForgetGlobalSearchWindow(browser_);
#endif
  FinishSpaceTransition();
  paint_subscription_ = {};
  widget_observation_.Reset();
}

std::unique_ptr<views::View> CreateSidebarToggle(BrowserWindowInterface* browser) {
  auto button = std::make_unique<views::LabelButton>(base::BindRepeating(
      [](BrowserWindowInterface* browser) {
        if (auto* sidebar = SpaceNavigationView::From(browser)) sidebar->ToggleSidebar();
      }, base::Unretained(browser)));
  button->SetID(0x534254);
  // The expanded sidebar paints to its own compositor layer. Keep this frame
  // control above that surface in both collapse states.
  button->SetPaintToLayer();
  button->layer()->SetFillsBoundsOpaquely(false);
  button->SetTooltipText(LocalizedText16(browser->GetProfile(), "显示/隐藏侧栏", "Show/hide sidebar"));
  button->SetHorizontalAlignment(gfx::ALIGN_CENTER);
  button->SetImageLabelSpacing(0);
  button->SetMinSize(gfx::Size(28, 32));
  button->SetImageModel(views::Button::STATE_NORMAL,
      ui::ImageModel::FromVectorIcon(kDockToLeftIcon, ui::kColorIcon, 20));
  return button;
}
void SpaceNavigationView::ToggleSidebar() {
  FinishSpaceTransition();
  state_controller_->RequestCollapse(!state_controller_->IsCollapsed());
}
bool PaintProductBackdrop(gfx::Canvas* canvas, const views::View* view,
                          const BrowserView* browser) {
  if (!base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") || !browser)
    return false;
  const auto* owner = browser->browser();
  const auto* sidebar = owner ? SpaceNavigationView::Get(owner->GetUnownedUserDataHost()) : nullptr;
  if (!sidebar) return false;
  PaintSidebarBackdrop(canvas, view, sidebar);
  return true;
}
std::optional<SkColor> PageChromeColor(const BrowserView* browser) {
  if (!browser || !base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) return std::nullopt;
  const auto* owner = browser->browser();
  auto* sidebar = SpaceNavigationView::Get(owner->GetUnownedUserDataHost());
  return sidebar ? sidebar->page_chrome_color() : std::nullopt;
}
bool IsProductHome(BrowserView* browser) {
  if (!browser || !base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) return false;
  auto* contents = browser->GetActiveWebContents();
  return contents && contents->GetLastCommittedURL() == GURL("chrome://tai/home.html");
}
bool PaintPageChrome(gfx::Canvas* canvas, const views::View*, const BrowserView* browser) {
  if (auto color = PageChromeColor(browser)) { canvas->DrawColor(*color); return true; }
  // The toolbar's native background is available before the page paints.
  return false;
}
void ApplyPageChromePalette(const BrowserView* browser, ui::ColorProviderKey& key) {
  // The existing app-controller initializer belongs to PWAs; leave it intact.
  if (key.app_controller) return;
  const auto color = PageChromeColor(browser);
  if (!color) return;
  // A finite set of process-lifetime palettes keeps ColorProvider keys stable.
  static const base::NoDestructor<
      std::array<std::unique_ptr<PageChromePalette>, 2 * kPageAccentHues>> palettes([] {
    std::array<std::unique_ptr<PageChromePalette>, 2 * kPageAccentHues> result;
    for (int i = 0; i < 2 * kPageAccentHues; ++i)
      result[i] = std::make_unique<PageChromePalette>(i >= kPageAccentHues,
                                                     i % kPageAccentHues);
    return result;
  }());
  const auto* sidebar =
      SpaceNavigationView::Get(browser->browser()->GetUnownedUserDataHost());
  const int mode = color_utils::IsDark(*color) ? kPageAccentHues : 0;
  key.app_controller = (*palettes)[mode + sidebar->page_chrome_accent()].get();
}
std::unique_ptr<views::Background> CreatePageChromeEdgeBackground(BrowserView& browser, bool layer_based) {
  return std::make_unique<PageChromeEdgeBackground>(browser, layer_based);
}
std::unique_ptr<views::Background> CreateSidebarBackground(views::View& view, BrowserView& browser) {
  return std::make_unique<SidebarFrameBackground>(view, browser);
}
std::unique_ptr<views::Background> CreateToolbarBackground(views::View& view, BrowserView& browser) {
  return std::make_unique<SidebarFrameBackground>(view, browser, true);
}
SkColor SpaceNavigationView::SidebarColor() const {
  const auto* space = workspace_->loaded() ? workspace_->model().FindSpace(active_space_id_) : nullptr;
  if (space && space->color) return space->color;
  const bool dark = GetWidget()
      ? GetWidget()->GetColorMode() == ui::ColorProviderKey::ColorMode::kDark
      : GetNativeTheme()->preferred_color_scheme() == ui::NativeTheme::PreferredColorScheme::kDark;
  return dark
      ? (workspace_->edition() == "pride" ? SkColorSetRGB(32, 27, 43) : SkColorSetRGB(21, 22, 42))
      : (workspace_->edition() == "pride" ? SkColorSetRGB(244, 241, 248) : SkColorSetRGB(240, 239, 251));
}
bool SpaceNavigationView::HasPrideBackdrop() const {
  const auto* space = workspace_->loaded() ? workspace_->model().FindSpace(active_space_id_) : nullptr;
  return workspace_->edition() == "pride" && !(space && space->color);
}
bool SpaceNavigationView::IsDark() const { return color_utils::IsDark(SidebarColor()); }
void SpaceNavigationView::UpdateFrameButton() {
  RefreshTaiPanelLabels(browser_);
#if BUILDFLAG(IS_MAC)
  UpdateShortcutMenu(browser_);
  UpdateGlobalSearch(browser_, ShortcutBinding(*workspace_, "global_search"));
#endif
  auto* control = GetWidget() ? GetWidget()->GetRootView()->GetViewByID(0x534254) : nullptr;
  auto* frame_button = control ? static_cast<views::LabelButton*>(control) : nullptr;
  if (frame_button) {
    ui::Accelerator shortcut;
    GetManagedShortcutForCommand(browser_, IDC_TOGGLE_VERTICAL_TABS_COLLAPSE, &shortcut);
    auto text = LocalizedText16(browser_->GetProfile(), "显示/隐藏侧栏", "Show/hide sidebar");
    if (shortcut.key_code() != ui::VKEY_UNKNOWN) text += u" (" + shortcut.GetShortcutText() + u")";
    frame_button->SetTooltipText(text);
    const auto& image = frame_button->GetImageModel(views::Button::STATE_NORMAL);
    if (image && image->IsVectorIcon()) {
      const auto icon = image->GetVectorIcon();
      const bool dark = !GetVisible() && page_chrome_color_
          ? color_utils::IsDark(*page_chrome_color_) : IsDark();
      const auto colored = ui::ImageModel::FromVectorIcon(*icon.vector_icon(),
          dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53), icon.icon_size());
      for (auto state : {views::Button::STATE_NORMAL, views::Button::STATE_HOVERED,
                         views::Button::STATE_PRESSED, views::Button::STATE_DISABLED})
        frame_button->SetImageModel(state, colored);
    }
  }
}
void SpaceNavigationView::SchedulePageChromeRefresh() {
  if (page_chrome_refresh_pending_ || !model_) return;
  page_chrome_refresh_pending_ = true;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
      base::BindOnce(&SpaceNavigationView::RefreshPageChrome, weak_factory_.GetWeakPtr()));
}
void SpaceNavigationView::RefreshPageChrome() {
  page_chrome_refresh_pending_ = false;
  if (!model_ || !GetWidget()) return;
  auto* contents = model_->GetActiveWebContents();
  const bool use_page_chrome = !browser_->GetProfile()->IsOffTheRecord() &&
      GetNativeTheme()->preferred_contrast() != ui::NativeTheme::PreferredContrast::kMore;
  page_chrome_observer_->SetActiveContents(contents, use_page_chrome);
  std::optional<SkColor> color;
  if (contents && use_page_chrome) {
    const auto& url = contents->GetLastCommittedURL();
    // Product preferences and the native settings document share their actual
    // canvas with the toolbar; other management pages retain upstream themes.
    const bool owned_page = url.SchemeIs("chrome") &&
        (url.host() == "tai" || url.host() == "settings");
    if ((owned_page || url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("data")) && !contents->IsCrashed()) {
      auto background = contents->GetBackgroundColor();
      if (background && SkColorGetA(*background) == SK_AlphaOPAQUE) color = background;
      if (auto theme = contents->GetThemeColor(); theme && SkColorGetA(*theme))
        color = color_utils::GetResultingPaintColor(*theme, color.value_or(SK_ColorWHITE));
      // A distinct visible header extends into the toolbar. For pages whose
      // edge is just the document canvas, respect the site's declared theme.
      if (auto edge = page_chrome_observer_->edge_color();
          edge && !SimilarColors(*edge, background.value_or(SK_ColorWHITE))) {
        color = edge;
      }
    }
  }
  const auto* space = workspace_->model().FindSpace(active_space_id_);
  const int accent = color ? PageAccentIndex(*color, space ? space->color : 0,
                                             workspace_->edition() == "pride") : 0;
  if (page_chrome_color_ == color && page_chrome_accent_ == accent) return;
  const bool palette_changed = !page_chrome_color_ || !color ||
      color_utils::IsDark(*page_chrome_color_) != color_utils::IsDark(*color) ||
      page_chrome_accent_ != accent;
  VLOG(1) << "TAi toolbar surface="
          << (!color ? "native" : color_utils::IsDark(*color) ? "dark-page" : "light-page");
  page_chrome_color_ = color;
  page_chrome_accent_ = accent;
  auto* toolbar = BrowserView::GetBrowserViewForBrowser(browser_)->toolbar();
  // Native browser controls get a window-local palette; never override the
  // Widget color mode, which also controls webpage prefers-color-scheme.
  if (palette_changed) {
    GetWidget()->ResetLastColorProviderKey();
    GetWidget()->ScheduleThemeChanged();
  } else if (auto* location_bar = toolbar->location_bar_view()) {
    // Same light/dark palette, new fill: update only the native address bar,
    // without sending a whole-window theme notification or rebuilding rows.
    location_bar->OnThemeChanged();
  }
  for (int id : {0x534243, 0x534244})
    if (auto* edge = GetWidget()->GetRootView()->GetViewByID(id))
      edge->GetBackground()->OnViewThemeChanged(edge);
  toolbar->SchedulePaint();
  GetWidget()->GetRootView()->SchedulePaint();
}
void SpaceNavigationView::OnThemeChanged() { views::BoxLayoutView::OnThemeChanged(); SchedulePageChromeRefresh(); ScheduleRefresh(); }
void SpaceNavigationView::ShowAppearance() {
  const auto id = active_space_id_;
  const auto* space = workspace_->model().FindSpace(id); if (!space) return;
  appearance_widget_.reset(); appearance_delegate_.reset();
  appearance_delegate_ = std::make_unique<SpaceAppearanceBubble>(browser_->GetProfile(), this, SpaceColorHex(space->color),
      base::BindRepeating([](base::WeakPtr<SpaceNavigationView> self, std::string id, std::string color) {
        if (!self || !self->workspace_->model().SetSpaceColor(id, color)) return false;
        self->workspace_->Commit(); self->ScheduleRefresh(); return true;
      }, weak_factory_.GetWeakPtr(), id));
  appearance_widget_ = views::BubbleDialogDelegate::CreateBubble(appearance_delegate_.get(),
      base::BindOnce([](base::WeakPtr<SpaceNavigationView> self, views::Widget::ClosedReason) {
        if (!self) return;
        // Closing is synchronous. Release both objects once the dialog callback
        // stack has unwound, with the delegate outliving its Widget.
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
            base::BindOnce([](base::WeakPtr<SpaceNavigationView> self) {
              if (self) { self->appearance_widget_.reset(); self->appearance_delegate_.reset(); }
            }, self));
      }, weak_factory_.GetWeakPtr()));
  appearance_widget_->Show();
}
void SpaceNavigationView::AddedToWidget() {
  views::BoxLayoutView::AddedToWidget();
  widget_observation_.Observe(GetWidget());
  auto* root = GetWidget()->GetRootView();
  root->AddPreTargetHandler(&recent_keys_);
  // The sidebar's viewport can extend below the last row. Observe the window
  // before target dispatch, then route by the visible sidebar geometry.
  root->AddPreTargetHandler(&swipe_handler_);
  window_input_handlers_attached_ = true;
  paint_subscription_ = GetWidget()->RegisterPaintAsActiveChangedCallback(
      base::BindRepeating([](base::WeakPtr<SpaceNavigationView> self) {
        // Native action buttons update their icon on activation changes. Apply
        // our palette afterward without rebuilding rows or interrupting edits.
        if (self) base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, base::BindOnce(&SpaceNavigationView::UpdateFrameButton,
                                     self));
      }, weak_factory_.GetWeakPtr()));
}
void SpaceNavigationView::RemovedFromWidget() {
  DetachWindowInputHandlers();
  paint_subscription_ = {};
  widget_observation_.Reset(); views::BoxLayoutView::RemovedFromWidget();
}
void SpaceNavigationView::OnWidgetDestroying(views::Widget*) {
  DetachWindowInputHandlers();
  paint_subscription_ = {}; widget_observation_.Reset();
}
void SpaceNavigationView::DetachWindowInputHandlers() {
  if (!window_input_handlers_attached_) return;
  auto* root = GetWidget()->GetRootView();
  root->RemovePreTargetHandler(&recent_keys_);
  root->RemovePreTargetHandler(&swipe_handler_);
  swipe_handler_.Reset();
  window_input_handlers_attached_ = false;
  EndRecentTabCycle();
}
void SpaceNavigationView::RecentKeys::OnEvent(const ui::Event& event) {
  if (owner_->GetWidget() && owner_->GetWidget()->IsActive())
    owner_->ReleaseRecentTabCycle(event.flags());
}
void SpaceNavigationView::RecentKeys::OnKeyEvent(ui::KeyEvent* event) {
  owner_->ReleaseRecentTabCycle(event->flags());
}
void SpaceNavigationView::RecentKeys::OnMouseEvent(ui::MouseEvent* event) {
  if (event->type() == ui::EventType::kMousePressed) owner_->EndRecentTabCycle();
}
void SpaceNavigationView::OnWidgetActivationChanged(views::Widget*, bool active) {
  if (!active) EndRecentTabCycle();
  else UpdateFrameButton();
}
void SpaceNavigationView::OnWidgetDragDropCompleted(views::Widget*) {
  TraceDrag("source drag loop completed");
  if (CurrentDrag().source.get() == this) CurrentDrag() = {};
  ClearDropFeedback(); space_hover_timer_.Stop(); hover_space_.clear(); ScheduleRefresh();
}
void SpaceNavigationView::RegisterRow(views::View* view, std::string key, Area area) {
  row_items_[view] = key; view->set_drag_controller(this);
  drop_zones_.push_back({view, area, active_space_id_, std::move(key)});
}
int SpaceNavigationView::GetDragOperationsForView(views::View* sender, const gfx::Point&) {
  const bool allowed = model_ && row_items_.contains(sender) && !row_items_.at(sender).empty();
  TraceDrag(allowed ? "draggable row pressed" : "row drag not available");
  return allowed ? ui::DragDropTypes::DRAG_MOVE : ui::DragDropTypes::DRAG_NONE;
}
bool SpaceNavigationView::CanStartDragForView(views::View* sender, const gfx::Point& press, const gfx::Point& p) {
  return GetDragOperationsForView(sender, p) && views::View::ExceededDragThreshold(p - press);
}
void SpaceNavigationView::WriteDragDataForView(views::View* sender, const gfx::Point& press, ui::OSExchangeData* data) {
  if (!row_items_.contains(sender)) return;
  TraceDrag("write native drag data");
  CurrentDrag() = {NewId(), row_items_.at(sender), weak_factory_.GetWeakPtr()};
  base::Pickle pickle; pickle.WriteString(CurrentDrag().nonce);
  data->SetPickledData(SidebarDragFormat(), pickle);
  auto* button = views::AsViewClass<SidebarButton>(sender); if (!button) return;
  GURL url; std::u16string title(button->GetText());
  if (auto* saved = workspace_->model().FindItem(CurrentDrag().key)) {
    url = GURL(saved->url); title = base::UTF8ToUTF16(saved->title);
  } else if (CurrentDrag().key.starts_with("@tab:")) {
    int value = 0;
    if (base::StringToInt(CurrentDrag().key.substr(5), &value)) {
      if (auto* tab = tabs::TabHandle(value).Get()) {
        url = tab->GetContents()->GetVisibleURL(); title = tab->GetContents()->GetTitle();
      }
    }
  }
  button_drag_utils::SetDragImage(url, title, button->GetImage(views::Button::STATE_NORMAL), &press, data);
}
bool SpaceNavigationView::GetDropFormats(int* formats, std::set<ui::ClipboardFormatType>* types) {
  *formats = 0; types->insert(SidebarDragFormat()); return true;
}
bool SpaceNavigationView::AreDropTypesRequired() { return true; }
bool SpaceNavigationView::CanDrop(const ui::OSExchangeData& data) {
  auto& drag = CurrentDrag();
  if (!model_ || !drag.source || !drag.source->model_ || !workspace_->loaded() ||
      drag.source->browser_->GetProfile() != browser_->GetProfile()) return false;
  auto pickle = data.GetPickledData(SidebarDragFormat()); if (!pickle) return false;
  std::string nonce;
  return base::PickleIterator(*pickle).ReadString(&nonce) && nonce == drag.nonce;
}
SpaceNavigationView::DropLocation SpaceNavigationView::LocateDrop(const gfx::Point& point) const {
  auto& ws = workspace_->model();
  for (auto it = drop_zones_.rbegin(); it != drop_zones_.rend(); ++it) {
    auto local = point; views::View::ConvertPointToTarget(this, it->view, &local);
    if (!it->view->GetVisibleBounds().Contains(local)) continue;
    DropLocation dest{it->area, it->space, {}, {}, 3, it->view};
    if (it->area == Area::kSpace || it->item.empty()) return dest;
    const auto* item = ws.FindItem(it->item);
    const bool after = it->area == Area::kFavorite ? local.x() > it->view->width()/2 : local.y() > it->view->height()/2;
    if (item) {
      if (item->kind == SavedKind::kFolder && local.y() > it->view->height()/4 &&
          local.y() < 3*it->view->height()/4) { dest.parent = item->id; return dest; }
      dest.parent = item->parent_id;
    }
    dest.mark = after ? 2 : 1; dest.before = it->item;
    if (after) {
      if (it->area == Area::kTemporary) {
        dest.before.clear(); bool seen = false;
        for (auto handle : VisibleTabs(false)) {
          const auto& binding = bindings_.at(handle.raw_value());
          const auto key = "@tab:" + base::NumberToString(handle.raw_value());
          if (seen && binding.item_id.empty() && !binding.placeholder) { dest.before = key; break; }
          if (key == it->item) seen = true;
        }
      } else {
        std::vector<std::string> siblings;
        if (it->area == Area::kFavorite) {
          for (const auto& node : ws.items()) if (node.kind == SavedKind::kFavorite) siblings.push_back(node.id);
        } else siblings = ws.Children(dest.space, dest.parent);
        auto found = std::ranges::find(siblings, it->item);
        dest.before = found != siblings.end() && ++found != siblings.end() ? *found : std::string();
      }
    }
    return dest;
  }
  const auto screen_y = GetBoundsInScreen().y() + point.y();
  if (space_header_ && screen_y < space_header_->GetBoundsInScreen().y())
    return {Area::kFavorite, {}, {}, {}, 3, nullptr};
  if (new_tab_button_ && screen_y < new_tab_button_->GetBoundsInScreen().y())
    return {Area::kSaved, active_space_id_, {}, {}, 3, nullptr};
  return {Area::kTemporary, active_space_id_, {}, {}, 3, nullptr};
}
void SpaceNavigationView::ClearDropFeedback() {
  if (auto* button = views::AsViewClass<SidebarButton>(feedback_view_)) button->SetDropMark(0);
  feedback_view_ = nullptr;
}
void SpaceNavigationView::OnDragEntered(const ui::DropTargetEvent& event) { OnDragUpdated(event); }
int SpaceNavigationView::OnDragUpdated(const ui::DropTargetEvent& event) {
  ClearDropFeedback();
  if (!CanDrop(event.data())) { TraceDrag("drop data rejected"); return ui::DragDropTypes::DRAG_NONE; }
  TraceDrag("drop target updated");
  auto dest = LocateDrop(event.location());
  const auto* item = workspace_->model().FindItem(CurrentDrag().key);
  if (item && item->kind == SavedKind::kFolder &&
      (dest.area == Area::kFavorite || dest.area == Area::kTemporary)) return ui::DragDropTypes::DRAG_NONE;
  feedback_view_ = dest.view;
  if (auto* button = views::AsViewClass<SidebarButton>(feedback_view_)) button->SetDropMark(dest.mark);
  if (dest.area == Area::kSpace && dest.space != active_space_id_) {
    if (hover_space_ != dest.space) {
      hover_space_ = dest.space;
      space_hover_timer_.Start(FROM_HERE, base::Milliseconds(750), base::BindOnce(
          &SpaceNavigationView::ActivateSpace, weak_factory_.GetWeakPtr(), dest.space));
    }
  } else { hover_space_.clear(); space_hover_timer_.Stop(); }
  return ui::DragDropTypes::DRAG_MOVE;
}
void SpaceNavigationView::OnDragExited() {
  ClearDropFeedback(); space_hover_timer_.Stop(); hover_space_.clear();
}
views::View::DropCallback SpaceNavigationView::GetDropCallback(const ui::DropTargetEvent& event) {
  auto dest = LocateDrop(event.location());
  // Views in the feedback are rebuilt after mutation; never retain a view in
  // the deferred callback. Identity and ordering are strings/handles instead.
  dest.view = nullptr; ClearDropFeedback(); space_hover_timer_.Stop();
  if (!CanDrop(event.data())) return base::BindOnce([](const ui::DropTargetEvent&,
      ui::mojom::DragOperation&, std::unique_ptr<ui::LayerTreeOwner>) {});
  const auto drag = CurrentDrag();
  // A policy-mediated platform drop may run after the source drag loop ended.
  // Retain its nonce/weak source; clearing the global active drag is harmless.
  TraceDrag("create drop callback");
  return base::BindOnce([](base::WeakPtr<SpaceNavigationView> self, SidebarDrag drag, DropLocation dest,
      const ui::DropTargetEvent& event, ui::mojom::DragOperation& operation,
      std::unique_ptr<ui::LayerTreeOwner>) {
    if (!self || !drag.source || !self->model_ || !drag.source->model_ ||
        self->workspace_ != drag.source->workspace_) return;
    auto pickle = event.data().GetPickledData(SidebarDragFormat());
    std::string nonce;
    if (!pickle || !base::PickleIterator(*pickle).ReadString(&nonce) || nonce != drag.nonce) return;
    const bool moved = self->ApplyDrop(drag.source.get(), drag.key, std::move(dest));
    TraceDrag(moved ? "drop applied" : "drop mutation rejected");
    if (moved) operation = ui::mojom::DragOperation::kMove;
  }, weak_factory_.GetWeakPtr(), drag, std::move(dest));
}
bool SpaceNavigationView::ApplyDrop(SpaceNavigationView* source, const std::string& key, DropLocation dest) {
  if (!source || !source->model_ || !model_ || source->workspace_ != workspace_) return false;
  source->SyncTabs(); SyncTabs(); auto& ws = workspace_->model();
  const auto* item = ws.FindItem(key);
  const bool moving_folder = item && item->kind == SavedKind::kFolder;
  std::optional<tabs::TabHandle> handle = source->LiveItem(key);
  if (key.starts_with("@tab:")) {
    int value = 0; if (!base::StringToInt(key.substr(5), &value)) return false;
    handle = tabs::TabHandle(value);
  }
  if (handle && (!handle->Get() || source->model_->GetIndexOfTab(handle->Get()) == TabStripModel::kNoTab)) return false;
  if (!item && !handle) return false;
  if (dest.before == key) return false;
  if (dest.area == Area::kSpace) dest.area = item ? Area::kSaved : Area::kTemporary;
  if (item && item->kind == SavedKind::kFolder && dest.area != Area::kSaved) return false;
  const bool favorite = dest.area == Area::kFavorite;
  const auto target_space = favorite ? std::string() : dest.space;
  if (!favorite && !ws.FindSpace(target_space)) return false;
  // Validate the metadata move before transferring a live page to a window.
  WorkspaceModel candidate = ws;
  std::string id = item ? item->id : std::string();
  if (dest.area != Area::kTemporary) {
    const auto kind = favorite ? SavedKind::kFavorite : item && item->kind == SavedKind::kFolder ? SavedKind::kFolder : SavedKind::kPage;
    if (item) {
      if (!candidate.RelocateItem(id, kind, target_space, dest.parent, dest.before)) return false;
    } else {
      auto* contents = handle->Get()->GetContents(); const auto url = contents->GetVisibleURL();
      if (!url.is_valid() || url.SchemeIs("chrome") || url.spec() == "about:blank") return false;
      id = NewId(); auto title = base::UTF16ToUTF8(contents->GetTitle());
      if (title.empty()) title = url.spec();
      if (!candidate.AddItem({id, target_space, dest.parent, title, url.spec(), kind}) ||
          (!dest.before.empty() && !candidate.RelocateItem(id, kind, target_space, dest.parent, dest.before))) return false;
    }
    if (!dest.parent.empty()) candidate.SetCollapsed(dest.parent, false);
  } else if (item) {
    if (!handle) { source->OpenItem(id); source->SyncTabs(); handle = source->LiveItem(id); }
    if (!handle) return false;
    candidate.RemoveItem(id); id.clear();
  }
  base::AutoReset<bool> source_switching(&source->switching_, true);
  base::AutoReset<bool> changing(&switching_, true);
  if (source != this && handle) {
    if (source->model_->count() == 1) source->NewTab(true);
    const int index = source->model_->GetIndexOfTab(handle->Get());
    auto tab = source->model_->DetachTabAtForInsertion(index);
    model_->InsertDetachedTabAt(model_->count(), std::move(tab), AddTabTypes::ADD_ACTIVE);
  }
  ws = std::move(candidate);
  if (handle) {
    SetBinding(handle->Get(), {target_space, id, false});
    if (dest.area == Area::kTemporary) {
      int to = model_->count()-1;
      if (dest.before.starts_with("@tab:")) {
        int value = 0;
        if (base::StringToInt(dest.before.substr(5), &value) && tabs::TabHandle(value).Get()) {
          to = model_->GetIndexOfTab(tabs::TabHandle(value).Get());
          if (to == TabStripModel::kNoTab) return false;
          if (model_->GetIndexOfTab(handle->Get()) < to) --to;
        }
      }
      model_->MoveWebContentsAt(model_->GetIndexOfTab(handle->Get()), to, false);
    }
    model_->ActivateTab(handle->Get());
  }
  if (!favorite) { active_space_id_ = target_space; ws.ActivateSpace(target_space); }
  SyncTabs();
  if (source != this) { source->SyncTabs(); source->ActivateSpace(source->active_space_id_); }
  else if (moving_folder) ActivateSpace(target_space);
  ws.ActivateSpace(active_space_id_);
  workspace_->Commit(); source->ScheduleRefresh(); ScheduleRefresh(); return true;
}

void SpaceNavigationView::OnBoundsChanged(const gfx::Rect& previous_bounds) {
  views::BoxLayoutView::OnBoundsChanged(previous_bounds);
  if (size() == previous_bounds.size()) return;
  TRACE_EVENT("browser", "TAi.SidebarResize", "width", width(), "height", height());
  // Tab activation can change the sidebar's height while the new Space enters.
  // Its horizontal translation remains valid across those relayouts.
  if (width() == previous_bounds.width()) return;
  if (IsSpaceTransitionRunning() || swipe_preview_active_) FinishSpaceTransition();
  if (!workspace_->loaded()) return;
  const int count = workspace_->model().spaces().size();
  if (GetSpaceDockLayout(width(), count, collapsed_) ==
      GetSpaceDockLayout(previous_bounds.width(), count, collapsed_)) return;
  // The rows already relayout with the view; only rebuild when the dock's
  // visible indicators change, after native resizing has settled.
  resize_refresh_timer_.Start(FROM_HERE, base::Milliseconds(80),
      base::BindOnce(&SpaceNavigationView::ScheduleRefresh, weak_factory_.GetWeakPtr()));
}

void SpaceNavigationView::ScheduleRefresh() {
  if (refresh_pending_ || !model_) return;
  refresh_pending_ = true;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&SpaceNavigationView::Refresh, weak_factory_.GetWeakPtr()));
}
void SpaceNavigationView::Refresh() {
  refresh_pending_ = false;
  if (!model_ || !workspace_->loaded()) return;
  if ((IsSpaceTransitionRunning() || swipe_preview_active_) &&
      !transition_direction_) {
    refresh_after_transition_ = true;
    return;
  }
  if (folder_reveal_ && !transition_direction_) {
    refresh_after_folder_reveal_ = true;
    return;
  }
  if ((menu_runner_ && menu_runner_->IsRunning()) ||
      (editor_ && editor_->HasFocus())) return;
  refresh_after_transition_ = false;
  SyncTabs();
  RefreshPageChrome();
  Render();
}
void SpaceNavigationView::SetBinding(tabs::TabInterface* tab, TabOrganization value) {
  if (!tab || tab->GetContents()->GetBrowserContext() != browser_->GetProfile()) return;
  auto old = ReadOrganization(tab->GetContents());
  bindings_.insert_or_assign(tab->GetHandle().raw_value(), value);
  if (old == value) return;
  WriteOrganization(tab->GetContents(), value);
  if (auto* service = SessionServiceFactory::GetForProfile(browser_->GetProfile())) {
    const auto id = sessions::SessionTabHelper::IdForTab(tab->GetContents());
    if (id.is_valid()) {
      service->AddTabExtraData(browser_->GetSessionID(), id, kSpaceSessionKey, value.space_id);
      service->AddTabExtraData(browser_->GetSessionID(), id, kItemSessionKey, value.item_id);
      service->AddTabExtraData(browser_->GetSessionID(), id, kPlaceholderSessionKey,
                                value.placeholder ? "1" : "0");
    }
  }
}
void SpaceNavigationView::SyncTabs() {
  auto& ws = workspace_->model();
  if (!ws.FindSpace(active_space_id_)) active_space_id_ = ws.active_space_id();
  std::set<int32_t> live;
  for (int i = 0; i < model_->count(); ++i) {
    auto* tab = model_->GetTabAtIndex(i);
    const auto id = tab->GetHandle().raw_value();
    live.insert(id);
    auto found = bindings_.find(id);
    const auto restored = ReadOrganization(tab->GetContents());
    const auto& visible_url = tab->GetContents()->GetVisibleURL();
    const auto* pending = tab->GetContents()->GetController().GetPendingEntry();
    const bool pending_blank = !pending || pending->GetURL() == GURL("chrome://newtab/") ||
        pending->GetURL() == GURL("chrome://new-tab-page/") || pending->GetURL() == GURL("chrome://tai/home.html");
    const bool initial_blank = pending_blank && model_->count() == 1 && !restored &&
        (visible_url.spec() == "chrome://newtab/" || visible_url.spec() == "chrome://new-tab-page/" || visible_url.spec() == "chrome://tai/home.html");
    if (initial_blank && visible_url.spec() != "chrome://tai/home.html") {
      const auto home = ProductNewTabURL(browser_);
      if (home.is_valid()) tab->GetContents()->GetController().LoadURL(
          home, content::Referrer(), ui::PAGE_TRANSITION_AUTO_TOPLEVEL, std::string());
    }
    auto value = found == bindings_.end()
        ? restored.value_or(TabOrganization{active_space_id_, {}, initial_blank}) : found->second;
    const auto* saved = value.item_id.empty() ? nullptr : ws.FindItem(value.item_id);
    if (!saved) value.item_id.clear();
    if (saved && saved->kind == SavedKind::kFavorite) value.space_id.clear();
    else if (saved) value.space_id = saved->space_id;
    else if (!ws.FindSpace(value.space_id)) value.space_id = active_space_id_;
    const auto& url = tab->GetContents()->GetVisibleURL();
    if (value.placeholder && !url.is_empty() && url.spec() != "chrome://newtab/" &&
        url.spec() != "chrome://new-tab-page/" && url.spec() != "chrome://tai/home.html" && url.spec() != "about:blank") {
      value.placeholder = false;
    }
    SetBinding(tab, value);
  }
  std::erase_if(bindings_, [&live](const auto& item) { return !live.contains(item.first); });
  if (auto* active = model_->GetActiveTab()) {
    const auto it = bindings_.find(active->GetHandle().raw_value());
    if (it != bindings_.end() && !it->second.space_id.empty()) {
      last_active_.insert_or_assign(it->second.space_id, active->GetHandle());
      if (!switching_ && active_space_id_ != it->second.space_id) {
        active_space_id_ = it->second.space_id;
        ws.ActivateSpace(active_space_id_); workspace_->Commit();
      }
    }
  }
}
std::vector<tabs::TabHandle> SpaceNavigationView::VisibleTabs(bool include_favorites) const {
  return VisibleTabsForSpace(active_space_id_, include_favorites);
}
std::vector<tabs::TabHandle> SpaceNavigationView::VisibleTabsForSpace(
    const std::string& space_id, bool include_favorites) const {
  std::vector<tabs::TabHandle> result;
  if (!model_ || !workspace_->loaded()) return result;
  const auto& ws = workspace_->model();
  for (int i = 0; i < model_->count(); ++i) {
    auto* tab = model_->GetTabAtIndex(i);
    const auto found = bindings_.find(tab->GetHandle().raw_value());
    if (found == bindings_.end()) continue;
    if (found->second.space_id == space_id) {
      result.push_back(tab->GetHandle());
    } else if (include_favorites && !found->second.item_id.empty()) {
      const auto* item = ws.FindItem(found->second.item_id);
      if (item && item->kind == SavedKind::kFavorite)
        result.push_back(tab->GetHandle());
    }
  }
  if (std::ranges::any_of(result, [this](auto handle) {
        return !bindings_.at(handle.raw_value()).placeholder;
      })) {
    std::erase_if(result, [this](auto handle) {
      return bindings_.at(handle.raw_value()).placeholder;
    });
  }
  return result;
}
std::optional<tabs::TabHandle> SpaceNavigationView::LiveItem(const std::string& id) const {
  if (!model_) return std::nullopt;
  for (int i = 0; i < model_->count(); ++i) {
    auto* tab = model_->GetTabAtIndex(i);
    const auto found = bindings_.find(tab->GetHandle().raw_value());
    if (found != bindings_.end() && found->second.item_id == id) return tab->GetHandle();
  }
  return std::nullopt;
}
bool SpaceNavigationView::IsSpaceTransitionRunning() const {
  return (space_body_ && space_body_->layer()->GetAnimator()->is_animating()) ||
         (outgoing_space_layer_ &&
          outgoing_space_layer_->GetAnimator()->is_animating()) ||
         (space_header_ && space_header_->layer()->GetAnimator()->is_animating());
}
bool SpaceNavigationView::CanAnimateSpace() const {
  return space_body_ && !collapsed_ && GetVisible() && GetWidget() &&
         gfx::Animation::ShouldRenderRichAnimation();
}
void SpaceNavigationView::FinishSpaceTransition() {
  ++transition_generation_;
  transition_direction_ = 0;
  transition_from_swipe_ = false;
  swipe_preview_active_ = false;
  if (space_body_) {
    space_body_->layer()->GetAnimator()->StopAnimating();
    space_body_->layer()->SetTransform(gfx::Transform());
    space_body_->layer()->SetOpacity(1.f);
  }
  if (space_header_) {
    space_header_->layer()->GetAnimator()->StopAnimating();
    space_header_->layer()->SetTransform(gfx::Transform());
    space_header_->layer()->SetOpacity(1.f);
  }
  OnSpaceTransitionFinished(transition_generation_);
}
void SpaceNavigationView::OnSpaceTransitionFinished(unsigned generation) {
  if (generation != transition_generation_) return;
  outgoing_space_layer_.reset();
  outgoing_title_layer_.reset();
  RemoveSwipePreview();
  if (std::exchange(refresh_after_transition_, false)) ScheduleRefresh();
}
void SpaceNavigationView::AnimateSpaceLayers(base::TimeDelta duration,
                                             float outgoing_offset,
                                             std::optional<float> preview_offset) {
  const auto finished = base::BindPostTaskToCurrentDefault(base::BindRepeating(
      &SpaceNavigationView::OnSpaceTransitionFinished, weak_factory_.GetWeakPtr(),
      ++transition_generation_));
  views::AnimationBuilder animation;
  auto& block = animation.OnEnded(finished).OnAborted(finished).Once()
                    .SetDuration(duration)
                    .SetTransform(space_body_, gfx::Transform(), gfx::Tween::EASE_OUT)
                    .SetOpacity(space_body_, 1.f, gfx::Tween::EASE_OUT);
  if (space_header_ && !space_header_->layer()->transform().IsIdentity()) {
    block.SetTransform(space_header_, gfx::Transform(), gfx::Tween::EASE_OUT)
        .SetOpacity(space_header_, 1.f, gfx::Tween::EASE_OUT);
  }
  for (auto* outgoing : {outgoing_space_layer_.get(), outgoing_title_layer_.get()}) {
    if (!outgoing) continue;
    gfx::Transform end;
    end.Translate(outgoing_offset, 0);
    block.SetTransform(outgoing, end, gfx::Tween::EASE_OUT)
        .SetOpacity(outgoing, 0.f, gfx::Tween::EASE_OUT);
  }
  if (preview_offset && swipe_preview_) {
    gfx::Transform end;
    end.Translate(*preview_offset, 0);
    block.SetTransform(swipe_preview_, end, gfx::Tween::EASE_OUT);
    if (swipe_preview_title_)
      block.SetTransform(swipe_preview_title_, end, gfx::Tween::EASE_OUT);
  }
}
void SpaceNavigationView::PlaySpaceTransition(std::optional<float> swipe_entrance) {
  const int direction = std::exchange(transition_direction_, 0);
  const bool swiped = std::exchange(transition_from_swipe_, false);
  if (!direction || !CanAnimateSpace()) {
    outgoing_space_layer_.reset();
    outgoing_title_layer_.reset();
    return;
  }
  // The compositor displays this layer after the regular Views layout pass.
  // Avoid forcing layout of the browser window on the input path.
  VLOG(1) << "TAi Space motion started direction=" << direction;
  auto* outgoing = outgoing_space_layer_.get();
  const float width = outgoing ? outgoing->bounds().width()
                               : body_->GetContentsBounds().width();
  const float distance = swiped ? width * kSwipeEntryShare : kSpaceSlideOffset;
  gfx::Transform start;
  start.Translate(swipe_entrance.value_or(direction * distance), 0);
  space_body_->layer()->SetTransform(start);
  space_body_->layer()->SetOpacity(swipe_entrance ? 1.f :
                                   swiped ? kSwipeEntryOpacity : 0.f);
  if (swiped && space_header_) {
    space_header_->layer()->SetTransform(start);
    space_header_->layer()->SetOpacity(swipe_entrance ? 1.f : kSwipeEntryOpacity);
  }
  float exit_distance = swipe_entrance ? width : distance;
  if (swiped && outgoing)
    exit_distance = std::max(exit_distance, std::abs(outgoing->transform().To2dTranslation().x()));
  AnimateSpaceLayers(swiped ? kSwipeEntryDuration : kSpaceSlideDuration,
                     -direction * exit_distance);
}
void SpaceNavigationView::PreviewSpaceSwipe(float offset) {
  if (!CanAnimateSpace() || space_body_->width() <= 0) return;
  if (!swipe_preview_active_) {
    FinishSpaceTransition();
    swipe_preview_active_ = true;
  }
  const float width = space_body_->width();
  const bool has_neighbour = workspace_->model().spaces().size() > 1;
  const float shift = has_neighbour
      ? std::clamp(offset, -width, width)
      : std::copysign(kSwipeEdgeGive * -std::expm1(-std::abs(offset) / kSwipeEdgeGive), offset);
  gfx::Transform transform;
  transform.Translate(shift, 0);
  auto* layer = space_body_->layer();
  layer->SetTransform(transform);
  const float fade = std::min(1.f, std::abs(offset) / (width * 0.5f));
  layer->SetOpacity(has_neighbour ? 1.f - (1.f - kSwipeEntryOpacity) * fade : 1.f);
  if (space_header_) {
    space_header_->layer()->SetTransform(transform);
    space_header_->layer()->SetOpacity(layer->opacity());
  }
  if (!has_neighbour || shift == 0.f) {
    RemoveSwipePreview();
    return;
  }
  const auto adjacent =
      AdjacentSpaceId((offset < 0) != base::i18n::IsRTL() ? 1 : -1);
  if (swipe_preview_space_id_ != adjacent) {
    RemoveSwipePreview();
    auto* viewport = body_->parent();
    auto* scroll = static_cast<views::ScrollView*>(viewport->parent());
    const auto visible = scroll->GetVisibleRect();
    const int top = std::max(0, space_body_->y() - visible.y());
    const int height = visible.height() - top;
    if (adjacent.empty() || height <= 0) return;
    // The preview occupies the exposed part of the existing scroll viewport.
    // Rows below the viewport are built by the regular layout after commit.
    auto preview = BuildSpaceBody(adjacent, false, height / 30 + 2);
    preview->SetCanProcessEventsWithinSubtree(false);
    preview->GetViewAccessibility().SetIsLeaf(true);
    preview->GetViewAccessibility().SetIsIgnored(true);
    preview->layer()->SetMasksToBounds(true);
    preview->SetBounds(space_body_->x() - visible.x(), top,
                       space_body_->width(), height);
    swipe_preview_ = viewport->AddChildView(std::move(preview));
    swipe_preview_->DeprecatedLayoutImmediately();
    auto title = BuildSpaceHeader(adjacent, false);
    title->SetProperty(views::kViewIgnoredByLayoutKey, true);
    title->SetCanProcessEventsWithinSubtree(false);
    title->GetViewAccessibility().SetIsLeaf(true);
    title->GetViewAccessibility().SetIsIgnored(true);
    title->SetBoundsRect(space_header_->bounds());
    swipe_preview_title_ = title_clip_->AddChildView(std::move(title));
    swipe_preview_title_->DeprecatedLayoutImmediately();
    swipe_preview_space_id_ = adjacent;
  }
  gfx::Transform entrance;
  entrance.Translate(shift + std::copysign(width, -shift), 0);
  swipe_preview_->layer()->SetTransform(entrance);
  swipe_preview_title_->layer()->SetTransform(entrance);
}
void SpaceNavigationView::CompleteSpaceSwipe(float offset, bool flick) {
  const bool had_preview = std::exchange(swipe_preview_active_, false);
  const int width = space_body_ ? space_body_->width() : 0;
  const float threshold = width > 0 ? std::min(kSwipeCommitDistance, width * 0.3f)
                                    : kSwipeCommitDistance;
  const float distance = std::abs(offset);
  if (workspace_->model().spaces().size() > 1 &&
      (distance >= threshold || (flick && distance >= kSwipeFlickDistance))) {
    transition_from_swipe_ = true;
    SwitchRelativeSpace((offset < 0) != base::i18n::IsRTL() ? 1 : -1);
    return;
  }
  if (had_preview && CanAnimateSpace()) {
    AnimateSpaceLayers(kSwipeReturnDuration, 0,
        swipe_preview_ ? std::optional<float>(std::copysign(width, -offset))
                       : std::nullopt);
  } else {
    FinishSpaceTransition();
  }
}
void SpaceNavigationView::RemoveSwipePreview() {
  swipe_preview_space_id_.clear();
  auto* preview = swipe_preview_.get();
  swipe_preview_ = nullptr;
  if (preview) preview->parent()->RemoveChildViewT(preview);
  auto* title = swipe_preview_title_.get();
  swipe_preview_title_ = nullptr;
  if (title) title->parent()->RemoveChildViewT(title);
}
void SpaceNavigationView::ActivateSpace(std::string id) {
  if (editor_ && editor_->HasFocus()) CommitRename();
  if (!workspace_->loaded() || !model_) return;
  SyncTabs();
  auto& ws = workspace_->model();
  if (!ws.FindSpace(id)) return;
  if (id != active_space_id_) {
    if (folder_reveal_) folder_reveal_->Finish();
    ++folder_reveal_generation_;
    folder_reveal_ = nullptr;
    if (swipe_preview_active_) FinishSpaceTransition();
    TRACE_EVENT("browser", "TAi.ActivateSpace", "gesture", gesture_direction_override_ != 0);
    VLOG(1) << "TAi Space switch gesture=" << (gesture_direction_override_ != 0);
    const auto old_index = std::distance(ws.spaces().begin(), std::ranges::find(ws.spaces(), active_space_id_, &WorkspaceSpace::id));
    const auto new_index = std::distance(ws.spaces().begin(), std::ranges::find(ws.spaces(), id, &WorkspaceSpace::id));
    transition_direction_ = gesture_direction_override_
                                ? gesture_direction_override_
                                : (new_index > old_index ? 1 : -1);
    if (base::i18n::IsRTL()) transition_direction_ = -transition_direction_;
  }
  if (!ws.ActivateSpace(id)) return;
  active_space_id_ = id;
  base::AutoReset<bool> changing(&switching_, true);
  std::optional<tabs::TabHandle> target;
  const auto last = last_active_.find(id);
  if (last != last_active_.end() && last->second.Get() &&
      model_->GetIndexOfTab(last->second.Get()) != TabStripModel::kNoTab &&
      bindings_.contains(last->second.raw_value()) &&
      bindings_.at(last->second.raw_value()).space_id == id) target = last->second;
  if (!target) {
    auto tabs = VisibleTabs(false);
    if (!tabs.empty()) target = tabs.front();
  }
  if (target) model_->ActivateTab(target->Get());
  else NewTab(true);
  workspace_->Commit();
  ScheduleRefresh();
}
std::string SpaceNavigationView::AdjacentSpaceId(int delta) const {
  if (!workspace_->loaded()) return {};
  const auto& ws = workspace_->model();
  if (ws.spaces().size() < 2) return {};
  auto it = std::ranges::find(ws.spaces(), active_space_id_, &WorkspaceSpace::id);
  const int index = std::distance(ws.spaces().begin(), it);
  const int n = ws.spaces().size();
  return ws.spaces()[(index + delta + n) % n].id;
}
void SpaceNavigationView::SwitchRelativeSpace(int delta) {
  auto id = AdjacentSpaceId(delta);
  if (id.empty()) return;
  base::AutoReset<int> direction(&gesture_direction_override_, delta < 0 ? -1 : 1);
  ActivateSpace(std::move(id));
}
bool SpaceNavigationView::Swipe(float x, float y) {
  if (!workspace_->loaded() || std::abs(x) <= std::abs(y) || std::abs(x) < 1) return false;
  const auto now = base::TimeTicks::Now();
  if (now - last_swipe_ < base::Milliseconds(450)) return true;
  if (now - last_scroll_ > base::Milliseconds(250)) swipe_distance_ = 0;
  last_scroll_ = now;
  swipe_distance_ += x;
  if (std::abs(swipe_distance_) >= 45) {
    SwitchRelativeSpace(swipe_distance_ < 0 ? 1 : -1);
    swipe_distance_ = 0; last_swipe_ = now;
  }
  return true;
}
SpaceNavigationView::SwipeHandler::SwipeHandler(SpaceNavigationView* owner)
    : owner_(owner) {}

SpaceNavigationView::SwipeHandler::~SwipeHandler() = default;

bool SpaceNavigationView::SwipeHandler::IsOverSidebar(
    const ui::LocatedEvent& event) const {
  auto* widget = owner_->GetWidget();
  return widget && owner_->IsDrawn() &&
         owner_->GetVisibleBounds().Contains(views::View::ConvertPointToTarget(
             widget->GetRootView(), owner_, event.root_location()));
}

void SpaceNavigationView::SwipeHandler::OnScrollEvent(ui::ScrollEvent* event) {
  if (!owner_->model_ || !owner_->workspace_->loaded() || CurrentDrag().source)
    return;
  const bool over_sidebar = IsOverSidebar(*event);
#if BUILDFLAG(IS_MAC)
  if (!owner_->IsDrawn()) {
    Reset();
    return;
  }
  const auto scroll = event->scroll_event_phase();
  const auto momentum = event->momentum_phase();
  const bool began = scroll == ui::ScrollEventPhase::kBegan ||
                     momentum == ui::EventMomentumPhase::MAY_BEGIN;
  const bool ended = scroll == ui::ScrollEventPhase::kEnd ||
                     momentum == ui::EventMomentumPhase::END;
  const auto now = event->time_stamp();
  if (began) {
    if (phase_ == Phase::kHorizontal) Complete(now);
    Reset();
    if (!over_sidebar) phase_ = Phase::kOutside;
  } else if (phase_ == Phase::kMomentum) {
    if (ended || momentum == ui::EventMomentumPhase::INERTIAL_UPDATE) {
      event->StopPropagation();
      if (ended) Reset();
      return;
    }
    Reset();
  }
  if (phase_ == Phase::kOutside) {
    if (ended) Reset();
    return;
  }
  // A latched horizontal swipe can finish outside the sidebar. A new swipe
  // over the page must still reach the page, even after sidebar momentum.
  if (!over_sidebar && phase_ != Phase::kHorizontal) {
    Reset();
    return;
  }
  if (ended) {
    if (phase_ == Phase::kHorizontal) {
      event->StopPropagation();
      Complete(now);
      phase_ = Phase::kMomentum;
    } else {
      Reset();
    }
    return;
  }
  if (event->type() != ui::EventType::kScroll ||
      momentum == ui::EventMomentumPhase::INERTIAL_UPDATE ||
      phase_ == Phase::kVertical) return;
  if (phase_ == Phase::kIdle) phase_ = Phase::kTracking;
  x_ += event->x_offset();
  y_ += event->y_offset();
  if (phase_ == Phase::kTracking) {
    if (std::abs(y_) >= kSwipeAxisLock && std::abs(y_) > std::abs(x_)) {
      phase_ = Phase::kVertical;
      return;
    }
    if (std::abs(x_) < kSwipeAxisLock || std::abs(x_) <= std::abs(y_)) return;
    phase_ = Phase::kHorizontal;
  }
  event->StopPropagation();
  recent_moves_.emplace_back(now, event->x_offset());
  while (!recent_moves_.empty() && now - recent_moves_.front().first > kSwipeFlickWindow)
    recent_moves_.pop_front();
  owner_->PreviewSpaceSwipe(x_);
  lift_timer_.Start(FROM_HERE, base::Seconds(2), base::BindOnce(
      [](SwipeHandler* self) {
        self->Complete(base::TimeTicks::Now());
      }, base::Unretained(this)));
#else
  if (over_sidebar && event->type() == ui::EventType::kScroll &&
      owner_->Swipe(event->x_offset(), event->y_offset())) event->SetHandled();
#endif
}
void SpaceNavigationView::SwipeHandler::Reset() {
  lift_timer_.Stop();
  phase_ = Phase::kIdle;
  x_ = y_ = 0.f;
  recent_moves_.clear();
}
void SpaceNavigationView::SwipeHandler::Complete(base::TimeTicks release) {
  while (!recent_moves_.empty() && release - recent_moves_.front().first > kSwipeFlickWindow)
    recent_moves_.pop_front();
  bool flick = false;
  if (recent_moves_.size() >= 2) {
    const auto span = recent_moves_.back().first - recent_moves_.front().first;
    float distance = 0.f;
    for (const auto& move : recent_moves_) distance += move.second;
    flick = span >= kSwipeFlickMinimumSpan &&
            std::abs(distance) >= kSwipeFlickSpeed * span.InMillisecondsF() &&
            (distance < 0) == (x_ < 0);
  }
  const float offset = x_;
  Reset();
  owner_->CompleteSpaceSwipe(offset, flick);
}
void SpaceNavigationView::SwipeHandler::OnMouseEvent(ui::MouseEvent* event) {
  if (owner_->model_ && !CurrentDrag().source &&
      event->type() == ui::EventType::kMousewheel && IsOverSidebar(*event)) {
    auto* wheel = static_cast<ui::MouseWheelEvent*>(event);
    if (owner_->Swipe(wheel->x_offset(), wheel->y_offset())) event->SetHandled();
  }
}
GURL ProductNewTabURL(BrowserWindowInterface* browser) {
  if (!browser || !SpaceNavigationView::From(browser) || browser->GetProfile()->IsOffTheRecord()) return GURL();
#if BUILDFLAG(ENABLE_EXTENSIONS_CORE)
  if (ExtensionUrlOverrides::GetExtensionControllingURL(GURL("chrome://newtab/"), browser->GetProfile())) return GURL();
#endif
  return GURL("chrome://tai/home.html");
}
void SpaceNavigationView::CreateSpace() {
  if (!workspace_->loaded()) return;
  const auto id = NewId();
  workspace_->model().AddSpace({id,
      "Space " + base::NumberToString(workspace_->model().spaces().size() + 1), "current-profile"});
  ActivateSpace(id);
  BeginRename(id, true);
}
void SpaceNavigationView::NewTab(bool placeholder) {
  if (!model_ || !workspace_->loaded() || browser_->IsDeleteScheduled()) return;
  auto& contents = chrome::NewTab(browser_, NewTabTypes::kNewTabCommand);
  if (auto* tab = tabs::TabInterface::GetFromContents(&contents)) {
    SetBinding(tab, {active_space_id_, {}, placeholder});
  }
  ScheduleRefresh();
}
bool SpaceNavigationView::PerformShortcut(std::string_view action) {
  if (!model_ || !workspace_->loaded()) return false;
  if (action == "toggle_sidebar") ToggleSidebar();
  else if (action == "settings") OpenSettings();
  else if (action == "clear_temporaries") ClearTemporary();
  else if (action == "next_space") SwitchRelativeSpace(1);
  else if (action == "previous_space") SwitchRelativeSpace(-1);
  else if (action == "new_space") CreateSpace();
  else if (action == "new_folder") NewFolder({});
  else if (action == "pin_tab") SaveCurrent({}, false);
  else if (action == "favorite_tab") SaveCurrent({}, true);
  else if (action.starts_with("space_")) {
    int number = 0;
    if (!base::StringToInt(action.substr(6), &number) || number < 1) return false;
    const auto& spaces = workspace_->model().spaces();
    if (number <= static_cast<int>(spaces.size())) ActivateSpace(spaces[number - 1].id);
  } else if (action == "copy_url" || action == "copy_markdown") {
    auto* contents = model_->GetActiveWebContents();
    if (!contents || !contents->GetVisibleURL().is_valid()) return true;
    std::u16string text = base::UTF8ToUTF16(contents->GetVisibleURL().spec());
    if (action == "copy_markdown") {
      std::string title = base::UTF16ToUTF8(contents->GetTitle());
      base::ReplaceSubstringsAfterOffset(&title, 0, "\\", "\\\\");
      base::ReplaceSubstringsAfterOffset(&title, 0, "[", "\\[");
      base::ReplaceSubstringsAfterOffset(&title, 0, "]", "\\]");
      base::ReplaceSubstringsAfterOffset(&title, 0, "\n", " ");
      base::ReplaceSubstringsAfterOffset(&title, 0, "\r", " ");
      std::string url = contents->GetVisibleURL().spec();
      base::ReplaceSubstringsAfterOffset(&url, 0, "(", "%28");
      base::ReplaceSubstringsAfterOffset(&url, 0, ")", "%29");
      text = base::UTF8ToUTF16("[" + title + "](" + url + ")");
    }
    ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste).WriteText(text);
  } else return false;
  return true;
}
bool SpaceNavigationView::CycleRecentTab(int delta, int modifiers) {
  if (!model_ || !workspace_->loaded()) return false;
  SyncTabs();
  const auto visible = VisibleTabs();
  if (visible.empty() || !model_->GetActiveTab()) return true;
  // Freeze MRU order while Control stays down; releasing it commits the new
  // selection order. These are only handles to open tabs, never page history.
  if (recent_cycle_.empty() || recent_cycle_space_ != active_space_id_) {
    recent_cycle_ = visible;
    std::ranges::stable_sort(recent_cycle_, [](auto left, auto right) {
      return left.Get()->GetLastActiveTime() > right.Get()->GetLastActiveTime();
    });
    // WebContents visibility can change during Space layout, so its last-active
    // timestamp is only a startup fallback. Actual tab selections take priority.
    for (auto visit = recent_visits_.rbegin(); visit != recent_visits_.rend(); ++visit) {
      const auto found = std::ranges::find(recent_cycle_, *visit);
      if (found != recent_cycle_.end()) std::rotate(recent_cycle_.begin(), found, found + 1);
    }
    const auto active = std::ranges::find(recent_cycle_, model_->GetActiveTab()->GetHandle());
    if (active != recent_cycle_.end()) std::rotate(recent_cycle_.begin(), active, active + 1);
    recent_cycle_index_ = 0; recent_cycle_space_ = active_space_id_;
    // Switching renderers can suppress the matching key-up in WebContents.
    // Observe modifier release only while this window owns the active cycle. The
    // upstream monitor never consumes events and is removed on release/blur.
    recent_cycle_monitor_ = views::EventMonitor::CreateApplicationMonitor(
        &recent_keys_, GetWidget()->GetNativeWindow(), {ui::EventType::kKeyReleased});
    recent_cycle_modifier_ = modifiers & ui::EF_CONTROL_DOWN ? ui::EF_CONTROL_DOWN :
        modifiers & ui::EF_COMMAND_DOWN ? ui::EF_COMMAND_DOWN : ui::EF_ALT_DOWN;
  }
  std::erase_if(recent_cycle_, [&](auto handle) {
    return !handle.Get() || std::ranges::find(visible, handle) == visible.end();
  });
  if (recent_cycle_.empty()) return true;
  recent_cycle_index_ = (recent_cycle_index_ + recent_cycle_.size() + delta) % recent_cycle_.size();
  model_->ActivateTab(recent_cycle_[recent_cycle_index_].Get());
#if BUILDFLAG(IS_MAC)
  // Native accessibility key equivalents can carry a modifier without a
  // separate release event. Verify once after dispatch rather than polling.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
      base::BindOnce([](base::WeakPtr<SpaceNavigationView> self) {
        if (self && self->recent_cycle_modifier_ &&
            !ShortcutModifierIsDown(self->recent_cycle_modifier_)) self->EndRecentTabCycle();
      }, weak_factory_.GetWeakPtr()));
#endif
  return true;
}
void SpaceNavigationView::EndRecentTabCycle() { recent_cycle_monitor_.reset(); recent_cycle_.clear(); recent_cycle_space_.clear(); recent_cycle_modifier_ = 0; }
void SpaceNavigationView::ReleaseRecentTabCycle(int modifiers) {
  if (recent_cycle_modifier_ && !(modifiers & recent_cycle_modifier_)) EndRecentTabCycle();
}
bool SpaceNavigationView::SelectRelativeTab(int delta) {
  if (!model_ || !workspace_->loaded()) return false;
  SyncTabs();
  const auto visible = VisibleTabs();
  if (visible.empty()) { NewTab(true); return true; }
  auto* active = model_->GetActiveTab();
  int index = 0;
  if (active) {
    auto found = std::ranges::find(visible, active->GetHandle());
    if (found != visible.end()) index = std::distance(visible.begin(), found);
  }
  const int count = visible.size();
  model_->ActivateTab(visible[(index + delta + count) % count].Get());
  return true;
}
bool SpaceNavigationView::SelectNumberedTab(int index) {
  if (!model_ || !workspace_->loaded()) return false;
  SyncTabs();
  // Number the same page rows as the sidebar, not the hidden global tab model.
  // Favorites have their own dock and are deliberately outside Cmd+1..9.
  std::vector<std::pair<std::string, std::optional<tabs::TabHandle>>> rows;
  const auto& ws = workspace_->model();
  auto visit = [&](auto&& self, const std::string& parent) -> void {
    for (const auto& id : ws.Children(active_space_id_, parent)) {
      const auto* item = ws.FindItem(id);
      if (item->kind == SavedKind::kFolder) {
        if (!item->collapsed) self(self, item->id);
      } else if (item->kind == SavedKind::kPage) rows.emplace_back(id, std::nullopt);
    }
  };
  visit(visit, {});
  for (auto handle : VisibleTabs(false))
    if (bindings_.at(handle.raw_value()).item_id.empty()) rows.emplace_back(std::string(), handle);
  if (rows.empty()) return true;
  if (index < 0) index = rows.size() - 1;
  if (index < static_cast<int>(rows.size())) {
    const auto& [item, tab] = rows[index];
    if (!item.empty()) OpenItem(item);
    else if (tab && tab->Get()) model_->ActivateTab(tab->Get());
  }
  return true;
}
void SpaceNavigationView::CloseTab(tabs::TabHandle handle) {
  if (!model_ || !handle.Get() || model_->GetIndexOfTab(handle.Get()) == TabStripModel::kNoTab) return;
  const auto space = active_space_id_;
  if (model_->count() == 1) NewTab(true);
  model_->CloseWebContents(handle.Get()->GetContents(), TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB);
  auto remaining = VisibleTabs(false);
  if (remaining.empty()) NewTab(true);
  else if (model_->GetActiveTab() &&
           std::ranges::find(remaining, model_->GetActiveTab()->GetHandle()) == remaining.end())
    model_->ActivateTab(remaining.front().Get());
  workspace_->model().ActivateSpace(space);
  ScheduleRefresh();
}
bool SpaceNavigationView::CloseActiveTab() {
  if (!model_ || !workspace_->loaded()) return false;
  if (auto* active = model_->GetActiveTab()) CloseTab(active->GetHandle());
  return true;
}
void SpaceNavigationView::ClearTemporary() {
  if (!model_ || !workspace_->loaded() || ClearPending(active_space_id_)) return;
  SyncTabs();
  std::vector<tabs::TabHandle> selected;
  const auto visible = VisibleTabs(false);
  for (auto handle : visible) {
    const auto found = bindings_.find(handle.raw_value());
    if (found != bindings_.end() && found->second.item_id.empty() && !found->second.placeholder) {
      selected.push_back(handle);
      if (selected.size() == kClearBatchLimit) break;
    }
  }
  if (selected.empty()) return;
  clear_batches_[active_space_id_] = {};
  int position = 0;
  for (auto handle : selected) {
    auto observer = std::make_unique<ClearObserver>(handle.Get()->GetContents(), base::BindOnce(
        [](base::WeakPtr<SpaceNavigationView> self, tabs::TabHandle handle) {
          if (self && handle.Get()) self->OnTabCloseCancelled(handle.Get());
        }, weak_factory_.GetWeakPtr(), handle));
    pending_clear_.insert_or_assign(handle.raw_value(), PendingClear{active_space_id_, position++, std::move(observer)});
  }
  for (auto handle : selected) CloseTab(handle);
  ScheduleRefresh();
}
int SpaceNavigationView::TemporaryCount() const {
  int count = 0;
  for (auto handle : VisibleTabs(false)) {
    const auto found = bindings_.find(handle.raw_value());
    if (found != bindings_.end() && found->second.item_id.empty() && !found->second.placeholder) ++count;
  }
  return count;
}
bool SpaceNavigationView::ClearPending(const std::string& space) const {
  return std::ranges::any_of(pending_clear_, [&space](const auto& value) { return value.second.space == space; });
}
std::vector<SessionID> SpaceNavigationView::RestorableClear(const std::string& space) const {
  std::vector<SessionID> result;
  const auto batch = clear_batches_.find(space);
  if (batch == clear_batches_.end() || !browser_) return result;
  auto* history = TabRestoreServiceFactory::GetForProfile(browser_->GetProfile());
  if (!history) return result;
  for (const auto& [position, id] : batch->second.entries) {
    const auto entry = std::ranges::find_if(history->entries(), [id](const auto& value) { return value->id == id; });
    if (entry == history->entries().end() || (*entry)->type != sessions::tab_restore::TAB) continue;
    const auto saved = (*entry)->extra_data.find(kSpaceSessionKey);
    const auto item = (*entry)->extra_data.find(kItemSessionKey);
    if (saved != (*entry)->extra_data.end() && saved->second == space &&
        (item == (*entry)->extra_data.end() || item->second.empty())) result.push_back(id);
  }
  return result;
}
void SpaceNavigationView::RestoreClearedTemporary() {
  if (!model_ || ClearPending(active_space_id_)) return;
  const auto ids = RestorableClear(active_space_id_);
  auto* history = TabRestoreServiceFactory::GetForProfile(browser_->GetProfile());
  auto* context = BrowserLiveTabContext::From(browser_);
  if (!history || !context) return;
  const auto* active = model_->GetActiveTab();
  const auto active_handle = active ? std::optional(active->GetHandle()) : std::nullopt;
  const bool placeholder = active_handle && bindings_.contains(active_handle->raw_value()) &&
      bindings_.at(active_handle->raw_value()).placeholder;
  std::vector<tabs::TabHandle> reopened;
  for (const auto id : ids) {
    const auto restored = history->RestoreEntryById(context, id, WindowOpenDisposition::NEW_BACKGROUND_TAB);
    if (restored && !restored->empty()) {
      // The restore service consumes this exact entry; never fall back to the
      // most recent global entry, which may belong to another Space/window.
      for (int i = 0; i < model_->count(); ++i) {
        auto* tab = model_->GetTabAtIndex(i);
        if (context->GetLiveTabAt(i) == restored->front()) { reopened.push_back(tab->GetHandle()); break; }
      }
      SyncTabs();
    }
  }
  // Consecutive closes can share one tabstrip index. Append in original batch
  // order so native insertion at that index cannot reverse recovered pages.
  for (auto handle : reopened) if (handle.Get())
    model_->MoveWebContentsAt(model_->GetIndexOfTab(handle.Get()), model_->count() - 1, false);
  if (!reopened.empty() && reopened.front().Get() && placeholder) {
    model_->ActivateTab(reopened.front().Get());
    if (active_handle->Get()) model_->CloseWebContents(active_handle->Get()->GetContents(), TabCloseTypes::CLOSE_NONE);
  }
  clear_batches_.erase(active_space_id_);
  ScheduleRefresh();
}
void SpaceNavigationView::OpenItem(std::string id) {
  auto* item = workspace_->model().FindItem(id);
  if (!item || !model_) return;
  if (item->kind == SavedKind::kFolder) {
    const bool expanded = item->collapsed;
    if (!workspace_->model().SetCollapsed(id, !expanded)) return;
    const auto found = folder_rows_.find(id);
    if (found != folder_rows_.end()) {
      auto* rows = found->second.get();
      const unsigned generation = ++folder_reveal_generation_;
      if (folder_reveal_ && folder_reveal_ != rows) folder_reveal_->Finish();
      if (expanded && rows->contents()->children().empty()) {
        int budget = std::numeric_limits<int>::max();
        RenderSaved(rows->contents(), active_space_id_, true, budget,
                    id, rows->child_depth());
      }
      const bool animate = CanAnimateSpace() && !rows->contents()->children().empty();
      folder_reveal_ = animate ? rows : nullptr;
      rows->SetExpanded(expanded, animate,
          base::BindOnce(&SpaceNavigationView::FinishFolderReveal,
                         weak_factory_.GetWeakPtr(), generation));
      // Other windows still receive the model change. This sidebar has already
      // updated the affected subtree and can keep the rest of its views.
      base::AutoReset<bool> updating(&committing_folder_change_, true);
      workspace_->Commit();
      if (!animate) FinishFolderReveal(generation);
      return;
    }
    workspace_->Commit();
    return;
  }
  if (auto tab = LiveItem(id)) {
    model_->ActivateTab(tab->Get()); ScheduleRefresh(); return;
  }
  const auto space = item->space_id;
  const auto url = GURL(item->url);
  if (!url.is_valid()) return;
  NavigateParams params(browser_, url, ui::PAGE_TRANSITION_AUTO_BOOKMARK);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
  if (content::WebContents* contents = params.navigated_or_inserted_contents) {
    if (auto* tab = tabs::TabInterface::GetFromContents(contents)) SetBinding(tab, {space, id, false});
  }
  ScheduleRefresh();
}
void SpaceNavigationView::SaveCurrent(std::string parent, bool favorite) {
  if (!model_ || !model_->GetActiveTab() || !workspace_->loaded()) return;
  SyncTabs();
  auto* tab = model_->GetActiveTab();
  auto* contents = tab->GetContents();
  const auto url = contents->GetVisibleURL();
  if (!url.is_valid() || url.spec() == "chrome://newtab/" || url.spec() == "chrome://new-tab-page/" || url.spec() == "chrome://tai/home.html") return;
  auto& ws = workspace_->model();
  const auto id = NewId();
  const auto space = favorite ? std::string() : active_space_id_;
  auto title = base::UTF16ToUTF8(contents->GetTitle());
  if (title.empty()) title = url.host().empty() ? LocalizedText(browser_->GetProfile(), "页面", "Page") : url.host();
  if (ws.AddItem({id, space, parent, title, url.spec(),
                  favorite ? SavedKind::kFavorite : SavedKind::kPage, false})) {
    if (!parent.empty()) ws.SetCollapsed(parent, false);
    SetBinding(tab, {space, id, false}); workspace_->Commit();
  }
}
void SpaceNavigationView::NewFolder(std::string parent) {
  const auto id = NewId();
  auto& workspace = workspace_->model();
  if (workspace.AddItem({id, active_space_id_, parent,
                                  LocalizedText(browser_->GetProfile(), "新建文件夹", "New folder"), {}, SavedKind::kFolder, false})) {
    if (!parent.empty()) workspace.SetCollapsed(parent, false);
    workspace_->Commit(); BeginRename(id, false);
  }
}
void SpaceNavigationView::BeginRename(std::string id, bool space) {
  edit_id_ = std::move(id); edit_space_ = space;
  editor_ = nullptr;
  Render();
  if (editor_) { editor_->RequestFocus(); editor_->SelectAll(false); }
}
void SpaceNavigationView::CommitRename() {
  if (!editor_) return;
  const auto name = CleanName(editor_->GetText());
  if (!name.empty()) {
    if (edit_space_) workspace_->model().RenameSpace(edit_id_, base::UTF16ToUTF8(name));
    else workspace_->model().RenameItem(edit_id_, base::UTF16ToUTF8(name));
  }
  edit_id_.clear(); editor_ = nullptr; workspace_->Commit(); ScheduleRefresh();
}
bool SpaceNavigationView::HandleKeyEvent(views::Textfield*, const ui::KeyEvent& event) {
  if (event.type() != ui::EventType::kKeyPressed) return false;
  if (event.key_code() == ui::VKEY_RETURN) { CommitRename(); return true; }
  if (event.key_code() == ui::VKEY_ESCAPE) {
    edit_id_.clear(); editor_ = nullptr; ScheduleRefresh(); return true;
  }
  return false;
}

ui::ImageModel SpaceNavigationView::SavedIcon(
    const SavedItem& item, int size, SkColor fallback_color,
    std::optional<tabs::TabHandle> live) {
  if (live && live->Get()) {
    auto* driver = favicon::ContentFaviconDriver::FromWebContents(live->Get()->GetContents());
    if (driver && driver->FaviconIsValid()) {
      auto icon = driver->GetFavicon();
      if (!icon.IsEmpty()) {
        favicon_cache_.insert_or_assign(item.url, icon);
        return ui::ImageModel::FromImage(icon);
      }
    }
  }
  if (auto cached = favicon_cache_.find(item.url); cached != favicon_cache_.end())
    return ui::ImageModel::FromImage(cached->second);
  if (!browser_->GetProfile()->IsOffTheRecord() && requested_favicons_.insert(item.url).second) {
    if (auto* service = FaviconServiceFactory::GetForProfile(browser_->GetProfile(), ServiceAccessType::EXPLICIT_ACCESS)) {
      service->GetFaviconImageForPageURL(GURL(item.url), base::BindOnce(
          [](base::WeakPtr<SpaceNavigationView> self, std::string url,
             const favicon_base::FaviconImageResult& result) {
            if (self && !result.image.IsEmpty()) {
              self->favicon_cache_.insert_or_assign(url, result.image);
              self->ScheduleRefresh();
            }
          }, weak_factory_.GetWeakPtr(), item.url), &favicon_tasks_);
    }
  }
  return ui::ImageModel::FromVectorIcon(kGlobeIcon, fallback_color, size);
}

void SpaceNavigationView::RenderTab(views::BoxLayoutView* parent,
                                    tabs::TabHandle handle, int depth,
                                    bool interactive) {
  auto* tab = handle.Get(); if (!tab) return;
  const bool active = model_->GetActiveTab() == tab;
  const bool dark = IsDark();
  auto* profile = browser_->GetProfile();
  auto title = tab->GetContents()->GetTitle();
  if (title.empty()) title = LocalizedText16(profile, "新标签页", "New Tab");
  const auto found = bindings_.find(handle.raw_value());
  const bool saved = found != bindings_.end() && !found->second.item_id.empty();
  if (saved) {
    if (const auto* item = workspace_->model().FindItem(found->second.item_id))
      title = base::UTF8ToUTF16(item->title);
  }
  views::Button::PressedCallback close;
  std::u16string close_label;
  if (interactive && !collapsed_) {
    close = base::BindRepeating(&SpaceNavigationView::CloseTab,
                                base::Unretained(this), handle);
    close_label = saved
        ? LocalizedText16(profile, "关闭标签页，保留固定链接", "Close tab, keep pinned")
        : LocalizedText16(profile, "关闭标签页", "Close tab");
  }
  auto* row = parent->AddChildView(std::make_unique<TabRow>(
      base::BindRepeating([](SpaceNavigationView* self, tabs::TabHandle handle) {
        if (self->model_ && handle.Get() && self->model_->GetIndexOfTab(handle.Get()) != TabStripModel::kNoTab)
          self->model_->ActivateTab(handle.Get());
      }, base::Unretained(this), handle),
      std::move(close), std::move(title), std::move(close_label), active,
      dark, collapsed_, saved, depth));
  auto* button = row->title_button();
  auto icon = ui::ImageModel::FromVectorIcon(
      kGlobeIcon, dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53), 18);
  if (auto* driver = favicon::ContentFaviconDriver::FromWebContents(tab->GetContents()); driver && driver->FaviconIsValid()) {
    auto favicon = driver->GetFavicon(); if (!favicon.IsEmpty()) icon = ui::ImageModel::FromImage(favicon);
  }
  button->SetImageModel(views::Button::STATE_NORMAL, icon);
  if (interactive) {
    RegisterRow(button, saved ? found->second.item_id
                              : "@tab:" + base::NumberToString(handle.raw_value()),
                saved ? Area::kSaved : Area::kTemporary);
    button->set_context_menu_controller(this);
  }
}
void SpaceNavigationView::RenderSaved(views::BoxLayoutView* parent,
                                      const std::string& space_id,
                                      bool interactive, int& row_budget,
                                      std::string_view parent_id, int depth) {
  // Index the current Space once. Searching the entire workspace for every
  // folder or saved link makes the first animation frame depend on import size.
  std::map<std::string_view, std::vector<const SavedItem*>> children;
  for (const auto& item : workspace_->model().items()) {
    if (item.kind != SavedKind::kFavorite && item.space_id == space_id)
      children[item.parent_id].push_back(&item);
  }
  std::map<std::string_view, tabs::TabHandle> live_items;
  for (int i = 0; i < model_->count(); ++i) {
    const auto handle = model_->GetTabAtIndex(i)->GetHandle();
    const auto binding = bindings_.find(handle.raw_value());
    if (binding != bindings_.end() && !binding->second.item_id.empty())
      live_items.try_emplace(binding->second.item_id, handle);
  }

  const bool dark = IsDark();
  const SkColor icon_color = dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53);
  const auto render = [&](auto&& self, views::BoxLayoutView* rows_parent,
                          std::string_view parent_id,
                          int item_depth) -> void {
    if (item_depth > 32) return;
    const auto rows = children.find(parent_id);
    if (rows == children.end()) return;
    for (const auto* item : rows->second) {
      if (row_budget == 0) break;
      --row_budget;
      const auto live = live_items.find(item->id);
      if (live != live_items.end() && item->kind == SavedKind::kPage) {
        RenderTab(rows_parent, live->second, item_depth, interactive);
        continue;
      }
      auto* row = Row(rows_parent);
      row->SetInsideBorderInsets(gfx::Insets::TLBR(0, item_depth * 12, 0, 0));
      auto* button = row->AddChildView(std::make_unique<SidebarButton>(
          base::BindRepeating(&SpaceNavigationView::OpenItem,
                              base::Unretained(this), item->id),
          collapsed_ ? std::u16string() : base::UTF8ToUTF16(item->title),
          false, dark));
      row->SetFlexForView(button, 1, true);
      button->SetTooltipText(base::UTF8ToUTF16(item->title));
      button->SetImageModel(views::Button::STATE_NORMAL,
          item->kind == SavedKind::kFolder
              ? ui::ImageModel::FromVectorIcon(
                    vector_icons::kFolderOpenIcon,
                    icon_color, 20)
              : SavedIcon(*item, 18, icon_color));
      if (item->kind == SavedKind::kFolder) {
        button->label()->SetFontList(button->label()->font_list()
            .DeriveWithWeight(gfx::Font::Weight::SEMIBOLD));
      }
      if (interactive) {
        RegisterRow(button, item->id, Area::kSaved);
        button->set_context_menu_controller(this);
      }
      if (item->kind != SavedKind::kFolder || collapsed_ ||
          item_depth >= 32 || !children.contains(item->id)) continue;
      if (interactive) {
        auto reveal = std::make_unique<FolderRevealView>(
            item_depth + 1, !item->collapsed);
        if (!item->collapsed)
          self(self, reveal->contents(), item->id, item_depth + 1);
        folder_rows_.emplace(item->id, rows_parent->AddChildView(std::move(reveal)));
      } else if (!item->collapsed) {
        self(self, rows_parent, item->id, item_depth + 1);
      }
    }
  };
  render(render, parent, parent_id, depth);
}
void SpaceNavigationView::FinishFolderReveal(unsigned generation) {
  if (generation != folder_reveal_generation_) return;
  folder_reveal_ = nullptr;
  if (std::exchange(refresh_after_folder_reveal_, false)) ScheduleRefresh();
}
std::unique_ptr<views::BoxLayoutView> SpaceNavigationView::BuildSpaceHeader(
    const std::string& space_id, bool interactive) {
  const bool dark = IsDark();
  auto header = std::make_unique<views::BoxLayoutView>();
  header->SetBetweenChildSpacing(2);
  header->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kCenter);
  header->SetPaintToLayer();
  header->layer()->SetFillsBoundsOpaquely(false);
  header->SetInsideBorderInsets(gfx::Insets::TLBR(14, 0, 6, 0));
  const auto* space = workspace_->model().FindSpace(space_id);
  auto* title = header->AddChildView(std::make_unique<SidebarButton>(
      base::BindRepeating(&SpaceNavigationView::ShowSpaceMenu, base::Unretained(this)),
      base::UTF8ToUTF16(space ? (space->icon + (collapsed_ ? "" : "  " + space->name)) : "🌐 Space"), false, dark));
  title->label()->SetFontList(title->label()->font_list().DeriveWithWeight(gfx::Font::Weight::BOLD));
  title->SetTooltipText(LocalizedText16(browser_->GetProfile(), "Space 设置、新建文件夹、收藏当前页面", "Space settings, new folder and pin current page")); header->SetFlexForView(title, 1, true);
  if (interactive) {
    row_items_[title] = {};
    title->set_context_menu_controller(this);
  }
  if (!collapsed_) {
    auto* menu = header->AddChildView(IconButton(
        base::BindRepeating(&SpaceNavigationView::ShowSpaceMenu, base::Unretained(this)), kMoreVertIcon, dark, 18));
    menu->SetTooltipText(LocalizedText16(browser_->GetProfile(), "Space 设置", "Space settings")); menu->SetPreferredSize(gfx::Size(28, 28));
  }
  return header;
}
std::unique_ptr<views::BoxLayoutView> SpaceNavigationView::BuildSpaceBody(
    const std::string& space_id, bool interactive, int row_budget) {
  // Assemble the rows off the widget so inserting each one does not notify
  // and invalidate the live sidebar and browser hierarchy.
  auto space_body = std::make_unique<views::BoxLayoutView>();
  auto& ws = workspace_->model();
  const bool dark = IsDark();
  space_body->SetOrientation(views::BoxLayout::Orientation::kVertical);
  space_body->SetCrossAxisAlignment(views::BoxLayout::CrossAxisAlignment::kStretch);
  space_body->SetBetweenChildSpacing(3);
  space_body->SetPaintToLayer(); space_body->layer()->SetFillsBoundsOpaquely(false);
  if (interactive && !edit_id_.empty() && !collapsed_) {
    auto* editing = Row(space_body.get());
    editor_ = editing->AddChildView(std::make_unique<views::Textfield>());
    const auto* item = ws.FindItem(edit_id_);
    const auto* editing_space = ws.FindSpace(edit_id_);
    editor_->SetText(base::UTF8ToUTF16(edit_space_ ? (editing_space ? editing_space->name : "") : (item ? item->title : "")));
    editor_->GetViewAccessibility().SetName(LocalizedText16(browser_->GetProfile(), "名称", "Name")); editor_->set_controller(this);
    editing->SetFlexForView(editor_, 1, true);
    auto* done = editing->AddChildView(std::make_unique<SidebarButton>(
        base::BindRepeating(&SpaceNavigationView::CommitRename, base::Unretained(this)), LocalizedText16(browser_->GetProfile(), "保存", "Save"), false, dark));
    done->SetTooltipText(LocalizedText16(browser_->GetProfile(), "保存名称", "Save name"));
  }
  const auto visible = VisibleTabsForSpace(space_id, false);
  RenderSaved(space_body.get(), space_id, interactive, row_budget);
  auto* divider = Row(space_body.get());
  divider->SetInsideBorderInsets(gfx::Insets::TLBR(12, 6, 5, 4));
  auto* line = divider->AddChildView(std::make_unique<views::View>());
  line->SetPreferredSize(gfx::Size(1, 1));
  line->SetBackground(views::CreateSolidBackground(SkColorSetARGB(38, dark ? 255 : 39,
      dark ? 255 : 40, dark ? 255 : 37)));
  divider->SetFlexForView(line, 1);
  if (!collapsed_) {
    const int temporary = std::ranges::count_if(visible, [this](auto tab) {
      const auto& binding = bindings_.at(tab.raw_value());
      return binding.item_id.empty() && !binding.placeholder;
    });
    const int clearing = std::min(temporary, kClearBatchLimit);
    auto* clear = divider->AddChildView(std::make_unique<SidebarButton>(
        base::BindRepeating(&SpaceNavigationView::ClearTemporary, base::Unretained(this)),
        LocalizedText16(browser_->GetProfile(), "清理 ", "Clear ") + base::NumberToString16(clearing), false, dark));
    clear->SetEnabled(temporary > 0 && !ClearPending(space_id));
    clear->SetTooltipText(browser_->GetProfile()->IsOffTheRecord()
        ? LocalizedText16(browser_->GetProfile(), "关闭当前 Space 的前 20 个临时标签；无痕窗口不保留关闭记录", "Close up to 20 temporary tabs in this Space; private windows keep no closed-tab history")
        : LocalizedText16(browser_->GetProfile(), "每次关闭当前 Space 的前 20 个临时标签，可恢复最近一批；收藏与其他 Space 保留", "Close up to 20 temporary tabs in this Space. Restore the last batch; pinned tabs and other Spaces are kept."));
    clear->label()->SetFontList(clear->label()->font_list().DeriveWithSizeDelta(-2));
    if (auto batch = clear_batches_.find(space_id); batch != clear_batches_.end()) {
      auto* feedback = Row(space_body.get());
      const bool pending = ClearPending(space_id);
      const auto recoverable = RestorableClear(space_id).size();
      std::u16string message = pending ? LocalizedText16(browser_->GetProfile(), "正在关闭…", "Closing…") : LocalizedText16(browser_->GetProfile(), "已清理 ", "Cleared ") + base::NumberToString16(batch->second.closed) + LocalizedText16(browser_->GetProfile(), " 个", "");
      if (!pending && batch->second.cancelled) message += LocalizedText16(browser_->GetProfile(), " · 已保留 ", " · Kept ") + base::NumberToString16(batch->second.cancelled) + LocalizedText16(browser_->GetProfile(), " 个", "");
      auto* label = feedback->AddChildView(std::make_unique<views::Label>(message));
      // This Space is painted on a transparent compositor layer for sliding.
      // LCD subpixel text requires an opaque ancestor and DCHECKs otherwise.
      label->SetSubpixelRenderingEnabled(false);
      label->SetAutoColorReadabilityEnabled(false);
      label->SetEnabledColor(IsDark() ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53));
      label->SetHorizontalAlignment(gfx::ALIGN_LEFT);
      label->SetTooltipText(browser_->GetProfile()->IsOffTheRecord() ? LocalizedText16(browser_->GetProfile(), "无痕窗口关闭后无法恢复", "Private tabs cannot be restored after closing")
          : LocalizedText16(browser_->GetProfile(), "恢复入口只属于本窗口、此 Space 最近清理的一批；重启后可使用 Chromium 的最近关闭记录", "Restore applies to the last batch cleared in this window and Space. After restart, use Chromium’s recently closed history."));
      feedback->SetFlexForView(label, 1, true);
      if (recoverable) {
        auto* undo = feedback->AddChildView(std::make_unique<SidebarButton>(
            base::BindRepeating(&SpaceNavigationView::RestoreClearedTemporary, base::Unretained(this)),
            LocalizedText16(browser_->GetProfile(), "恢复 ", "Restore ") + base::NumberToString16(recoverable), false, dark));
        undo->SetEnabled(!pending);
        undo->SetTooltipText(LocalizedText16(browser_->GetProfile(), "恢复这一批仍在 Chromium 关闭记录中的页面与浏览历史", "Restore pages from this batch still available in Chromium’s recently closed history"));
      }
    }
  }
  auto* new_tab = space_body->AddChildView(std::make_unique<NewTabButton>(
      base::BindRepeating(&SpaceNavigationView::NewTab, base::Unretained(this), false),
      collapsed_ ? std::u16string() : LocalizedText16(browser_->GetProfile(), "新标签页", "New Tab"), dark));
  if (interactive) {
    new_tab_button_ = new_tab;
    drop_zones_.push_back({new_tab, Area::kTemporary, space_id, {}});
  }
  new_tab->SetTooltipText(LocalizedText16(browser_->GetProfile(), "新建临时标签", "New temporary tab"));
  for (auto handle : visible) {
    if (row_budget == 0) break;
    const auto& binding = bindings_.at(handle.raw_value());
    if (binding.item_id.empty() && !binding.placeholder) {
      RenderTab(space_body.get(), handle, 0, interactive);
      --row_budget;
    }
  }
  return space_body;
}
void SpaceNavigationView::Render() {
  if (!workspace_->loaded() || !model_) return;
  TRACE_EVENT("browser", "TAi.RenderSidebar");
  const bool switching_space = transition_direction_ != 0;
  const base::ElapsedTimer elapsed;
  std::optional<float> swipe_entrance;
  if (switching_space) {
    if (transition_from_swipe_ && swipe_preview_ &&
        swipe_preview_space_id_ == active_space_id_) {
      swipe_entrance = swipe_preview_->layer()->transform().To2dTranslation().x();
    }
    RemoveSwipePreview();
    ++transition_generation_;
    outgoing_space_layer_.reset();
    outgoing_title_layer_.reset();
    // Keep the already painted outgoing compositor layer alive as the
    // outgoing View tree is replaced. Its bounds share the scroll clip.
    if (CanAnimateSpace() && space_body_->layer()->parent() &&
        !space_body_->bounds().IsEmpty()) {
      space_body_->layer()->GetAnimator()->StopAnimating();
      outgoing_space_layer_ = space_body_->RecreateLayer();
    }
    if (transition_from_swipe_ && CanAnimateSpace() && space_header_ &&
        space_header_->layer()->parent() && !space_header_->bounds().IsEmpty()) {
      space_header_->layer()->GetAnimator()->StopAnimating();
      outgoing_title_layer_ = space_header_->RecreateLayer();
    }
  } else if (IsSpaceTransitionRunning() || swipe_preview_active_) {
    FinishSpaceTransition();
  }
  ClearDropFeedback(); drop_zones_.clear();
  row_items_.clear(); editor_ = nullptr;
  space_body_ = nullptr;
  space_header_ = nullptr;
  ++folder_reveal_generation_;
  folder_reveal_ = nullptr;
  folder_rows_.clear();
  refresh_after_folder_reveal_ = false;
  body_->RemoveAllChildViews();
  favorites_body_->RemoveAllChildViews();
  title_clip_->RemoveAllChildViews();
  dock_->RemoveAllChildViews();
  auto& ws = workspace_->model();
  const bool dark = IsDark();
  const SkColor icon_color = dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53);
  SetBackground(std::make_unique<SidebarBackdrop>(this));
  if (GetWidget()) GetWidget()->GetRootView()->SchedulePaint();
  UpdateFrameButton();
  if (workspace_->load_error()) {
    auto* error = body_->AddChildView(std::make_unique<views::Label>(LocalizedText16(browser_->GetProfile(), "收藏数据未能读取，本次更改暂不保存", "Saved pages could not be read. Changes will not be saved.")));
    error->SetMultiLine(true);
    error->SetSubpixelRenderingEnabled(false);
  }
  auto* const active = model_->GetActiveTab();
  views::BoxLayoutView* favorites = nullptr;
  int favorite_count = 0;
  for (const auto& item : ws.items()) {
    if (item.kind != SavedKind::kFavorite) continue;
    if (favorite_count % (collapsed_ ? 1 : 4) == 0) favorites = Row(favorites_body_, 6);
    auto live = LiveItem(item.id);
    const bool selected = live && active && live->Get() == active;
    auto* button = favorites->AddChildView(std::make_unique<SidebarButton>(
        base::BindRepeating(&SpaceNavigationView::OpenItem, base::Unretained(this), item.id),
        std::u16string(), selected, dark));
    button->SetPreferredSize(gfx::Size(44, 42));
    button->SetTooltipText(base::UTF8ToUTF16(item.title));
    button->SetImageModel(views::Button::STATE_NORMAL,
                          SavedIcon(item, 22, icon_color, live));
    RegisterRow(button, item.id, Area::kFavorite); button->set_context_menu_controller(this);
    favorites->SetFlexForView(button, 1, true);
    ++favorite_count;
  }
  if (!favorites || favorite_count % (collapsed_ ? 1 : 4) == 0) favorites = Row(favorites_body_, 6);
  auto* add_favorite = favorites->AddChildView(std::make_unique<SidebarButton>(
      base::BindRepeating(&SpaceNavigationView::SaveCurrent, base::Unretained(this), std::string(), true),
      std::u16string(), false, dark));
  add_favorite->SetImageModel(views::Button::STATE_NORMAL, ui::ImageModel::FromVectorIcon(kAddIcon,
      dark ? SK_ColorWHITE : SkColorSetRGB(17, 23, 53), 18));
  add_favorite->SetPreferredSize(gfx::Size(44, 42)); add_favorite->SetTooltipText(LocalizedText16(browser_->GetProfile(), "将当前页面加入常用网站", "Add current page to Favorites"));
  favorites->SetFlexForView(add_favorite, 1, true);
  drop_zones_.push_back({add_favorite, Area::kFavorite, {}, {}});
  for (int i = (favorite_count + 1) % (collapsed_ ? 1 : 4); i > 0 && i < 4; ++i) {
    auto* filler = favorites->AddChildView(std::make_unique<views::View>());
    filler->SetPreferredSize(gfx::Size(44, 42)); favorites->SetFlexForView(filler, 1, true);
    drop_zones_.push_back({filler, Area::kFavorite, {}, {}});
  }

  space_header_ = title_clip_->AddChildView(BuildSpaceHeader(active_space_id_, true));
  space_body_ = body_->AddChildView(
      BuildSpaceBody(active_space_id_, true, std::numeric_limits<int>::max()));
  // Large collections use compact indicators and a dedicated full list.
  const auto active_index = std::distance(ws.spaces().begin(),
      std::ranges::find(ws.spaces(), active_space_id_, &WorkspaceSpace::id));
  const int total = ws.spaces().size();
  const auto [compact, slots] = GetSpaceDockLayout(width(), total, collapsed_);
  const int first = std::clamp(static_cast<int>(active_index) - slots / 2, 0, std::max(0, total - slots));
  if (compact) {
    auto* all = dock_->AddChildView(std::make_unique<SidebarButton>(
        base::BindRepeating(&SpaceNavigationView::ShowSpaceChooser, weak_factory_.GetWeakPtr()),
        base::NumberToString16(total), false, dark));
    all->SetBorder(views::CreateEmptyBorder(gfx::Insets()));
    all->SetMinSize(gfx::Size(27, 30));
    all->SetPreferredSize(gfx::Size(27, 30));
    all->SetHorizontalAlignment(gfx::ALIGN_CENTER);
    all->label()->SetFontList(all->label()->font_list().DeriveWithSizeDelta(-4));
    const auto name = LocalizedText16(browser_->GetProfile(), "查看所有 Space", "Show all Spaces") +
                      u" (" + base::NumberToString16(total) + u")";
    all->GetViewAccessibility().SetName(name);
    all->SetTooltipText(name);
  }
  for (int i = first; i < std::min(total, first + slots); ++i) {
    const auto& entry = ws.spaces()[i];
    const bool selected = entry.id == active_space_id_;
    if (collapsed_ && !selected) continue;
    auto action = collapsed_
        ? base::BindRepeating(&SpaceNavigationView::ShowSpaceChooser, weak_factory_.GetWeakPtr())
        : base::BindRepeating(&SpaceNavigationView::ActivateSpace, weak_factory_.GetWeakPtr(), entry.id);
    auto* dot = dock_->AddChildView(std::make_unique<SpaceDockButton>(
        std::move(action), base::UTF8ToUTF16(entry.icon), selected, compact && !selected, dark));
    dot->SetTooltipText(base::UTF8ToUTF16(entry.name));
    dot->GetViewAccessibility().SetName(base::UTF8ToUTF16(entry.name));
    dot->GetViewAccessibility().SetIsSelected(selected);
    drop_zones_.push_back({dot, Area::kSpace, entry.id, {}});
  }
  if (!collapsed_) {
    auto* spacer = dock_->AddChildView(std::make_unique<views::View>());
    dock_->SetFlexForView(spacer, 1);
    auto* settings = dock_->AddChildView(IconButton(
        base::BindRepeating(&SpaceNavigationView::OpenSettings, base::Unretained(this)),
        vector_icons::kSettingsIcon, dark, 18));
    settings->SetPreferredSize(gfx::Size(28, 28));
    settings->SetTooltipText(LocalizedText16(browser_->GetProfile(), "TAi 设置", "TAi settings")); settings->SetID(0x544149);
    settings->SetEnabled(!browser_->GetProfile()->IsOffTheRecord());
    auto* create = dock_->AddChildView(IconButton(
        base::BindRepeating(&SpaceNavigationView::CreateSpace, base::Unretained(this)), kAddIcon, dark, 18));
    create->SetPreferredSize(gfx::Size(28, 28)); create->SetTooltipText(LocalizedText16(browser_->GetProfile(), "新建 Space", "New Space"));
  }
  InvalidateLayout();
  PlaySpaceTransition(swipe_entrance);
  if (switching_space || elapsed.Elapsed() >= base::Milliseconds(50)) {
    VLOG(1) << "TAi sidebar render took " << elapsed.Elapsed().InMilliseconds()
            << " ms, rows=" << row_items_.size() << ", spaces=" << total;
  }
}
void SpaceNavigationView::OpenSettings() {
  if (!browser_ || browser_->GetProfile()->IsOffTheRecord()) return;
  NavigateParams params(browser_, GURL("chrome://tai/?space=" +
      base::EscapeQueryParamValue(active_space_id_, true)), ui::PAGE_TRANSITION_AUTO_BOOKMARK);
  params.disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  Navigate(&params);
}
void SpaceNavigationView::ShowSpaceMenu() {
  const auto anchor = space_header_ ? space_header_->GetBoundsInScreen() : GetBoundsInScreen();
  ShowContextMenuForViewImpl(this, gfx::Point(anchor.x(), anchor.bottom()), ui::mojom::MenuSourceType::kMouse);
}
void SpaceNavigationView::ShowSpaceChooser() {
  if (!browser_ || !GetWidget() || !workspace_->loaded()) return;
  if (space_chooser_widget_) {
    if (!space_chooser_widget_->IsClosed()) space_chooser_widget_->Activate();
    return;
  }
  space_chooser_delegate_ = std::make_unique<SpaceChooserBubble>(
      browser_->GetProfile(), dock_, workspace_->model().spaces(), active_space_id_,
      color_utils::IsDark(GetColorProvider()->GetColor(ui::kColorBubbleBackground)),
      base::BindRepeating([](base::WeakPtr<SpaceNavigationView> self, std::string id) {
        if (!self) return;
        self->space_chooser_widget_->Close();
        self->ActivateSpace(std::move(id));
      }, weak_factory_.GetWeakPtr()));
  space_chooser_widget_ = views::BubbleDialogDelegate::CreateBubble(
      space_chooser_delegate_.get(),
      base::BindOnce([](base::WeakPtr<SpaceNavigationView> self, views::Widget::ClosedReason) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
            base::BindOnce([](base::WeakPtr<SpaceNavigationView> self) {
              if (self) {
                self->space_chooser_widget_.reset();
                self->space_chooser_delegate_.reset();
              }
            }, self));
      }, weak_factory_.GetWeakPtr()));
  space_chooser_widget_->Show();
}
void SpaceNavigationView::ShowContextMenuForViewImpl(
    views::View* source, const gfx::Point& point, ui::mojom::MenuSourceType type) {
  if (!workspace_->loaded() || !model_ || (menu_runner_ && menu_runner_->IsRunning())) return;
  menu_item_ = row_items_.contains(source) ? row_items_[source] : std::string();
  menu_runner_.reset();
  menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
  folder_move_menu_.reset();
  folder_menu_destinations_.clear();
  auto* item = workspace_->model().FindItem(menu_item_);
  if (item && item->kind == SavedKind::kFolder) {
    BuildFolderMenu(*item);
  } else {
    menu_model_->AddItem(kRename, item ? LocalizedText16(browser_->GetProfile(), "重命名", "Rename") : LocalizedText16(browser_->GetProfile(), "重命名 Space", "Rename Space"));
    menu_model_->AddItem(kFolder, LocalizedText16(browser_->GetProfile(), "新建文件夹", "New folder"));
    menu_model_->AddItem(kSave, LocalizedText16(browser_->GetProfile(), "收藏当前页面", "Pin current page"));
    menu_model_->AddItem(kFavorite, LocalizedText16(browser_->GetProfile(), "将当前页面加入常用网站", "Add current page to Favorites"));
    if (item || menu_item_.starts_with("@tab:")) {
      menu_model_->AddItem(kClose, LocalizedText16(browser_->GetProfile(), "关闭页面", "Close tab"));
      if (item) {
        menu_model_->AddItem(kRemove, LocalizedText16(browser_->GetProfile(), "移除收藏（已打开页面保留）", "Unpin (keep open tab)"));
        if (item->kind == SavedKind::kPage) {
          menu_model_->AddItem(kMoveRoot, LocalizedText16(browser_->GetProfile(), "移到收藏区根目录", "Move to pinned root"));
          int n = 0;
          for (const auto& folder : workspace_->model().items()) {
            if (folder.kind == SavedKind::kFolder && folder.space_id == item->space_id)
              menu_model_->AddItem(kMoveFolderBase + n, LocalizedText16(browser_->GetProfile(), "移到 ", "Move to ") + base::UTF8ToUTF16(folder.title));
            ++n;
          }
        }
      }
    }
    menu_model_->AddItem(kAppearance, LocalizedText16(browser_->GetProfile(), "更改 Space 颜色", "Change Space color"));
    menu_model_->AddItem(kSpaceIcon, LocalizedText16(browser_->GetProfile(), "更改 Space 图标…", "Change Space icon…"));
    if (item || menu_item_.starts_with("@tab:")) menu_model_->AddItem(kNewWindow, LocalizedText16(browser_->GetProfile(), "移到新窗口", "Move to new window"));
    menu_model_->AddItem(kNewSpace, LocalizedText16(browser_->GetProfile(), "新建 Space", "New Space"));
    menu_model_->AddItem(kSettings, LocalizedText16(browser_->GetProfile(), "TAi 设置", "TAi settings"));
    menu_model_->AddSeparator(ui::NORMAL_SEPARATOR);
    int space_index = 0;
    for (const auto& space : workspace_->model().spaces()) {
      menu_model_->AddItem(kSwitchSpaceBase + space_index++, LocalizedText16(browser_->GetProfile(), "切换到 ", "Switch to ") + base::UTF8ToUTF16(space.icon + " " + space.name));
    }
  }
  menu_runner_ = std::make_unique<views::MenuRunner>(menu_model_.get(), views::MenuRunner::CONTEXT_MENU);
  menu_runner_->RunMenuAt(GetWidget(), nullptr, gfx::Rect(point, gfx::Size()),
                           views::MenuAnchorPosition::kTopLeft, type);
  ScheduleRefresh();
}

void SpaceNavigationView::BuildFolderMenu(const SavedItem& folder) {
  const auto label = [this](std::string_view zh, std::string_view en) {
    return LocalizedText16(browser_->GetProfile(), zh, en);
  };
  const auto& ws = workspace_->model();
  menu_model_->AddItem(kRename, label("重命名文件夹…", "Rename Folder…"));
  if (std::ranges::any_of(ws.items(), [&](const SavedItem& item) {
        return item.parent_id == folder.id;
      })) {
    menu_model_->AddItem(kToggleFolder, folder.collapsed
        ? label("展开文件夹", "Expand Folder")
        : label("收起文件夹", "Collapse Folder"));
  }
  menu_model_->AddItem(kFolder, label("新建子文件夹", "New Subfolder"));
  if (IsCommandIdEnabled(kSave))
    menu_model_->AddItem(kSave, label("收藏当前页面到此处", "Pin Current Page Here"));
  const auto* current = ws.FindSpace(folder.space_id);
  if (current) {
    folder_move_menu_ = std::make_unique<ui::SimpleMenuModel>(this);
    for (const auto& space : ws.spaces()) {
      if (space.id == current->id || space.profile_key != current->profile_key)
        continue;
      folder_move_menu_->AddItem(
          kMoveFolderToSpaceBase + static_cast<int>(folder_menu_destinations_.size()),
          base::UTF8ToUTF16(space.icon + " " + space.name));
      folder_menu_destinations_.push_back(space.id);
    }
    if (!folder_menu_destinations_.empty()) {
      menu_model_->AddSubMenu(kMoveFolderToSpace,
          label("将文件夹移到 Space", "Move Folder to Space"), folder_move_menu_.get());
    }
  }
  menu_model_->AddSeparator(ui::NORMAL_SEPARATOR);
  if (!FolderOpenTabs(folder).empty())
    menu_model_->AddItem(kCloseFolderTabs, label("关闭文件夹中的标签页", "Close Open Tabs"));
  menu_model_->AddItem(kRemove, label("移除文件夹（保留打开的标签页）",
                                      "Remove Folder (Keep Open Tabs)"));
}

std::vector<tabs::TabHandle> SpaceNavigationView::FolderOpenTabs(
    const SavedItem& folder) const {
  const auto& ws = workspace_->model();
  std::vector<tabs::TabHandle> result;
  for (auto handle : VisibleTabs(false)) {
    const auto binding = bindings_.find(handle.raw_value());
    if (binding == bindings_.end() || binding->second.space_id != folder.space_id)
      continue;
    for (auto* item = ws.FindItem(binding->second.item_id); item && !item->parent_id.empty();
         item = ws.FindItem(item->parent_id)) {
      if (item->parent_id == folder.id) {
        result.push_back(handle);
        break;
      }
    }
  }
  return result;
}

bool SpaceNavigationView::IsCommandIdEnabled(int command) const {
  const auto* item = workspace_->model().FindItem(menu_item_);
  if (command == kSettings || command == kSpaceIcon) return !browser_->GetProfile()->IsOffTheRecord();
  if (command == kNewWindow && item && item->kind == SavedKind::kFolder) return false;
  if (command == kRename) return !menu_item_.starts_with("@tab:");
  if (command == kClose && item) return LiveItem(item->id).has_value();
  if (command == kSave || command == kFavorite) {
    auto* contents = model_->GetActiveWebContents();
    return contents && contents->GetVisibleURL().is_valid() &&
           contents->GetVisibleURL().spec() != "chrome://newtab/" &&
           contents->GetVisibleURL().spec() != "chrome://new-tab-page/" &&
           contents->GetVisibleURL().spec() != "chrome://tai/home.html";
  }
  return true;
}
void SpaceNavigationView::ExecuteCommand(int command, int) {
  auto* item = workspace_->model().FindItem(menu_item_);
  const auto parent = item && item->kind == SavedKind::kFolder ? item->id : std::string();
  if (command == kRename) BeginRename(item ? item->id : active_space_id_, !item);
  else if (command == kFolder) NewFolder(parent);
  else if (command == kToggleFolder && !parent.empty()) {
    OpenItem(parent);
    return;
  } else if (command == kCloseFolderTabs && !parent.empty()) {
    auto tabs = FolderOpenTabs(*item);
    const auto* active = model_->GetActiveTab();
    if (active) {
      const auto found = std::ranges::find(tabs, active->GetHandle());
      if (found != tabs.end()) std::rotate(found, found + 1, tabs.end());
    }
    for (auto handle : tabs) CloseTab(handle);
  }
  else if (command == kSave) SaveCurrent(parent, false);
  else if (command == kFavorite) SaveCurrent({}, true);
  else if (command == kNewSpace) CreateSpace();
  else if (command == kSettings) OpenSettings();
  else if (command == kSpaceIcon) OpenSettings();
  else if (command == kAppearance) ShowAppearance();
  else if (command == kNewWindow) {
    std::optional<tabs::TabHandle> handle;
    if (item) { OpenItem(item->id); handle = LiveItem(item->id); }
    else if (menu_item_.starts_with("@tab:")) {
      int value = 0; if (base::StringToInt(menu_item_.substr(5), &value)) handle = tabs::TabHandle(value);
    }
    if (handle && handle->Get()) {
      if (model_->count() == 1) NewTab(true);
      chrome::MoveTabsToNewWindow(browser_, {model_->GetIndexOfTab(handle->Get())});
    }
  }
  else if (command >= kMoveFolderToSpaceBase) {
    const auto index = static_cast<size_t>(command - kMoveFolderToSpaceBase);
    if (!parent.empty() && index < folder_menu_destinations_.size()) {
      const auto destination = folder_menu_destinations_[index];
      ApplyDrop(this, parent, {Area::kSaved, destination, {}, {}, 0, nullptr});
    }
  } else if (command >= kSwitchSpaceBase) {
    const int index = command - kSwitchSpaceBase;
    const auto& spaces = workspace_->model().spaces();
    if (index < static_cast<int>(spaces.size())) ActivateSpace(spaces[index].id);
  }
  else if (command == kRemove && item) {
    workspace_->model().RemoveItem(item->id); workspace_->Commit();
  } else if (command == kClose) {
    if (item) { if (auto tab = LiveItem(item->id)) CloseTab(*tab); }
    else if (menu_item_.starts_with("@tab:")) {
      int value = 0; if (base::StringToInt(menu_item_.substr(5), &value)) CloseTab(tabs::TabHandle(value));
    }
  } else if (command == kMoveRoot && item) {
    workspace_->model().MoveItem(item->id, {}); workspace_->Commit();
  } else if (command >= kMoveFolderBase && item) {
    const int index = command - kMoveFolderBase;
    const auto& nodes = workspace_->model().items();
    if (index < static_cast<int>(nodes.size())) {
      const auto destination = nodes[index].id;
      workspace_->model().MoveItem(item->id, destination); workspace_->Commit();
    }
  }
  ScheduleRefresh();
}
void SpaceNavigationView::OnTabStripModelChanged(TabStripModel*, const TabStripModelChange& change,
                                                const TabStripSelectionChange& selection) {
  if (selection.active_tab_changed() && selection.new_tab) {
    const auto handle = selection.new_tab->GetHandle();
    std::erase_if(recent_visits_, [handle](auto entry) { return !entry.Get() || entry == handle; });
    recent_visits_.insert(recent_visits_.begin(), handle);
  }
  std::erase_if(recent_visits_, [](auto entry) { return !entry.Get(); });
  SchedulePageChromeRefresh();
  if (change.type() == TabStripModelChange::kRemoved) for (const auto& tab : change.GetRemove()->contents) {
    const auto pending = pending_clear_.find(tab.tab->GetHandle().raw_value());
    if (pending == pending_clear_.end()) continue;
    auto& batch = clear_batches_[pending->second.space];
    const bool deleted = TabRemoveReasonUtils::WillDeleteTab(tab.remove_reason);
    if (deleted) ++batch.closed;
    else ++batch.cancelled;
    if (tab.session_id) batch.entries.insert_or_assign(pending->second.position, *tab.session_id);
    pending_clear_.erase(pending);
  }
  ScheduleRefresh();
}
void SpaceNavigationView::OnTabCloseCancelled(const tabs::TabInterface* tab) {
  const auto pending = pending_clear_.find(tab->GetHandle().raw_value());
  if (pending != pending_clear_.end()) {
    ++clear_batches_[pending->second.space].cancelled;
    pending_clear_.erase(pending);
    ScheduleRefresh();
  }
}
void SpaceNavigationView::OnTabChangedAt(tabs::TabInterface*, TabChangeType) { ScheduleRefresh(); }
void SpaceNavigationView::OnTabStripModelDestroyed(TabStripModel*) {
#if BUILDFLAG(IS_MAC)
  ForgetGlobalSearchWindow(browser_);
#endif
  page_chrome_observer_.reset();
  weak_factory_.InvalidateWeakPtrs(); model_ = nullptr; browser_ = nullptr; SetEnabled(false);
}

void SpaceNavigationView::RunSmokeTest(tabs::VerticalTabStripStateController* state_controller, int retries) {
  if (!browser_ || !model_) return;
  const auto data_dir = base::CommandLine::ForCurrentProcess()->GetSwitchValuePath("user-data-dir");
  if (!data_dir.BaseName().AsUTF8Unsafe().starts_with("native-smoke-") ||
      browser_->GetProfile()->GetPath().DirName() != data_dir) return;
  if (!workspace_->loaded()) {
    if (retries < 30) base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
        FROM_HERE, base::BindOnce(&SpaceNavigationView::RunSmokeTest, weak_factory_.GetWeakPtr(),
                                  state_controller, retries + 1), base::Milliseconds(100));
    return;
  }
  static bool started = false;
  if (started) return;
  started = true;
  SyncTabs();
  base::ListValue checks;
  RunShortcutValidationChecks(checks);
  auto expect = [&checks](std::string name, bool passed) {
    base::DictValue result; result.Set("check", std::move(name)); result.Set("passed", passed);
    checks.Append(std::move(result)); return passed;
  };
  {
    base::RepeatingClosure noop = base::DoNothing();
    auto* row = AddChildView(std::make_unique<TabRow>(
        noop, noop, u"Background page",
        u"Close tab", false, false, false, false, 1));
    row->SetSize(gfx::Size(200, 38));
    row->DeprecatedLayoutImmediately();
    const auto title_bounds = row->title_button()->bounds();
    const auto row_size = row->GetPreferredSize();
    const views::View* close = row->children().back();
    const auto action_center = close->GetMirroredBounds().CenterPoint();
    expect("background tab reserves a close slot with no idle close target",
           !close->GetVisible() &&
               row->GetEventHandlerForPoint(action_center) == row->title_button());
    views::View& row_view = *row;
    row_view.OnMouseEntered(ui::MouseEvent(
        ui::EventType::kMouseEntered, action_center, action_center,
        base::TimeTicks::Now(), 0, 0));
    row->DeprecatedLayoutImmediately();
    expect("hover reveals the background close target without shifting the title",
           close->GetVisible() &&
               row->GetEventHandlerForPoint(action_center) == close &&
               row->title_button()->bounds() == title_bounds &&
               row->GetPreferredSize() == row_size);
    row_view.OnMouseExited(ui::MouseEvent(
        ui::EventType::kMouseExited, action_center, action_center,
        base::TimeTicks::Now(), 0, 0));
    expect("close target disappears when the pointer leaves the whole row",
           !close->GetVisible());
    RemoveChildViewT(row);
  }
  const auto internal_alias = CanonicalTaiInput(GURL("tai://settings/privacy?search=site#cookies"));
  expect("brand input alias retains the real Chromium settings origin and subpath", internal_alias && internal_alias->spec() == "chrome://settings/privacy?search=site#cookies");
  const auto preferences_alias = CanonicalTaiInput(GURL("tai://preferences/?space=example#shortcuts"));
  expect("brand preferences alias maps only to the existing TAi WebUI", preferences_alias && preferences_alias->spec() == "chrome://tai/?space=example#shortcuts" && DisplayTaiURL(*preferences_alias, u"chrome://tai/?space=example#shortcuts") == u"tai://preferences/?space=example#shortcuts");
  expect("brand aliases reject credentials ports and opaque inputs", !CanonicalTaiInput(GURL("tai://user:pass@settings/")) && !CanonicalTaiInput(GURL("tai://settings:8080/")) && !CanonicalTaiInput(GURL("tai:settings")));
  expect("brand display changes only browser management URLs", DisplayTaiURL(GURL("chrome://settings/"), u"chrome://settings") == u"tai://settings" && DisplayTaiURL(GURL("https://example.test/chrome://settings"), u"example.test/chrome://settings") == u"example.test/chrome://settings");
#if BUILDFLAG(IS_MAC)
  expect("global search initializes native table before assigning its controller without displaying a window", CheckGlobalSearchInitialization());
#endif
  auto& ws = workspace_->model();
  const auto a = ws.active_space_id();
  NewTab(); SyncTabs();
  const auto tab_a = model_->GetActiveTab()->GetHandle();
  expect("TAi new tabs retain default omnibox focus", tab_a.Get()->GetContents()->FocusLocationBarByDefault());
  expect("new tab is owned by independent Space A", bindings_[tab_a.raw_value()].space_id == a);
  const auto b = NewId(); ws.AddSpace({b, "Space B", "current-profile"}); ActivateSpace(b);
  NewTab(); SyncTabs(); const auto tab_b = model_->GetActiveTab()->GetHandle();
  expect("Space B has separate tab membership", bindings_[tab_b.raw_value()].space_id == b);
  expect("Spaces do not create Chromium tab groups", model_->group_model()->ListTabGroups().empty());
  ActivateSpace(a); expect("switch restores Space A live tab", model_->GetActiveTab() == tab_a.Get());
  ActivateSpace(b); expect("switch restores Space B live tab", model_->GetActiveTab() == tab_b.Get());
  chrome::SelectNextTab(browser_); SyncTabs();
  expect("next-tab shortcut stays in current Space", bindings_[model_->GetActiveTab()->GetHandle().raw_value()].space_id == b);
  const auto folder = NewId(), nested = NewId(), page = NewId();
  expect("create folder", ws.AddItem({folder, b, {}, "Research", {}, SavedKind::kFolder}));
  expect("create nested folder", ws.AddItem({nested, b, folder, "Notes", {}, SavedKind::kFolder}));
  expect("save page inside nested folder", ws.AddItem({page, b, nested, "Saved", "https://example.com/", SavedKind::kPage}));
  SetBinding(tab_b.Get(), {b, page, false});
  CloseTab(tab_b); expect("closing a saved page retains entry", ws.FindItem(page) != nullptr && !LiveItem(page));
  const auto before = ws.spaces().size(); const auto empty = NewId();
  ws.AddSpace({empty, "Empty", "current-profile"});
  expect("empty Space persists independently of groups", ws.spaces().size() == before + 1);
  ws.RenameSpace(b, "Renamed B"); expect("rename preserves Space identity", ws.FindSpace(b)->name == "Renamed B");
  ActivateSpace(a); last_swipe_ = {}; swipe_distance_ = 0; Swipe(-60, 0);
  expect("horizontal sidebar gesture changes Space", ws.active_space_id() == b);
  state_controller->SetVerticalTabsEnabled(false);
  expect("horizontal tab strip stays disabled", state_controller->ShouldDisplayVerticalTabs());
  expect("each Space owns its color", ws.SetSpaceColor(a, "#CCDDF2") &&
      ws.SetSpaceColor(b, "#35333F") && ws.FindSpace(a)->color != ws.FindSpace(b)->color);
  ActivateSpace(a);
  expect("Space switch updates background and contrast", SidebarColor() == 0xffccddf2 && !IsDark());
  ActivateSpace(b);
  expect("dark custom Space uses light foreground", SidebarColor() == 0xff35333f && IsDark());
  const auto moving = NewId();
  ws.AddItem({moving, a, {}, "Move me", "https://example.com/", SavedKind::kPage});
  SetBinding(tab_a.Get(), {a, moving, false});
  auto* const contents_before = tab_a.Get()->GetContents();
  expect("drop saved page into Favorites", ApplyDrop(this, moving, {Area::kFavorite, {}, {}, {}, 3, nullptr}) &&
      ws.FindItem(moving)->kind == SavedKind::kFavorite && bindings_[tab_a.raw_value()].space_id.empty());
  expect("drop Favorite into another Space folder", ApplyDrop(this, moving, {Area::kSaved, b, nested, {}, 3, nullptr}) &&
      ws.FindItem(moving)->parent_id == nested && bindings_[tab_a.raw_value()].space_id == b);
  expect("drop saved page into temporary section", ApplyDrop(this, moving, {Area::kTemporary, b, {}, {}, 3, nullptr}) &&
      !ws.FindItem(moving) && bindings_[tab_a.raw_value()].item_id.empty());
  expect("drag conversions preserve the live WebContents", tab_a.Get()->GetContents() == contents_before);
  expect("folder cannot become a Favorite", !ApplyDrop(this, folder, {Area::kFavorite, {}, {}, {}, 3, nullptr}) &&
      ws.FindItem(nested)->parent_id == folder);
  expect("folder can move with descendants across Spaces", ApplyDrop(this, folder, {Area::kSaved, a, {}, {}, 3, nullptr}) &&
      ws.FindItem(page)->space_id == a && ws.FindItem(nested)->space_id == a);
  ActivateSpace(b); NewTab(); SyncTabs(); const auto other = model_->GetActiveTab()->GetHandle();
  const auto other_key = "@tab:" + base::NumberToString(other.raw_value());
  const auto tab_key = "@tab:" + base::NumberToString(tab_a.raw_value());
  expect("temporary drop reorders real Chromium tabs", ApplyDrop(this, other_key,
      {Area::kTemporary, b, {}, tab_key, 1, nullptr}) && model_->GetIndexOfTab(other.Get()) < model_->GetIndexOfTab(tab_a.Get()));
  Render();
  auto row = std::ranges::find_if(row_items_, [&tab_key](const auto& entry) { return entry.second == tab_key; });
  ui::OSExchangeData valid_drag;
  if (row != row_items_.end()) WriteDragDataForView(row->first, gfx::Point(10, 10), &valid_drag);
  expect("native OS drop format recognizes an active internal drag", CanDrop(valid_drag));
  ui::OSExchangeData forged; base::Pickle nonce; nonce.WriteString("untrusted");
  forged.SetPickledData(SidebarDragFormat(), nonce);
  expect("untrusted drag nonce is rejected", !CanDrop(forged));
  CurrentDrag() = {};

  // Exercise the real Views callback, including a deferred policy drop after
  // the source loop completes, instead of testing only the mutation helper.
  SetBinding(tab_a.Get(), {a, page, false});
  ActivateSpace(a); FinishSpaceTransition(); Render();
  GetWidget()->LayoutRootViewIfNecessary();
  row = std::ranges::find_if(row_items_, [&page](const auto& entry) { return entry.second == page; });
  ui::OSExchangeData callback_data;
  if (row != row_items_.end()) WriteDragDataForView(row->first, gfx::Point(10, 10), &callback_data);
  gfx::Point drop_point;
  bool have_target = false;
  for (const auto& zone : drop_zones_) {
    if (zone.area != Area::kFavorite) continue;
    drop_point = zone.view->GetLocalBounds().CenterPoint();
    views::View::ConvertPointToTarget(zone.view, this, &drop_point);
    have_target = true; break;
  }
  ui::DropTargetEvent callback_event(callback_data, gfx::PointF(drop_point), gfx::PointF(drop_point), ui::DragDropTypes::DRAG_MOVE);
  auto operation = ui::mojom::DragOperation::kNone;
  if (have_target && CanDrop(callback_data)) {
    OnDragEntered(callback_event);
    auto callback = GetDropCallback(callback_event);
    OnWidgetDragDropCompleted(GetWidget());
    std::move(callback).Run(callback_event, operation, nullptr);
  }
  expect("Views drop callback survives source-loop completion", operation == ui::mojom::DragOperation::kMove &&
      !bindings_[tab_a.raw_value()].item_id.empty() && bindings_[tab_a.raw_value()].space_id.empty());
  expect("Views drop preserves live page identity", tab_a.Get()->GetContents() == contents_before);
  // Use a second real browser window to verify transfer of the same TabModel.
  auto* second_browser = chrome::OpenEmptyWindow(browser_->GetProfile(), false);
  auto* second = SpaceNavigationView::From(second_browser);
  if (second) { second->SyncTabs(); second->ActivateSpace(b); }
  const auto moved_id = bindings_[tab_a.raw_value()].item_id;
  const bool transferred = second && second->ApplyDrop(this, moved_id, {Area::kTemporary, b, {}, {}, 3, nullptr});
  expect("drop transfers a live tab between same-Profile windows", transferred &&
      model_->GetIndexOfTab(tab_a.Get()) == TabStripModel::kNoTab &&
      second->model_->GetIndexOfTab(tab_a.Get()) != TabStripModel::kNoTab &&
      tab_a.Get()->GetContents() == contents_before);
  const bool returned = transferred && ApplyDrop(second, tab_key, {Area::kTemporary, b, {}, {}, 3, nullptr});
  expect("transferred tab can return without reloading", returned &&
      model_->GetIndexOfTab(tab_a.Get()) != TabStripModel::kNoTab && tab_a.Get()->GetContents() == contents_before);

  ActivateSpace(a);
  FinishSpaceTransition();
  Render();
  GetWidget()->LayoutRootViewIfNecessary();
  const bool animate = gfx::Animation::ShouldRenderRichAnimation();
  auto swipe_to = [&](float offset, const std::string& id) {
    last_swipe_ = {};
    swipe_distance_ = 0;
    Swipe(offset, 0);
    Refresh();
    const auto* layer = space_body_->layer();
    const float x = layer->transform().To2dTranslation().x();
    if (active_space_id_ != id) return false;
    if (!animate) {
      return !IsSpaceTransitionRunning() && x == 0 && layer->opacity() == 1.f;
    }
    return IsSpaceTransitionRunning() && x * offset < 0 &&
           std::abs(x) <= kSpaceSlideOffset &&
           layer->GetTargetTransform().IsIdentity();
  };
  expect("next Space slides in from the right", swipe_to(-60, b));
  expect("a rapid reversal slides the previous Space in from the left", swipe_to(60, a));

  const auto sidebar_bounds = bounds();
  auto resized_bounds = sidebar_bounds;
  resized_bounds.set_height(sidebar_bounds.height() + 1);
  SetBoundsRect(resized_bounds);
  expect("height-only relayout keeps Space motion active without rebuilding the dock",
      IsSpaceTransitionRunning() == animate && !resize_refresh_timer_.IsRunning());
  resized_bounds.set_width(sidebar_bounds.width() + 1);
  SetBoundsRect(resized_bounds);
  expect("width changes settle Space motion at its final position",
      !IsSpaceTransitionRunning() && space_body_->layer()->transform().IsIdentity() &&
      space_body_->layer()->opacity() == 1.f);
  SetBoundsRect(sidebar_bounds);
#if BUILDFLAG(IS_MAC)
  GetWidget()->LayoutRootViewIfNecessary();
  const std::string preview_pin = NewId();
  ws.AddItem({preview_pin, b, {}, "Neighbour preview pin",
              "https://example.invalid/preview", SavedKind::kPage});
  const auto rows_before_swipe = row_items_.size();
  const auto preview_has_pin = [&](auto&& self, views::View* view) -> bool {
    if (auto* button = views::AsViewClass<SidebarButton>(view);
        button && button->GetText() == u"Neighbour preview pin") return true;
    return std::ranges::any_of(view->children(), [&](views::View* child) {
      return self(self, child);
    });
  };
  auto* widget = GetWidget();
  auto* root = widget->GetRootView();
  auto* list = GetViewByID(0x534253);
  gfx::Point blank = list->GetLocalBounds().bottom_center();
  blank.Offset(0, -8);
  blank = views::View::ConvertPointToTarget(list, root, blank);
  const gfx::Point blank_in_rows =
      views::View::ConvertPointToTarget(root, space_body_, blank);
  expect("swipe fixture hits the blank list viewport below the temporary rows",
         list->height() > 8 && blank_in_rows.y() >= space_body_->height() &&
             !space_body_->Contains(root->GetEventHandlerForPoint(blank)));
  gfx::Point origin = blank;
  const auto gesture_start = base::TimeTicks::Now();
  auto send_scroll = [&](float x, float y, ui::EventMomentumPhase phase, int ms) {
    ui::ScrollEvent event(ui::EventType::kScroll, gfx::PointF(origin), gfx::PointF(origin),
                          gesture_start + base::Milliseconds(ms), ui::EF_NONE,
                          x, y, x, y, 2, phase);
    widget->OnScrollEvent(&event);
  };
  // Chromium dispatches these through the actual window and view targeter.
  send_scroll(0, 0, ui::EventMomentumPhase::MAY_BEGIN, -60);
  send_scroll(0, 85, ui::EventMomentumPhase::NONE, -50);
  send_scroll(0, 0, ui::EventMomentumPhase::END, -45);
  expect("vertical scroll over blank sidebar does not preview or switch a Space",
         active_space_id_ == a && !swipe_preview_active_);
  const auto sidebar_in_root = views::View::ConvertRectToTarget(
      this, root, GetLocalBounds());
  origin.SetPoint(sidebar_in_root.CenterPoint().x() < root->width() / 2
                      ? sidebar_in_root.right() + 16
                      : sidebar_in_root.x() - 16,
                  blank.y());
  send_scroll(0, 0, ui::EventMomentumPhase::MAY_BEGIN, -40);
  send_scroll(-85, 0, ui::EventMomentumPhase::NONE, -30);
  origin = blank;
  send_scroll(-85, 0, ui::EventMomentumPhase::NONE, -25);
  send_scroll(0, 0, ui::EventMomentumPhase::END, -20);
  expect("a swipe beginning over the page stays with the page across the sidebar",
         active_space_id_ == a && !swipe_preview_active_);
  send_scroll(0, 0, ui::EventMomentumPhase::MAY_BEGIN, 0);
  send_scroll(-21, 0, ui::EventMomentumPhase::NONE, 10);
  const auto* dragged = space_body_->layer();
  expect("short macOS swipe tracks the fingers before switching",
         active_space_id_ == a &&
             dragged->transform().To2dTranslation().x() == (animate ? -21.f : 0.f) &&
             (animate ? dragged->opacity() < 1.f : dragged->opacity() == 1.f));
  expect("dragging left shows the next Space's real rows beside the current Space",
         !animate ? !swipe_preview_ :
         swipe_preview_ && swipe_preview_space_id_ == b &&
             swipe_preview_->IsDrawn() && swipe_preview_->layer()->parent() &&
             swipe_preview_->layer()->transform().To2dTranslation().x() ==
                 space_body_->width() - 21.f &&
             preview_has_pin(preview_has_pin, swipe_preview_) &&
             row_items_.size() == rows_before_swipe &&
             !swipe_preview_->GetCanProcessEventsWithinSubtree());
  send_scroll(42, 0, ui::EventMomentumPhase::NONE, 15);
  expect("reversing direction previews the previous Space on the other side",
         !animate ? !swipe_preview_ :
         swipe_preview_ && swipe_preview_space_id_ == AdjacentSpaceId(-1) &&
             swipe_preview_->layer()->transform().To2dTranslation().x() ==
                 21.f - space_body_->width() && active_space_id_ == a);
  send_scroll(0, 0, ui::EventMomentumPhase::END, 20);
  expect("lifting after a short swipe returns the same Space",
         active_space_id_ == a && dragged->GetTargetTransform().IsIdentity() &&
             dragged->GetTargetOpacity() == 1.f &&
             (!animate || (swipe_preview_ &&
                 swipe_preview_->layer()->GetTargetTransform().To2dTranslation().x() ==
                     -space_body_->width())));
  FinishSpaceTransition();
  send_scroll(0, 0, ui::EventMomentumPhase::MAY_BEGIN, 30);
  send_scroll(-45, 0, ui::EventMomentumPhase::NONE, 40);
  send_scroll(-40, 0, ui::EventMomentumPhase::NONE, 70);
  const float entrance = swipe_preview_
      ? swipe_preview_->layer()->transform().To2dTranslation().x() : 0.f;
  expect("crossing the distance threshold still waits for lift", active_space_id_ == a);
  send_scroll(0, 0, ui::EventMomentumPhase::END, 75);
  Refresh();
  expect("lift switches and sends the outgoing Space onward as the next slides in",
         active_space_id_ == b &&
             (!animate || (outgoing_space_layer_ &&
                 outgoing_space_layer_->transform().To2dTranslation().x() < 0.f &&
                 outgoing_space_layer_->GetTargetOpacity() == 0.f &&
                 space_body_->layer()->transform().To2dTranslation().x() == entrance &&
                 space_body_->layer()->GetTargetOpacity() == 1.f)));
  send_scroll(-150, 0, ui::EventMomentumPhase::INERTIAL_UPDATE, 100);
  send_scroll(0, 0, ui::EventMomentumPhase::END, 130);
  expect("trackpad momentum cannot switch again", active_space_id_ == b);
  FinishSpaceTransition();
  send_scroll(0, 0, ui::EventMomentumPhase::MAY_BEGIN, 160);
  send_scroll(85, 0, ui::EventMomentumPhase::NONE, 170);
  expect("right swipe over blank sidebar waits for lift", active_space_id_ == b);
  send_scroll(0, 0, ui::EventMomentumPhase::END, 185);
  Refresh();
  expect("right swipe over blank sidebar returns to the previous Space",
         active_space_id_ == a);
  FinishSpaceTransition();
  ws.RemoveItem(preview_pin);
  ActivateSpace(a);
  FinishSpaceTransition();
  Render();
#endif
  // Chromium nests this view in a content container whose layout may be
  // skipped when hidden. Measure the outer region that reserves window space.
  auto* browser_view = BrowserView::GetBrowserViewForBrowser(browser_);
  auto* sidebar_region = browser_view->vertical_tab_strip_region_view_for_testing();
  // Compositor completion can be delayed in an inactive macOS window. Wait
  // for the actual state and layout to settle.
  auto settle = [&](bool collapsed) {
    const auto deadline = base::TimeTicks::Now() + base::Seconds(5);
    do {
      base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE, loop.QuitClosure(), base::Milliseconds(50));
      loop.Run(); GetWidget()->LayoutRootViewIfNecessary();
      if (collapsed ? (state_controller->IsCollapsed() && sidebar_region->width() == 0 && !GetVisible())
                    : (!state_controller->IsCollapsed() && sidebar_region->width() >= 126 && GetVisible())) return;
    } while (base::TimeTicks::Now() < deadline);
  };
  auto* fixed_toggle = GetWidget()->GetRootView()->GetViewByID(0x534254);
  const auto toggle_bounds = fixed_toggle ? fixed_toggle->GetBoundsInScreen() : gfx::Rect();
  auto* toolbar = browser_view->toolbar();
  expect("sidebar control shares the toolbar vertical center", fixed_toggle && toolbar &&
      toggle_bounds.CenterPoint().y() == toolbar->GetBoundsInScreen().CenterPoint().y());
  ToggleSidebar(); settle(true); GetWidget()->LayoutRootViewIfNecessary();
  expect("collapsed sidebar reserves zero width and hides all rows", state_controller->IsCollapsed() &&
      sidebar_region->GetPreferredSize().width() == 0 && sidebar_region->width() == 0 && !GetVisible());
  auto* restore_button = GetWidget()->GetRootView()->GetViewByID(0x534254);
  expect("frame keeps one visible sidebar control", restore_button && restore_button->GetVisible() && restore_button->width() > 0);
  ToggleSidebar(); settle(false); GetWidget()->LayoutRootViewIfNecessary();
  expect("sidebar can expand after being fully hidden", !state_controller->IsCollapsed() &&
      sidebar_region->width() >= 126 && GetVisible());
  expect("sidebar control keeps its identity and exact position across states", fixed_toggle &&
      fixed_toggle == restore_button && fixed_toggle->GetVisible() &&
      fixed_toggle->GetBoundsInScreen() == toggle_bounds);
  expect("collapse and expansion preserve live page identity", tab_a.Get() && tab_a.Get()->GetContents() == contents_before);

  // Actual committed navigations and Chromium session IDs, not URL-only
  // stand-ins. A close in another Space must never be consumed by batch undo.
  const auto clear_space = NewId(), foreign_space = NewId(), retained = NewId();
  ws.AddSpace({clear_space, "Clear batch", "current-profile"});
  ws.AddSpace({foreign_space, "Other clear", "current-profile"});
  ws.AddItem({retained, clear_space, {}, "Keep saved", "https://example.com/", SavedKind::kPage});
  auto navigate = [&](tabs::TabHandle tab, const GURL& url) {
    tab.Get()->GetContents()->GetController().LoadURL(url, content::Referrer(), ui::PAGE_TRANSITION_TYPED, std::string());
    const auto end = base::TimeTicks::Now() + base::Seconds(5);
    while (base::TimeTicks::Now() < end) {
      base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(FROM_HERE, loop.QuitClosure(), base::Milliseconds(20));
      loop.Run();
      if (tab.Get()->GetContents()->GetLastCommittedURL() == url) { SyncTabs(); return true; }
    }
    return false;
  };
  ActivateSpace(clear_space);
  std::vector<GURL> clear_urls;
  bool committed = true;
  for (int i = 0; i < 3; ++i) {
    NewTab(); const auto tab = model_->GetActiveTab()->GetHandle();
    if (i == 0) committed &= navigate(tab, GURL("data:text/html,Clear%20previous"));
    clear_urls.emplace_back("data:text/html,Clear%20" + base::NumberToString(i));
    committed &= navigate(tab, clear_urls.back());
  }
  ActivateSpace(foreign_space); NewTab(); const auto foreign = model_->GetActiveTab()->GetHandle();
  committed &= navigate(foreign, GURL("data:text/html,Foreign%20close"));
  ActivateSpace(clear_space);
  expect("clear fixture has actual committed navigation history", committed && TemporaryCount() == 3);
  ClearTemporary(); SyncTabs();
  expect("clear is scoped and keeps saved entries and other Spaces", TemporaryCount() == 0 &&
      ws.FindItem(retained) && foreign.Get() && RestorableClear(clear_space).size() == 3 && !ClearPending(clear_space));
  FinishSpaceTransition(); Render(); GetWidget()->LayoutRootViewIfNecessary();
  auto display_list = base::MakeRefCounted<cc::DisplayItemList>();
  ui::PaintContext paint(display_list.get(), 1.f, gfx::Rect(space_body_->size()), true);
  space_body_->Paint(views::PaintInfo::CreateRootPaintInfo(paint, space_body_->size()));
  display_list->Finalize();
  expect("clear feedback paints on the transparent animated Space layer", display_list->TotalOpCount() > 0);
  ActivateSpace(foreign_space); CloseTab(foreign); ActivateSpace(clear_space);
  RestoreClearedTemporary(); SyncTabs();
  bool matching = TemporaryCount() == 3, previous_navigation = false;
  std::vector<GURL> restored_order;
  for (auto handle : VisibleTabs(false)) {
    const auto& value = bindings_.at(handle.raw_value());
    if (value.placeholder || !value.item_id.empty()) continue;
    auto& controller = handle.Get()->GetContents()->GetController();
    auto* entry = controller.GetLastCommittedEntry();
    matching &= entry && std::ranges::find(clear_urls, entry->GetURL()) != clear_urls.end();
    if (entry) restored_order.push_back(entry->GetURL());
    previous_navigation |= controller.GetEntryCount() >= 2;
  }
  expect("batch restore consumes exact entries in the original Space", matching && RestorableClear(clear_space).empty());
  expect("batch restore retains back-forward navigation state", previous_navigation);
  expect("batch restore preserves the original relative page order", restored_order == clear_urls);
  ClearTemporary(); SyncTabs();
  const auto available = RestorableClear(clear_space);
  auto* restore_service = TabRestoreServiceFactory::GetForProfile(browser_->GetProfile());
  if (restore_service && !available.empty()) restore_service->RemoveEntryById(available.front());
  expect("changed Chromium history reduces recoverable batch instead of restoring unrelated tabs", RestorableClear(clear_space).size() == 2);
  RestoreClearedTemporary(); SyncTabs();
  expect("partial batch recovery restores only entries still available", TemporaryCount() == 2);

  // Committed synthetic pages exercise the actual WebContents notifications,
  // native ColorProvider, toolbar paint and omnibox focus/blur paths together.
  const auto immersive_space = NewId();
  ws.AddSpace({immersive_space, "Chrome canvas", "current-profile"});
  ActivateSpace(immersive_space); NewTab();
  const auto dark_page = model_->GetActiveTab()->GetHandle();
  auto page_url = [](std::string html) {
    return GURL("data:text/html," + base::EscapeQueryParamValue(html, false));
  };
  auto wait_for = [](auto predicate, base::TimeDelta timeout = base::Seconds(5)) {
    const auto end = base::TimeTicks::Now() + timeout;
    do {
      base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE, loop.QuitClosure(), base::Milliseconds(25));
      loop.Run();
      if (predicate()) return true;
    } while (base::TimeTicks::Now() < end);
    return false;
  };
  const auto native_scheme = GetNativeTheme()->preferred_color_scheme();
  auto* location_bar = browser_view->toolbar()->location_bar_view();
  const auto dark_url = page_url(
      "<meta name='theme-color' content='#000000'><body style='background:#0d1117'>Dark canvas");
  navigate(dark_page, dark_url);
  // A cold renderer may commit after navigate's short fixture wait. Keep the
  // URL and paint assertions together until both observers have caught up.
  const bool dark_ready = wait_for([&] {
    return dark_page.Get()->GetContents()->GetLastCommittedURL() == dark_url &&
           page_chrome_color_ == SK_ColorBLACK;
  }, base::Seconds(15));
  expect("active page explicit theme color wins over CSS background", dark_ready);
  expect("native toolbar background matches the page canvas", dark_ready &&
      ThemedBackground::GetBackgroundColor(browser_view->toolbar(), browser_view) == SK_ColorBLACK);
  auto edge_color = [&](int id = 0x534243) -> std::optional<SkColor> {
    auto* edge = browser_view->GetViewByID(id);
    if (!edge || !edge->GetBackground()) return std::nullopt;
    gfx::Canvas canvas(gfx::Size(1, 1), 1.f, true);
    edge->GetBackground()->Paint(&canvas, edge);
    return canvas.GetBitmap().getColor(0, 0);
  };
  expect("normal and fullscreen toolbar edges paint the same page color",
      edge_color() == SK_ColorBLACK && edge_color(0x534244) == SK_ColorBLACK);
  dark_page.Get()->GetContents()->Focus();
  expect("idle native address bar blends into the page", wait_for([&] {
    return location_bar->GetBackgroundColorForTesting() == SK_ColorBLACK;
  }));
  ToggleSidebar(); settle(true);
  expect("hidden sidebar control remains readable on a dark page", wait_for([&] {
    auto* toggle = static_cast<views::LabelButton*>(fixed_toggle);
    if (!toggle) return false;
    const auto& image = toggle->GetImageModel(views::Button::STATE_NORMAL);
    return image && image->IsVectorIcon() && image->GetVectorIcon().color().ResolveToSkColor(
        toggle->GetColorProvider()) == SK_ColorWHITE;
  }));
  ToggleSidebar(); settle(false);
  chrome::FocusLocationBar(browser_);
  expect("focused address bar restores original Chromium editing surface", wait_for([&] {
    return location_bar->GetBackgroundColorForTesting() ==
        location_bar->GetColorProvider()->GetColor(kColorOmniboxResultsBackground);
  }));
  dark_page.Get()->GetContents()->Focus();
  expect("leaving address input restores quiet page canvas", wait_for([&] {
    return location_bar->GetBackgroundColorForTesting() == SK_ColorBLACK;
  }));
  NewTab(); const auto light_page = model_->GetActiveTab()->GetHandle();
  model_->ActivateTab(dark_page.Get());
  navigate(light_page, page_url("<body style='background:#faf8f3'>Light canvas"));
  expect("background navigation cannot recolor the active page toolbar", page_chrome_color_ == SK_ColorBLACK);
  model_->ActivateTab(light_page.Get());
  expect("tab switch uses CSS background when no theme color exists", wait_for([&] {
    return page_chrome_color_ == SkColorSetRGB(250,248,243) &&
        !GetWidget()->color_mode_override() &&
        color_utils::IsDark(browser_view->toolbar()->GetColorProvider()->GetColor(kColorToolbarButtonIcon));
  }));
  model_->ActivateTab(dark_page.Get());
  expect("returning to dark page restores its background and readable controls", wait_for([&] {
    return page_chrome_color_ == SK_ColorBLACK &&
        !GetWidget()->color_mode_override() &&
        !color_utils::IsDark(browser_view->toolbar()->GetColorProvider()->GetColor(kColorToolbarButtonIcon));
  }));
  navigate(dark_page, page_url("<meta name='theme-color' content='#111827'><body style='background:#111827'>"
      "Dynamic canvas<script>setTimeout(()=>document.querySelector('meta').content='#173b36',350)</script>"));
  expect("same page dynamic theme update reaches native toolbar", wait_for([&] {
    return page_chrome_color_ == SkColorSetRGB(23,59,54) &&
        location_bar->GetBackgroundColorForTesting() == *page_chrome_color_;
  }));
  const SkColor website_focus =
      GetColorProvider()->GetColor(ui::kColorSysStateFocusRing);
  expect("toolbar edge follows same-palette dynamic page colors",
      edge_color() == SkColorSetRGB(23,59,54) &&
      edge_color(0x534244) == SkColorSetRGB(23,59,54));
  expect("page chrome does not change the renderer native color scheme", GetNativeTheme()->preferred_color_scheme() == native_scheme);
  const GURL fixture_root(base::CommandLine::ForCurrentProcess()->GetSwitchValueASCII(
      "sidebar-cookie-smoke-url"));
  if (fixture_root.is_valid()) {
    navigate(dark_page, fixture_root.Resolve("solid-header"));
    expect("dark full-width header supplies the toolbar color above a white article",
           wait_for([&] {
             // Display-space readback quantizes to 8 bits before conversion
             // to sRGB. Allow rounding, but check the native paint exactly.
             return page_chrome_color_ &&
                    SimilarColors(*page_chrome_color_, SkColorSetRGB(28, 25, 22), 4) &&
                    edge_color() == page_chrome_color_ &&
                    !color_utils::IsDark(browser_view->toolbar()->GetColorProvider()
                                             ->GetColor(kColorToolbarButtonIcon));
           }));
    navigate(dark_page, fixture_root.Resolve("mixed-header"));
    expect("mixed top edge falls back to the declared theme after navigation",
           wait_for([&] {
             return page_chrome_color_ == SkColorSetRGB(237, 232, 221);
           }));
  }
  navigate(dark_page, GURL("chrome://tai/home.html"));
  expect("TAi home canvas continues into the native toolbar", wait_for([&] {
    return page_chrome_color_ && page_chrome_color_ == dark_page.Get()->GetContents()->GetBackgroundColor();
  }));
  const SkColor home_focus =
      GetColorProvider()->GetColor(ui::kColorSysStateFocusRing);
  color_utils::HSL home_focus_hsl;
  color_utils::SkColorToHSL(home_focus, &home_focus_hsl);
  expect("the address bar focus uses a contrasting Atrium purple and follows page hues",
      home_focus != website_focus && home_focus_hsl.h > 0.69 &&
      home_focus_hsl.h < 0.76 &&
      GetColorProvider()->GetColor(ui::kColorFocusableBorderFocused) == home_focus &&
      page_chrome_color_ && color_utils::GetContrastRatio(home_focus, *page_chrome_color_) >= 3.f);
  chrome::FocusLocationBar(browser_);
  expect("empty focused home address bar stays on the home canvas", wait_for([&] {
    return location_bar->GetOmniboxView()->GetText().empty() &&
        page_chrome_color_ == location_bar->GetBackgroundColorForTesting();
  }));
  location_bar->GetOmniboxView()->SetUserText(u"TAi input check", false);
  expect("typing on home restores the native editing background", wait_for([&] {
    return location_bar->GetBackgroundColorForTesting() ==
        location_bar->GetColorProvider()->GetColor(kColorOmniboxResultsBackground);
  }));
  location_bar->GetOmniboxView()->RevertAll();
  navigate(dark_page, GURL("chrome://settings/"));
  expect("native settings canvas continues into the toolbar and idle address bar", wait_for([&] {
    return page_chrome_color_ && dark_page.Get()->GetContents()->GetBackgroundColor() == page_chrome_color_ &&
        location_bar->GetBackgroundColorForTesting() == *page_chrome_color_;
  }));
  auto* avatar = toolbar->GetViewByID(VIEW_ID_AVATAR_BUTTON);
  expect("regular product windows have no visible browser account button", !avatar || !avatar->IsDrawn());
  expect("retired browser account commands cannot open their UI", !chrome::IsCommandEnabled(browser_, IDC_SHOW_AVATAR_MENU) &&
      !chrome::IsCommandEnabled(browser_, IDC_SHOW_SIGNIN) && !chrome::IsCommandEnabled(browser_, IDC_ADD_NEW_PROFILE));
  expect("legacy bookmark commands are disabled in TAi",
      !chrome::IsCommandEnabled(browser_, IDC_BOOKMARK_THIS_TAB) &&
      !chrome::IsCommandEnabled(browser_, IDC_BOOKMARK_ALL_TABS) &&
      !chrome::IsCommandEnabled(browser_, IDC_SHOW_BOOKMARK_MANAGER) &&
      !chrome::IsCommandEnabled(browser_, IDC_SHOW_BOOKMARK_BAR) &&
      !chrome::IsCommandEnabled(browser_, IDC_SHOW_BOOKMARK_SIDE_PANEL));
  navigate(dark_page, GURL("chrome://version/"));
  expect("Chromium management pages restore the original window theme", wait_for([&] {
    return !page_chrome_color_ && !GetWidget()->color_mode_override();
  }));

  gfx::Canvas toolbar_canvas(gfx::Size(1, 1), 1.f, false);
  ThemedBackground::PaintBackground(&toolbar_canvas, toolbar, browser_view,
                                    ThemedBackground::kToolbarTheme);
  expect("toolbar without a page color paints the native toolbar surface",
      toolbar_canvas.GetBitmap().getColor(0, 0) ==
          toolbar->GetColorProvider()->GetColor(kColorToolbar));

  RunCookieReloadSmokeChecks(browser_, dark_page.Get()->GetContents(), checks);
  // Exercise the real sidebar ScrollView with temporary overflowing content.
  // This adds no saved item/tab and never writes synthetic entries to the model.
  base::RunLoop().RunUntilIdle();
  FinishSpaceTransition();
  auto* sidebar_scroll = static_cast<views::ScrollView*>(GetViewByID(0x534253));
  const int window_minimum_height = GetWidget()->GetMinimumSize().height();
  views::ViewTracker overflow;
  auto ensure_overflow = [&] {
    if (overflow.view()) return;
    auto content = std::make_unique<views::View>();
    content->SetPreferredSize(gfx::Size(1, 4000));
    overflow.SetView(body_->AddChildView(std::move(content)));
    GetWidget()->LayoutRootViewIfNecessary();
  };
  ensure_overflow();
  const auto favorites_before_scroll = favorites_body_->parent()->GetBoundsInScreen();
  const auto title_before_scroll = title_clip_->GetBoundsInScreen();
  auto* scrollbar =
      views::AsViewClass<SidebarScrollBar>(sidebar_scroll->vertical_scroll_bar());
  expect("long scrolling content does not increase the native window minimum height",
      GetWidget()->GetMinimumSize().height() == window_minimum_height &&
      sidebar_scroll->height() > 0);
  expect("sidebar overflow uses a transparent overlay without a reserved gutter",
      scrollbar->GetVisible() && scrollbar->OverlapsContent() &&
      !scrollbar->GetBackground() && scrollbar->layer() &&
      !scrollbar->layer()->fills_bounds_opaquely() &&
      sidebar_scroll->GetVisibleRect().width() == sidebar_scroll->width());
  // A queued sidebar render can replace the contents while the compositor
  // catches up. Reattach the fixture if the render removed it.
  expect("sidebar overlay scroll reaches the end of overflowing contents", wait_for([&] {
    ensure_overflow();
    scrollbar->ScrollByAmount(views::ScrollBar::ScrollAmount::kEnd);
    const auto visible = sidebar_scroll->GetVisibleRect();
    return visible.y() > 0 && visible.bottom() == body_->height();
  }));
  expect("favorites and the Space title stay above the list scrollbar",
      !sidebar_scroll->Contains(favorites_body_) &&
      !sidebar_scroll->Contains(title_clip_) &&
      favorites_body_->parent()->GetBoundsInScreen() == favorites_before_scroll &&
      title_clip_->GetBoundsInScreen() == title_before_scroll &&
      title_before_scroll.bottom() <= sidebar_scroll->GetBoundsInScreen().y());
  const bool passive_scroll_kept_hidden = !scrollbar->IsThumbRevealed();
  if (auto* content = overflow.view()) body_->RemoveChildViewT(content);
  sidebar_scroll->ScrollToOffset(gfx::PointF());
  const auto reveal_folder = NewId();
  const auto reveal_child = NewId();
  ws.AddItem({reveal_folder, active_space_id_, {}, "Reveal folder", {}, SavedKind::kFolder});
  ws.AddItem({reveal_child, active_space_id_, reveal_folder, "Reveal child",
              "https://example.invalid/reveal", SavedKind::kPage});
  {
    base::AutoReset<std::string> menu_item(&menu_item_, reveal_folder);
    menu_model_ = std::make_unique<ui::SimpleMenuModel>(this);
    BuildFolderMenu(*ws.FindItem(reveal_folder));
    expect("folder menu contains folder actions and an independent Move to Space submenu",
        menu_model_->GetIndexOfCommandId(kRename).has_value() &&
        menu_model_->GetIndexOfCommandId(kToggleFolder).has_value() &&
        menu_model_->GetIndexOfCommandId(kMoveFolderToSpace).has_value() &&
        !menu_model_->GetIndexOfCommandId(kCloseFolderTabs) &&
        !menu_model_->GetIndexOfCommandId(kClose) &&
        !menu_model_->GetIndexOfCommandId(kAppearance) &&
        !menu_model_->GetIndexOfCommandId(kSwitchSpaceBase));
    menu_model_.reset();
    folder_move_menu_.reset();
    folder_menu_destinations_.clear();
  }
  // Let queued tab and theme notifications from the preceding navigation run.
  wait_for([&] { return !refresh_pending_; });
  Render();
  ensure_overflow();
  views::ViewTracker new_tab_tracker;
  new_tab_tracker.SetView(new_tab_button_);
  auto* new_tab = views::AsViewClass<NewTabButton>(new_tab_tracker.view());
  new_tab->SetState(views::Button::STATE_NORMAL);
  const bool new_tab_is_quiet = !new_tab->GetBackground() &&
      SkColorGetA(new_tab->label()->GetEnabledColor()) == 160;
  new_tab->SetState(views::Button::STATE_HOVERED);
  expect("New Tab uses a quiet default and highlights on hover",
      new_tab_is_quiet && new_tab->GetBackground() &&
      SkColorGetA(new_tab->label()->GetEnabledColor()) == 255);
  new_tab->SetState(views::Button::STATE_NORMAL);
  const auto folder_rows_visible = [&] {
    return std::ranges::any_of(row_items_, [&](const auto& entry) {
      return entry.second == reveal_child && entry.first->IsDrawn();
    });
  };
  const bool folder_can_animate = CanAnimateSpace();
  OpenItem(reveal_folder);
  const bool kept_rows_on_close = new_tab_tracker.view() == new_tab_button_ &&
                                  !refresh_pending_;
  expect("closing a folder animates its children out when motion is enabled",
      ws.FindItem(reveal_folder)->collapsed &&
      (folder_can_animate ? folder_reveal_ && folder_reveal_->is_animating()
                          : !folder_reveal_));
  expect("closed folder hides child rows after the animation", wait_for([&] {
    return !folder_reveal_ && !folder_rows_visible() && !refresh_pending_;
  }));
  new_tab_tracker.SetView(new_tab_button_);
  OpenItem(reveal_folder);
  const bool kept_rows_on_open = new_tab_tracker.view() == new_tab_button_ &&
                                 !refresh_pending_;
  expect("opening a folder animates its children in when motion is enabled",
      !ws.FindItem(reveal_folder)->collapsed &&
      (folder_can_animate ? folder_reveal_ && folder_reveal_->is_animating()
                          : !folder_reveal_));
  expect("expanded folder shows its child rows after the animation", wait_for([&] {
    return !folder_reveal_ && folder_rows_visible();
  }));
  expect("folder toggles keep the surrounding rows and do not queue a redraw",
      kept_rows_on_close && kept_rows_on_open);
  ensure_overflow();
  const auto send_sidebar_scroll = [&](float x, float y) {
    ui::ScrollEvent event(ui::EventType::kScroll, gfx::PointF(), gfx::PointF(),
                          base::TimeTicks::Now(), ui::EF_NONE, x, y, x, y, 2,
                          ui::EventMomentumPhase::NONE);
    scrollbar->ObserveScrollEvent(event);
  };
  send_sidebar_scroll(30, 3);
  const bool layout_and_swipe_kept_hidden = !scrollbar->IsThumbRevealed();
  send_sidebar_scroll(3, 30);
  expect("only vertical sidebar input reveals the overlay scrollbar",
      passive_scroll_kept_hidden && layout_and_swipe_kept_hidden &&
      scrollbar->IsThumbRevealed() && wait_for([&] {
        return !scrollbar->IsThumbRevealed();
      }));
  if (auto* content = overflow.view()) body_->RemoveChildViewT(content);
  ws.RemoveItem(reveal_folder);
  workspace_->Commit();
  // Exercise the same native dispatcher used by Cocoa and BrowserView.
  const auto old_overrides = workspace_->shortcut_overrides().Clone();
  base::DictValue overrides, binding;
  binding.Set("binding", "Command+Shift+E"); binding.Set("priority", "browser");
  overrides.Set("toggle_sidebar", std::move(binding));
  workspace_->SetShortcutOverrides(overrides.Clone());
  // The preceding checks may leave collapse state changed. Establish the
  // routing precondition explicitly instead of merely waiting for expansion.
  if (state_controller->IsCollapsed()) ToggleSidebar();
  settle(false);
  expect("sidebar is expanded before remapped shortcut dispatch", !state_controller->IsCollapsed());
  expect("remapping retires the old native sidebar key before responder dispatch",
      RouteShortcut(browser_, *ParseShortcut("Command+S"), ShortcutPhase::kBeforeResponder) == ShortcutResult::kDeferred);
  RouteShortcut(browser_, *ParseShortcut("Command+S"), ShortcutPhase::kAfterResponder);
  expect("retired sidebar key cannot fall through into Save Page or collapse", !state_controller->IsCollapsed());
  RouteShortcut(browser_, *ParseShortcut("Command+Shift+E"), ShortcutPhase::kBeforeResponder);
  settle(true);
  expect("custom native shortcut collapses the real sidebar",
         state_controller->IsCollapsed() && sidebar_region->width() == 0 && !GetVisible());
  overrides.FindDict("toggle_sidebar")->Set("priority", "website");
  workspace_->SetShortcutOverrides(overrides.Clone());
  expect("website-first shortcut defers without acting on browser state",
      RouteShortcut(browser_, *ParseShortcut("Command+Shift+E"), ShortcutPhase::kBeforeResponder) == ShortcutResult::kDeferred && state_controller->IsCollapsed());
  RouteShortcut(browser_, *ParseShortcut("Command+Shift+E"), ShortcutPhase::kAfterResponder);
  settle(false);
  expect("unhandled website-first shortcut executes in fallback", !state_controller->IsCollapsed());
  const auto mru_space = NewId(); ws.AddSpace({mru_space, "MRU checks", "current-profile"}); ActivateSpace(mru_space);
  NewTab(); const auto recent_a = model_->GetActiveTab()->GetHandle();
  NewTab(); const auto recent_b = model_->GetActiveTab()->GetHandle();
  NewTab(); const auto recent_c = model_->GetActiveTab()->GetHandle();
  model_->ActivateTab(recent_a.Get()); model_->ActivateTab(recent_c.Get());
  EndRecentTabCycle(); CycleRecentTab(1);
  expect("Control Tab starts from the last visited tab rather than sidebar order", model_->GetActiveTab() == recent_a.Get());
  CycleRecentTab(1);
  expect("holding Control traverses a stable MRU order", model_->GetActiveTab() == recent_b.Get());
  CycleRecentTab(-1);
  expect("reverse Control Tab traverses the frozen MRU order", model_->GetActiveTab() == recent_a.Get());
    ui::KeyEvent release_control(ui::EventType::kKeyReleased, ui::VKEY_CONTROL, ui::EF_NONE);
  recent_keys_.OnKeyEvent(&release_control); CycleRecentTab(1);
  expect("releasing Control starts a new MRU cycle", model_->GetActiveTab() == recent_b.Get());
  EndRecentTabCycle();
  const auto numbered_favorite = NewId();
  ws.AddItem({numbered_favorite, {}, {}, "Numbered favorite", "https://example.invalid/favorite", SavedKind::kFavorite});
  SetBinding(recent_a.Get(), {{}, numbered_favorite, false});
  SelectNumberedTab(0);
  expect("numbered sidebar shortcuts exclude the shared Favorites dock", model_->GetActiveTab() == recent_b.Get());
  const auto numbered_page = NewId();
  ws.AddItem({numbered_page, mru_space, {}, "Closed pinned page", "https://example.invalid/numbered", SavedKind::kPage});
  SelectNumberedTab(0);
  expect("numbered shortcuts can open a closed pinned sidebar page", LiveItem(numbered_page) && model_->GetActiveTab() == LiveItem(numbered_page)->Get());
  workspace_->SetShortcutOverrides(old_overrides.Clone());
  workspace_->Commit(); Render();
  FinishSmokeTest(std::move(checks));
}
void SpaceNavigationView::FinishSmokeTest(base::ListValue checks) {
  bool passed = true; for (const auto& value : checks) passed &= value.GetDict().FindBool("passed").value_or(false);
  base::DictValue result; result.Set("passed", passed); result.Set("checks", std::move(checks));
  result.Set("scope", "independent Spaces, saved/temporary membership, nested folders and gesture routing, native drag mutations, nonce rejection and per-Space colors; physical drag and visual QA separate");
  auto json = base::WriteJson(result); if (!json) return;
  const auto output = browser_->GetProfile()->GetPath().AppendASCII("SidebarSmoke.json");
  base::ThreadPool::PostTaskAndReplyWithResult(FROM_HERE, {base::MayBlock()},
      base::BindOnce([](base::FilePath path, std::string data) { return base::WriteFile(path, data); }, output, std::move(*json)),
      base::BindOnce([](base::WeakPtr<SpaceNavigationView> self, bool written) {
        if (self && self->browser_ && written) chrome::Exit();
      }, weak_factory_.GetWeakPtr()));
}
BEGIN_METADATA(SpaceNavigationView)
END_METADATA
}  // namespace sidebar
