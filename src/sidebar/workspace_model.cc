// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "workspace_model.h"

#include <algorithm>
#include <set>
#include <map>
#include <utility>

namespace sidebar {
namespace {
bool Valid(const WorkspaceSnapshot& state) {
  std::set<std::string> spaces;
  for (const auto& space : state.spaces) {
    if ((space.color != 0 && (space.color >> 24) != 255) ||
        space.icon.empty() || space.icon.size() > 64 ||
        space.id.empty() || space.profile_key.empty() ||
        !spaces.insert(space.id).second) return false;
  }
  if (state.spaces.empty() ? !state.active_space_id.empty()
                           : !spaces.contains(state.active_space_id)) return false;
  std::map<std::string, const SavedItem*> items;
  for (const auto& item : state.items) {
    if (item.id.empty() || !items.emplace(item.id, &item).second) return false;
    if (item.kind == SavedKind::kFavorite) {
      if (!item.space_id.empty() || !item.parent_id.empty() || item.url.empty()) return false;
    } else if (item.kind == SavedKind::kFolder || item.kind == SavedKind::kPage) {
      if (!spaces.contains(item.space_id)) return false;
      if ((item.kind == SavedKind::kFolder) != item.url.empty()) return false;
    } else {
      return false;
    }
    if (item.collapsed && item.kind != SavedKind::kFolder) return false;
  }
  for (const auto& item : state.items) {
    std::set<std::string> visited{item.id};
    std::string parent = item.parent_id;
    while (!parent.empty()) {
      const auto found = items.find(parent);
      if (found == items.end() || !visited.insert(parent).second ||
          found->second->kind != SavedKind::kFolder ||
          found->second->space_id != item.space_id) return false;
      parent = found->second->parent_id;
    }
  }
  return true;
}
}  // namespace

std::string DefaultSpaceIcon(size_t index) {
  constexpr std::string_view icons[] = {"🌐", "🏠", "💼", "📚", "🧪", "🎨", "🛠️", "🌱", "☕", "🧭"};
  return std::string(icons[index % std::size(icons)]);
}

std::optional<uint32_t> ParseSpaceColor(std::string_view color) {
  if (color.empty()) return 0;
  if (color.size() != 7 || color[0] != '#') return std::nullopt;
  uint32_t value = 0xff;
  for (size_t i = 1; i < color.size(); ++i) {
    const char c = color[i];
    int digit = c >= '0' && c <= '9' ? c - '0' :
                c >= 'a' && c <= 'f' ? c - 'a' + 10 :
                c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    if (digit < 0) return std::nullopt;
    value = (value << 4) | static_cast<uint32_t>(digit);
  }
  return value;
}

std::string SpaceColorHex(uint32_t color) {
  if (!color) return {};
  constexpr char digits[] = "0123456789ABCDEF";
  std::string result(7, '#');
  for (int i = 0; i < 6; ++i) result[i + 1] = digits[(color >> ((5 - i) * 4)) & 15];
  return result;
}

bool WorkspaceModel::SetSpaceColor(const std::string& id, std::string_view color) {
  const auto parsed = ParseSpaceColor(color);
  if (!parsed) return false;
  for (auto& space : state_.spaces) {
    if (space.id == id) { space.color = *parsed; return true; }
  }
  return false;
}

bool WorkspaceModel::AddSpace(WorkspaceSpace space) {
  if (space.icon.empty()) space.icon = DefaultSpaceIcon(state_.spaces.size());
  if (space.id.empty() || space.profile_key.empty() || FindSpace(space.id) ||
      space.icon.size() > 64 ||
      (space.color != 0 && (space.color >> 24) != 255)) return false;
  if (state_.spaces.empty()) state_.active_space_id = space.id;
  state_.spaces.push_back(std::move(space));
  return true;
}

bool WorkspaceModel::SetSpaceIcon(const std::string& id, std::string icon) {
  if (icon.empty() || icon.size() > 64) return false;
  for (auto& space : state_.spaces) {
    if (space.id == id) { space.icon = std::move(icon); return true; }
  }
  return false;
}

bool WorkspaceModel::ActivateSpace(const std::string& id) {
  if (!FindSpace(id)) return false;
  state_.active_space_id = id;
  return true;
}

bool WorkspaceModel::RenameSpace(const std::string& id, std::string name) {
  for (auto& space : state_.spaces) {
    if (space.id == id) { space.name = std::move(name); return true; }
  }
  return false;
}

bool WorkspaceModel::AddItem(SavedItem item) {
  auto candidate = state_;
  candidate.items.push_back(std::move(item));
  if (!Valid(candidate)) return false;
  state_ = std::move(candidate);
  return true;
}

bool WorkspaceModel::RenameItem(const std::string& id, std::string title) {
  for (auto& item : state_.items) {
    if (item.id == id) { item.title = std::move(title); return true; }
  }
  return false;
}

bool WorkspaceModel::MoveItem(const std::string& id, const std::string& parent_id) {
  auto candidate = state_;
  const auto found = std::ranges::find(candidate.items, id, &SavedItem::id);
  if (found == candidate.items.end() || found->kind == SavedKind::kFavorite) return false;
  found->parent_id = parent_id;
  if (!Valid(candidate)) return false;
  state_ = std::move(candidate);
  return true;
}

bool WorkspaceModel::RelocateItem(const std::string& id, SavedKind kind,
                                  const std::string& space_id,
                                  const std::string& parent_id,
                                  const std::string& before_id) {
  const auto* original = FindItem(id);
  if (!original || before_id == id ||
      ((original->kind == SavedKind::kFolder) != (kind == SavedKind::kFolder))) return false;
  const auto* old_space = FindSpace(original->space_id);
  const auto* new_space = FindSpace(space_id);
  if (old_space && new_space && old_space->profile_key != new_space->profile_key) return false;
  auto candidate = state_;
  std::set<std::string> subtree{id};
  bool grew = true;
  while (grew) {
    grew = false;
    for (const auto& node : candidate.items)
      if (subtree.contains(node.parent_id)) grew |= subtree.insert(node.id).second;
  }
  if (subtree.contains(parent_id) || subtree.contains(before_id)) return false;
  for (auto& node : candidate.items) {
    if (!subtree.contains(node.id)) continue;
    node.space_id = space_id;
    if (node.id == id) { node.parent_id = parent_id; node.kind = kind; }
  }
  if (!Valid(candidate)) return false;
  auto moving = std::ranges::find(candidate.items, id, &SavedItem::id);
  SavedItem item = *moving;
  candidate.items.erase(moving);
  auto before = candidate.items.end();
  if (!before_id.empty()) {
    before = std::ranges::find(candidate.items, before_id, &SavedItem::id);
    if (before == candidate.items.end() || before->space_id != space_id ||
        before->parent_id != parent_id ||
        ((before->kind == SavedKind::kFavorite) != (kind == SavedKind::kFavorite))) return false;
  }
  candidate.items.insert(before, std::move(item));
  state_ = std::move(candidate);
  return true;
}

bool WorkspaceModel::SetCollapsed(const std::string& id, bool collapsed) {
  for (auto& item : state_.items) {
    if (item.id == id && item.kind == SavedKind::kFolder) {
      item.collapsed = collapsed; return true;
    }
  }
  return false;
}

bool WorkspaceModel::RemoveItem(std::string id) {
  if (!FindItem(id)) return false;
  std::set<std::string> removed{std::move(id)};
  bool grew;
  do {
    grew = false;
    for (const auto& item : state_.items) {
      if (removed.contains(item.parent_id)) grew |= removed.insert(item.id).second;
    }
  } while (grew);
  std::erase_if(state_.items, [&removed](const auto& item) {
    return removed.contains(item.id);
  });
  return true;
}

const WorkspaceSpace* WorkspaceModel::FindSpace(const std::string& id) const {
  const auto found = std::ranges::find(state_.spaces, id, &WorkspaceSpace::id);
  return found == state_.spaces.end() ? nullptr : &*found;
}

const SavedItem* WorkspaceModel::FindItem(const std::string& id) const {
  const auto found = std::ranges::find(state_.items, id, &SavedItem::id);
  return found == state_.items.end() ? nullptr : &*found;
}

std::vector<std::string> WorkspaceModel::Children(const std::string& space_id,
                                                 const std::string& parent_id) const {
  std::vector<std::string> result;
  for (const auto& item : state_.items) {
    if (item.kind != SavedKind::kFavorite && item.space_id == space_id &&
        item.parent_id == parent_id) result.push_back(item.id);
  }
  return result;
}

WorkspaceSnapshot WorkspaceModel::CaptureSnapshot() const { return state_; }

bool WorkspaceModel::RestoreSnapshot(const WorkspaceSnapshot& snapshot) {
  auto restored = snapshot;
  for (size_t i = 0; i < restored.spaces.size(); ++i)
    if (restored.spaces[i].icon.empty()) restored.spaces[i].icon = DefaultSpaceIcon(i);
  if (!Valid(restored)) return false;
  state_ = std::move(restored);
  return true;
}

}  // namespace sidebar
