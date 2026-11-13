// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_SPACE_NAVIGATION_VIEW_H_
#define SIDEBAR_BROWSER_SPACE_NAVIGATION_VIEW_H_
#include <deque>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include "base/callback_list.h"
#include "base/scoped_observation.h"
#include "base/timer/timer.h"
#include "ui/views/drag_controller.h"
#include "ui/events/event_observer.h"
#include "ui/views/widget/widget_observer.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/task/cancelable_task_tracker.h"
#include "ui/base/models/image_model.h"
#include "ui/gfx/image/image.h"
#include "base/values.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "components/tabs/public/tab_interface.h"
#include "components/sessions/core/session_id.h"
#include "sidebar_browser/sidebar_session.h"
#include "ui/base/unowned_user_data/scoped_unowned_user_data.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/context_menu_controller.h"
#include "ui/views/controls/textfield/textfield_controller.h"
#include "ui/views/layout/box_layout_view.h"
class GURL;
class BrowserWindowInterface;
class BrowserView;
namespace gfx { class Canvas; }
namespace ui { struct ColorProviderKey; class Layer; }
namespace tabs { class VerticalTabStripStateController; }
namespace views { class EventMonitor; class BubbleDialogDelegate; class Background; class LabelButton; class Textfield; class MenuRunner; }
namespace sidebar {
std::unique_ptr<views::View> CreateSidebarToggle(BrowserWindowInterface*);
std::unique_ptr<views::Background> CreateSidebarBackground(views::View&, BrowserView&);
std::unique_ptr<views::Background> CreateToolbarBackground(views::View&, BrowserView&);
bool PaintProductBackdrop(gfx::Canvas*, const views::View*, const BrowserView*);
std::optional<SkColor> PageChromeColor(const BrowserView*);
bool IsProductHome(BrowserView*);
bool PaintPageChrome(gfx::Canvas*, const views::View*, const BrowserView*);
void ApplyPageChromePalette(const BrowserView*, ui::ColorProviderKey&);
std::unique_ptr<views::Background> CreatePageChromeEdgeBackground(BrowserView&, bool layer_based = false);
GURL ProductNewTabURL(BrowserWindowInterface*);
class WorkspaceState;
class FolderRevealView;
struct SavedItem;
class SpaceNavigationView final : public views::BoxLayoutView,
                                  public TabStripModelObserver,
                                  public views::ContextMenuController,
                                  public ui::SimpleMenuModel::Delegate,
                                  public views::TextfieldController,
                                  public views::DragController,
                                  public views::WidgetObserver {
  METADATA_HEADER(SpaceNavigationView, views::BoxLayoutView)
 public:
  DECLARE_USER_DATA(SpaceNavigationView);
  static SpaceNavigationView* From(BrowserWindowInterface* browser);
  SpaceNavigationView(BrowserWindowInterface* browser,
                      tabs::VerticalTabStripStateController* state_controller);
  ~SpaceNavigationView() override;
  void OnBoundsChanged(const gfx::Rect& previous_bounds) override;
  void ToggleSidebar();
  const std::string& active_space_id() const { return active_space_id_; }
  void OnThemeChanged() override;
  SkColor SidebarColor() const;
  bool HasPrideBackdrop() const;
  bool IsDark() const;
  std::optional<SkColor> page_chrome_color() const { return page_chrome_color_; }
  int page_chrome_accent() const { return page_chrome_accent_; }
  void AddedToWidget() override;
  void RemovedFromWidget() override;
  void OnWidgetDestroying(views::Widget*) override;
  void OnWidgetActivationChanged(views::Widget*, bool active) override;
  void OnWidgetDragDropCompleted(views::Widget*) override;
  void WriteDragDataForView(views::View*, const gfx::Point&, ui::OSExchangeData*) override;
  int GetDragOperationsForView(views::View*, const gfx::Point&) override;
  bool CanStartDragForView(views::View*, const gfx::Point&, const gfx::Point&) override;
  bool GetDropFormats(int*, std::set<ui::ClipboardFormatType>*) override;
  bool AreDropTypesRequired() override;
  bool CanDrop(const ui::OSExchangeData&) override;
  void OnDragEntered(const ui::DropTargetEvent&) override;
  int OnDragUpdated(const ui::DropTargetEvent&) override;
  void OnDragExited() override;
  DropCallback GetDropCallback(const ui::DropTargetEvent&) override;
  bool SelectRelativeTab(int delta);
  bool PerformShortcut(std::string_view action);
  bool CycleRecentTab(int delta, int modifiers = ui::EF_CONTROL_DOWN);
  void ReleaseRecentTabCycle(int modifiers);
  void EndRecentTabCycle();
  bool SelectNumberedTab(int index);
  bool CloseActiveTab();
  void OnTabStripModelChanged(TabStripModel*, const TabStripModelChange&,
                             const TabStripSelectionChange&) override;
  void OnTabChangedAt(tabs::TabInterface*, TabChangeType) override;
  void OnTabStripModelDestroyed(TabStripModel*) override;
  void OnTabCloseCancelled(const tabs::TabInterface*) override;
  void ShowContextMenuForViewImpl(views::View*, const gfx::Point&,
                                  ui::mojom::MenuSourceType) override;
  bool IsCommandIdEnabled(int command_id) const override;
  void ExecuteCommand(int command_id, int event_flags) override;
  bool HandleKeyEvent(views::Textfield*, const ui::KeyEvent&) override;
 private:
  class RecentKeys final : public ui::EventHandler, public ui::EventObserver {
   public:
    using ui::EventHandler::OnEvent;
    explicit RecentKeys(SpaceNavigationView* owner) : owner_(owner) {}
    void OnKeyEvent(ui::KeyEvent*) override;
    void OnEvent(const ui::Event&) override;
    void OnMouseEvent(ui::MouseEvent*) override;
   private: raw_ptr<SpaceNavigationView> owner_;
  };
  RecentKeys recent_keys_{this};
  bool window_input_handlers_attached_ = false;
  void DetachWindowInputHandlers();
  base::OneShotTimer resize_refresh_timer_;
  class SwipeHandler final : public ui::EventHandler {
   public:
    explicit SwipeHandler(SpaceNavigationView* owner);
    ~SwipeHandler() override;
    void OnScrollEvent(ui::ScrollEvent*) override;
    void OnMouseEvent(ui::MouseEvent*) override;
    void Reset();
   private:
    enum class Phase { kIdle, kTracking, kHorizontal, kVertical, kMomentum, kOutside };
    bool IsOverSidebar(const ui::LocatedEvent&) const;
    void Complete(base::TimeTicks release);
    raw_ptr<SpaceNavigationView> owner_;
    Phase phase_ = Phase::kIdle;
    float x_ = 0.f;
    float y_ = 0.f;
    std::deque<std::pair<base::TimeTicks, float>> recent_moves_;
    base::OneShotTimer lift_timer_;
  };
  enum class Area { kFavorite, kSaved, kTemporary, kSpace };
  struct DropZone {
    raw_ptr<views::View> view = nullptr;
    Area area = Area::kSaved;
    std::string space, item;
  };
  struct DropLocation {
    Area area = Area::kSaved;
    std::string space, parent, before;
    int mark = 3;
    raw_ptr<views::View> view = nullptr;
  };
  DropLocation LocateDrop(const gfx::Point&) const;
  bool ApplyDrop(SpaceNavigationView* source, const std::string& key,
                 DropLocation destination);
  void RegisterRow(views::View*, std::string key, Area area);
  void ClearDropFeedback();
  void ShowAppearance();
  void UpdateFrameButton();
  void SchedulePageChromeRefresh();
  void RefreshPageChrome();
  bool IsSpaceTransitionRunning() const;
  bool CanAnimateSpace() const;
  void FinishSpaceTransition();
  void OnSpaceTransitionFinished(unsigned generation);
  void AnimateSpaceLayers(base::TimeDelta duration, float outgoing_offset,
                          std::optional<float> preview_offset = std::nullopt);
  void PlaySpaceTransition(std::optional<float> swipe_entrance);
  void PreviewSpaceSwipe(float offset);
  void CompleteSpaceSwipe(float offset, bool flick);
  void RemoveSwipePreview();
  std::string AdjacentSpaceId(int delta) const;
  void ScheduleRefresh();
  void Refresh();
  void SyncTabs();
  void Render();
  bool Swipe(float x, float y);
  void SwitchRelativeSpace(int delta);
  void ActivateSpace(std::string id);
  void CreateSpace();
  void OpenSettings();
  void NewTab(bool placeholder = false);
  void CloseTab(tabs::TabHandle handle);
  void ClearTemporary();
  void RestoreClearedTemporary();
  int TemporaryCount() const;
  bool ClearPending(const std::string& space) const;
  std::vector<SessionID> RestorableClear(const std::string& space) const;
  void OpenItem(std::string id);
  void SaveCurrent(std::string parent, bool favorite);
  void NewFolder(std::string parent);
  void SetBinding(tabs::TabInterface*, TabOrganization);
  std::vector<tabs::TabHandle> VisibleTabs(bool include_favorites = true) const;
  std::vector<tabs::TabHandle> VisibleTabsForSpace(const std::string& space_id,
                                                  bool include_favorites) const;
  std::optional<tabs::TabHandle> LiveItem(const std::string& id) const;
  std::unique_ptr<views::BoxLayoutView> BuildSpaceBody(
      const std::string& space_id, bool interactive, int row_budget);
  std::unique_ptr<views::BoxLayoutView> BuildSpaceHeader(
      const std::string& space_id, bool interactive);
  void RenderSaved(views::BoxLayoutView*, const std::string& space_id,
                   bool interactive, int& row_budget,
                   std::string_view parent_id = {}, int depth = 0);
  void FinishFolderReveal(unsigned generation);
  ui::ImageModel SavedIcon(const SavedItem& item,
                           int size,
                           SkColor fallback_color,
                           std::optional<tabs::TabHandle> live = std::nullopt);
  void RenderTab(views::BoxLayoutView*, tabs::TabHandle, int depth,
                 bool interactive);
  void BeginRename(std::string id, bool space);
  void CommitRename();
  void ShowSpaceMenu();
  void BuildFolderMenu(const SavedItem& folder);
  std::vector<tabs::TabHandle> FolderOpenTabs(const SavedItem& folder) const;
  void ShowSpaceChooser();
  void RunSmokeTest(tabs::VerticalTabStripStateController*, int retries = 0);
  void FinishSmokeTest(base::ListValue checks);
  raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<TabStripModel> model_;
  raw_ptr<WorkspaceState> workspace_;
  raw_ptr<tabs::VerticalTabStripStateController> state_controller_;
  raw_ptr<views::BoxLayoutView> body_ = nullptr;
  raw_ptr<views::BoxLayoutView> favorites_body_ = nullptr;
  raw_ptr<views::BoxLayoutView> title_clip_ = nullptr;
  raw_ptr<views::BoxLayoutView> space_body_ = nullptr;
  raw_ptr<views::BoxLayoutView> swipe_preview_ = nullptr;
  raw_ptr<views::View> swipe_preview_title_ = nullptr;
  std::string swipe_preview_space_id_;
  raw_ptr<views::BoxLayoutView> dock_ = nullptr;
  raw_ptr<views::Textfield> editor_ = nullptr;
  std::map<int32_t, TabOrganization> bindings_;
  class PageChromeObserver;
  std::unique_ptr<PageChromeObserver> page_chrome_observer_;
  std::optional<SkColor> page_chrome_color_;
  int page_chrome_accent_ = 0;
  bool page_chrome_refresh_pending_ = false;
  class ClearObserver;
  struct PendingClear { std::string space; int position; std::unique_ptr<ClearObserver> observer; };
  struct ClearBatch {
    int closed = 0;
    int cancelled = 0;
    std::map<int, SessionID> entries;
  };
  // Only session IDs, never a second copy of webpage state. Chromium owns
  // navigation restoration and retention; this window owns the last UI batch.
  std::map<int32_t, PendingClear> pending_clear_;
  std::map<std::string, ClearBatch> clear_batches_;
  std::map<std::string, tabs::TabHandle> last_active_;
  // Selection order is independent of WebContents visibility timestamps.
  std::vector<tabs::TabHandle> recent_visits_;
  std::vector<tabs::TabHandle> recent_cycle_;
  size_t recent_cycle_index_ = 0;
  int recent_cycle_modifier_ = 0;
  std::unique_ptr<views::EventMonitor> recent_cycle_monitor_;
  std::string recent_cycle_space_;
  std::map<views::View*, std::string> row_items_;
  std::vector<DropZone> drop_zones_;
  raw_ptr<views::View> space_header_ = nullptr;
  raw_ptr<views::View> new_tab_button_ = nullptr;
  raw_ptr<views::View> feedback_view_ = nullptr;
  int transition_direction_ = 0;
  unsigned transition_generation_ = 0;
  std::unique_ptr<ui::Layer> outgoing_space_layer_;
  std::unique_ptr<ui::Layer> outgoing_title_layer_;
  bool transition_from_swipe_ = false;
  bool swipe_preview_active_ = false;
  std::map<std::string, raw_ptr<FolderRevealView>> folder_rows_;
  bool committing_folder_change_ = false;
  bool refresh_after_folder_reveal_ = false;
  unsigned folder_reveal_generation_ = 0;
  raw_ptr<FolderRevealView> folder_reveal_ = nullptr;
  bool refresh_after_transition_ = false;
  base::OneShotTimer space_hover_timer_;
  std::string hover_space_;
  std::string active_space_id_;  // Per-window selection; metadata is Profile-wide.
  std::string edit_id_;
  bool edit_space_ = false;
  std::string menu_item_;
  bool refresh_pending_ = false;
  bool collapsed_ = false;
  bool switching_ = false;
  int gesture_direction_override_ = 0;
  float swipe_distance_ = 0;
  base::TimeTicks last_swipe_;
  base::TimeTicks last_scroll_;
  std::map<std::string, gfx::Image> favicon_cache_;
  std::set<std::string> requested_favicons_;
  base::CancelableTaskTracker favicon_tasks_;
  base::ScopedObservation<views::Widget, views::WidgetObserver> widget_observation_{this};
  SwipeHandler swipe_handler_{this};
  std::unique_ptr<views::BubbleDialogDelegate> appearance_delegate_;
  std::unique_ptr<views::Widget> appearance_widget_;
  std::unique_ptr<views::BubbleDialogDelegate> space_chooser_delegate_;
  std::unique_ptr<views::Widget> space_chooser_widget_;
  std::vector<std::string> folder_menu_destinations_;
  std::unique_ptr<ui::SimpleMenuModel> folder_move_menu_;
  std::unique_ptr<ui::SimpleMenuModel> menu_model_;
  std::unique_ptr<views::MenuRunner> menu_runner_;
  base::CallbackListSubscription paint_subscription_;
  base::CallbackListSubscription workspace_subscription_;
  base::CallbackListSubscription collapse_subscription_;
  ui::ScopedUnownedUserData<SpaceNavigationView> scoped_data_;
  base::WeakPtrFactory<SpaceNavigationView> weak_factory_{this};
};
}  // namespace sidebar
#endif
