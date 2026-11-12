// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_WORKSPACE_MODEL_H_
#define SIDEBAR_WORKSPACE_MODEL_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>



namespace sidebar {

struct WorkspaceSpace {
  std::string id;
  std::string name;
  std::string profile_key;
  uint32_t color = 0;  // ARGB; zero follows the default appearance.
  std::string icon = {};  // One emoji; native boundary validates Unicode.
};

std::string DefaultSpaceIcon(size_t index);
std::optional<uint32_t> ParseSpaceColor(std::string_view color);
std::string SpaceColorHex(uint32_t color);

enum class SavedKind { kFolder, kPage, kFavorite };

struct SavedItem {
  std::string id;
  std::string space_id;  // Empty only for profile-wide favorites.
  std::string parent_id; // Empty means the Space's saved-area root.
  std::string title;
  std::string url;       // Empty for folders; required for pages/favorites.
  SavedKind kind = SavedKind::kPage;
  bool collapsed = false;
};

struct WorkspaceSnapshot {
  std::vector<WorkspaceSpace> spaces;
  std::vector<SavedItem> items;
  std::string active_space_id;
};

// Organization metadata only. Chromium retains ownership of every live page.
class WorkspaceModel {
 public:
  bool AddSpace(WorkspaceSpace space);
  bool ActivateSpace(const std::string& id);
  bool RenameSpace(const std::string& id, std::string name);
  bool SetSpaceColor(const std::string& id, std::string_view color);
  bool SetSpaceIcon(const std::string& id, std::string icon);
  bool AddItem(SavedItem item);
  bool RelocateItem(const std::string& id, SavedKind kind,
                    const std::string& space_id, const std::string& parent_id,
                    const std::string& before_id = {});
  bool RenameItem(const std::string& id, std::string title);
  bool MoveItem(const std::string& id, const std::string& parent_id);
  bool SetCollapsed(const std::string& id, bool collapsed);
  bool RemoveItem(std::string id); // Removes folder descendants atomically.
  const WorkspaceSpace* FindSpace(const std::string& id) const;
  const SavedItem* FindItem(const std::string& id) const;
  std::vector<std::string> Children(const std::string& space_id,
                                    const std::string& parent_id) const;
  const std::vector<WorkspaceSpace>& spaces() const { return state_.spaces; }
  const std::vector<SavedItem>& items() const { return state_.items; }
  const std::string& active_space_id() const { return state_.active_space_id; }
  WorkspaceSnapshot CaptureSnapshot() const;
  bool RestoreSnapshot(const WorkspaceSnapshot& snapshot);

 private:
  WorkspaceSnapshot state_;
};

}  // namespace sidebar
#endif
