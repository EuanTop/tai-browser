#include "sidebar/space_model.h"

#include <algorithm>
#include <utility>

namespace sidebar {

const Space* SpaceModel::FindSpace(const std::string& space_id) const {
  auto found = std::find_if(spaces_.begin(), spaces_.end(),
                            [&](const Space& space) { return space.id == space_id; });
  return found == spaces_.end() ? nullptr : &*found;
}

Result SpaceModel::AddSpace(Space space) {
  if (space.id.empty() || space.profile_key.empty()) {
    return Result::kInvalidId;
  }
  if (FindSpace(space.id)) {
    return Result::kDuplicateId;
  }
  spaces_.push_back(std::move(space));
  if (!active_) {
    active_ = spaces_.back().id;
  }
  return Result::kOk;
}

Result SpaceModel::ActivateSpace(const std::string& space_id) {
  if (!FindSpace(space_id)) {
    return Result::kUnknownSpace;
  }
  active_ = space_id;
  return Result::kOk;
}

Result SpaceModel::RemoveSpace(std::string space_id) {
  if (!FindSpace(space_id)) {
    return Result::kUnknownSpace;
  }
  if (!TabsInSpace(space_id).empty()) {
    return Result::kSpaceNotEmpty;
  }
  std::erase_if(spaces_, [&](const Space& space) { return space.id == space_id; });
  if (active_ == space_id) {
    active_ = spaces_.empty() ? std::nullopt
                              : std::optional<std::string>(spaces_.front().id);
  }
  return Result::kOk;
}

Result SpaceModel::AttachTab(std::string tab_id,
                             const std::string& space_id,
                             const std::string& actual_profile_key) {
  if (tab_id.empty()) {
    return Result::kInvalidId;
  }
  const Space* space = FindSpace(space_id);
  if (!space) {
    return Result::kUnknownSpace;
  }
  if (tabs_.contains(tab_id)) {
    return Result::kDuplicateId;
  }
  if (actual_profile_key != space->profile_key) {
    return Result::kProfileMismatch;
  }
  tabs_.emplace(tab_id, TabBinding{space_id, actual_profile_key});
  tab_order_.push_back(std::move(tab_id));
  return Result::kOk;
}

Result SpaceModel::MoveTab(const std::string& tab_id,
                           const std::string& destination_space_id) {
  auto found = tabs_.find(tab_id);
  if (found == tabs_.end()) {
    return Result::kUnknownTab;
  }
  const Space* destination = FindSpace(destination_space_id);
  if (!destination) {
    return Result::kUnknownSpace;
  }
  if (found->second.profile_key != destination->profile_key) {
    return Result::kProfileMismatch;
  }
  if (found->second.space_id != destination_space_id) {
    found->second.space_id = destination_space_id;
    std::erase(tab_order_, tab_id);
    tab_order_.push_back(tab_id);
  }
  return Result::kOk;
}

Result SpaceModel::ForgetTab(const std::string& tab_id) {
  if (tabs_.erase(tab_id) == 0) {
    return Result::kUnknownTab;
  }
  std::erase(tab_order_, tab_id);
  return Result::kOk;
}

SpaceSnapshot SpaceModel::CaptureSnapshot() const {
  return {spaces_, active_};
}

Result SpaceModel::RestoreSnapshot(const SpaceSnapshot& snapshot) {
  if (!tabs_.empty()) {
    return Result::kSpaceNotEmpty;
  }
  const bool has_spaces = !snapshot.spaces.empty();
  if (has_spaces != snapshot.active_space_id.has_value()) {
    return Result::kInvalidSnapshot;
  }
  SpaceModel candidate;
  for (const auto& space : snapshot.spaces) {
    if (candidate.AddSpace(space) != Result::kOk) {
      return Result::kInvalidSnapshot;
    }
  }
  if (snapshot.active_space_id &&
      candidate.ActivateSpace(*snapshot.active_space_id) != Result::kOk) {
    return Result::kInvalidSnapshot;
  }
  // Only a fully validated candidate can replace the receiver's metadata.
  *this = std::move(candidate);
  return Result::kOk;
}

std::vector<std::string> SpaceModel::TabsInSpace(const std::string& space_id) const {
  std::vector<std::string> selected;
  for (const auto& tab_id : tab_order_) {
    if (tabs_.at(tab_id).space_id == space_id) {
      selected.push_back(tab_id);
    }
  }
  return selected;
}

}  // namespace sidebar
