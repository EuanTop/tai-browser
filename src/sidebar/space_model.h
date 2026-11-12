#ifndef SIDEBAR_SPACE_MODEL_H_
#define SIDEBAR_SPACE_MODEL_H_

#include <map>
#include <optional>
#include <string>
#include <vector>

namespace sidebar {

// Profile keys are opaque identifiers supplied by the Chromium adapter.
// This model owns organization metadata, never Browser/Profile/WebContents.
struct Space {
  std::string id;
  std::string name;
  std::string profile_key;
};

// Startup metadata only. Live tab identities are rebound from Chromium's own
// session lifecycle and must never be serialized through this value.
struct SpaceSnapshot {
  std::vector<Space> spaces;
  std::optional<std::string> active_space_id;
};

enum class Result {
  kOk,
  kInvalidId,
  kDuplicateId,
  kUnknownSpace,
  kUnknownTab,
  kProfileMismatch,
  kSpaceNotEmpty,
  kInvalidSnapshot,
};

class SpaceModel {
 public:
  Result AddSpace(Space space);
  Result ActivateSpace(const std::string& space_id);
  Result RemoveSpace(std::string space_id);

  // Called after the adapter observes a real Chromium tab. The actual profile
  // key must come from that tab's BrowserContext, not from the requested Space.
  // Tab IDs are unique within one live model and are not persisted across runs.
  Result AttachTab(std::string tab_id,
                   const std::string& space_id,
                   const std::string& actual_profile_key);
  Result MoveTab(const std::string& tab_id,
                 const std::string& destination_space_id);
  Result ForgetTab(const std::string& tab_id);

  SpaceSnapshot CaptureSnapshot() const;
  // Load before attaching real tabs. Invalid input or existing live bindings
  // leaves this model unchanged; filesystem/session restoration is external.
  Result RestoreSnapshot(const SpaceSnapshot& snapshot);

  const std::vector<Space>& spaces() const { return spaces_; }
  const std::optional<std::string>& active_space_id() const { return active_; }
  const Space* FindSpace(const std::string& space_id) const;
  std::vector<std::string> TabsInSpace(const std::string& space_id) const;

 private:
  struct TabBinding {
    std::string space_id;
    std::string profile_key;
  };
  std::vector<Space> spaces_;
  std::optional<std::string> active_;
  std::map<std::string, TabBinding> tabs_;
  // Presentation order only; Chromium retains all real tab lifecycle state.
  std::vector<std::string> tab_order_;
};

}  // namespace sidebar

#endif  // SIDEBAR_SPACE_MODEL_H_
