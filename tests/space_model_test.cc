#include "sidebar/space_model.h"

#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

#define CHECK(condition)                                             \
  do {                                                               \
    if (!(condition)) {                                              \
      std::cerr << "Failed at line " << __LINE__ << ": " #condition  \
                << '\n';                                            \
      std::exit(1);                                                  \
    }                                                                \
  } while (false)

using sidebar::Result;
using sidebar::SpaceModel;
using sidebar::SpaceSnapshot;

void SwitchingPreservesSpaceMembership() {
  SpaceModel model;
  CHECK(model.AddSpace({"work", "工作", "profile-a"}) == Result::kOk);
  CHECK(model.AddSpace({"study", "学习", "profile-a"}) == Result::kOk);
  CHECK(model.AttachTab("tab-1", "work", "profile-a") == Result::kOk);
  CHECK(model.AttachTab("tab-2", "study", "profile-a") == Result::kOk);
  CHECK(model.AttachTab("tab-3", "work", "profile-a") == Result::kOk);
  for (int i = 0; i < 100; ++i) {
    CHECK(model.ActivateSpace("study") == Result::kOk);
    CHECK(model.TabsInSpace("study") == std::vector<std::string>({"tab-2"}));
    CHECK(model.ActivateSpace("work") == Result::kOk);
    CHECK(model.TabsInSpace("work") == std::vector<std::string>({"tab-1", "tab-3"}));
  }
  CHECK(model.ActivateSpace("missing") == Result::kUnknownSpace);
  CHECK(model.active_space_id() == "work");
}

void ProfileMismatchesLeaveStateUnchanged() {
  SpaceModel model;
  CHECK(model.AddSpace({"work", "工作", "profile-a"}) == Result::kOk);
  CHECK(model.AddSpace({"personal", "个人", "profile-b"}) == Result::kOk);
  CHECK(model.AttachTab("tab-1", "work", "profile-a") == Result::kOk);
  CHECK(model.AttachTab("wrong-profile", "personal", "profile-a") == Result::kProfileMismatch);
  CHECK(model.TabsInSpace("personal").empty());
  CHECK(model.MoveTab("tab-1", "personal") == Result::kProfileMismatch);
  CHECK(model.TabsInSpace("work") == std::vector<std::string>({"tab-1"}));
  CHECK(model.TabsInSpace("personal").empty());
  // Different account Spaces can be selected; UI hosting is the adapter's job.
  CHECK(model.ActivateSpace("personal") == Result::kOk);
  CHECK(model.active_space_id() == "personal");
}

void MovesAndCloseNotificationsDoNotLoseOtherTabs() {
  SpaceModel model;
  CHECK(model.AddSpace({"a", "A", "profile"}) == Result::kOk);
  CHECK(model.AddSpace({"b", "B", "profile"}) == Result::kOk);
  CHECK(model.AttachTab("one", "a", "profile") == Result::kOk);
  CHECK(model.AttachTab("two", "b", "profile") == Result::kOk);
  CHECK(model.AttachTab("three", "b", "profile") == Result::kOk);
  CHECK(model.MoveTab("one", "b") == Result::kOk);
  CHECK(model.TabsInSpace("a").empty());
  CHECK(model.TabsInSpace("b") == std::vector<std::string>({"two", "three", "one"}));
  CHECK(model.MoveTab("two", "b") == Result::kOk);
  CHECK(model.TabsInSpace("b") == std::vector<std::string>({"two", "three", "one"}));
  CHECK(model.ForgetTab("three") == Result::kOk);
  CHECK(model.ForgetTab("three") == Result::kUnknownTab);
  CHECK(model.AttachTab("one", "a", "profile") == Result::kDuplicateId);
  CHECK(model.TabsInSpace("b") == std::vector<std::string>({"two", "one"}));
  CHECK(model.RemoveSpace("b") == Result::kSpaceNotEmpty);
  CHECK(model.spaces().size() == 2);
  CHECK(model.RemoveSpace(model.spaces().front().id) == Result::kOk);
  CHECK(model.active_space_id() == "b");
  CHECK(model.ForgetTab("one") == Result::kOk);
  CHECK(model.ForgetTab("two") == Result::kOk);
  CHECK(model.RemoveSpace("b") == Result::kOk);
  CHECK(!model.active_space_id());
}

void InvalidRequestsPreserveTheExistingWorkspace() {
  SpaceModel model;
  CHECK(model.AddSpace({"", "Invalid", "profile"}) == Result::kInvalidId);
  CHECK(model.AddSpace({"a", "Invalid", ""}) == Result::kInvalidId);
  CHECK(model.spaces().empty());
  CHECK(model.AddSpace({"a", "A", "profile"}) == Result::kOk);
  CHECK(model.AddSpace({"a", "Replacement", "other"}) == Result::kDuplicateId);
  CHECK(model.FindSpace("a")->profile_key == "profile");
  CHECK(model.AttachTab("", "a", "profile") == Result::kInvalidId);
  CHECK(model.AttachTab("one", "missing", "profile") == Result::kUnknownSpace);
  CHECK(model.MoveTab("missing", "a") == Result::kUnknownTab);
  CHECK(model.RemoveSpace("missing") == Result::kUnknownSpace);
  CHECK(model.TabsInSpace("a").empty());
}

void MetadataRoundTripExcludesLiveBindings() {
  SpaceModel original;
  CHECK(original.AddSpace({"work", "工作", "profile-a"}) == Result::kOk);
  CHECK(original.AddSpace({"personal", "个人", "profile-b"}) == Result::kOk);
  CHECK(original.AddSpace({"study", "", "profile-a"}) == Result::kOk);
  CHECK(original.AttachTab("work-tab", "work", "profile-a") == Result::kOk);
  CHECK(original.AttachTab("personal-tab", "personal", "profile-b") == Result::kOk);
  CHECK(original.ActivateSpace("personal") == Result::kOk);
  const auto snapshot = original.CaptureSnapshot();
  CHECK(original.AddSpace({"later", "稍后", "profile-a"}) == Result::kOk);
  CHECK(original.ActivateSpace("work") == Result::kOk);

  SpaceModel restored;
  CHECK(restored.RestoreSnapshot(snapshot) == Result::kOk);
  CHECK(restored.spaces().size() == 3);
  CHECK(restored.spaces()[0].id == "work");
  CHECK(restored.spaces()[1].id == "personal");
  CHECK(restored.spaces()[2].id == "study");
  CHECK(restored.FindSpace("work")->name == "工作");
  CHECK(restored.FindSpace("work")->profile_key == "profile-a");
  CHECK(restored.FindSpace("personal")->name == "个人");
  CHECK(restored.FindSpace("personal")->profile_key == "profile-b");
  CHECK(restored.FindSpace("study")->name.empty());
  CHECK(restored.FindSpace("study")->profile_key == "profile-a");
  CHECK(restored.active_space_id() == "personal");
  CHECK(restored.TabsInSpace("work").empty());
  CHECK(restored.TabsInSpace("personal").empty());
  CHECK(restored.AttachTab("work-tab", "work", "profile-a") == Result::kOk);
}

void InvalidSnapshotsAreRejectedAtomically() {
  SpaceModel receiver;
  CHECK(receiver.AddSpace({"old", "保留", "profile-old"}) == Result::kOk);
  const std::vector<SpaceSnapshot> invalid = {
      {{{"dup", "A", "p"}, {"dup", "B", "p"}}, std::string("dup")},
      {{{"", "A", "p"}}, std::string("")},
      {{{"a", "A", ""}}, std::string("a")},
      {{{"a", "A", "p"}}, std::nullopt},
      {{{"a", "A", "p"}}, std::string("missing")},
      {{}, std::string("orphan")},
  };
  for (const auto& snapshot : invalid) {
    CHECK(receiver.RestoreSnapshot(snapshot) == Result::kInvalidSnapshot);
    CHECK(receiver.spaces().size() == 1);
    CHECK(receiver.FindSpace("old"));
    CHECK(receiver.FindSpace("old")->name == "保留");
    CHECK(receiver.FindSpace("old")->profile_key == "profile-old");
    CHECK(receiver.active_space_id() == "old");
  }
}

void SnapshotRestoreProtectsExistingLiveTabs() {
  SpaceModel receiver;
  CHECK(receiver.AddSpace({"work", "工作", "profile-a"}) == Result::kOk);
  CHECK(receiver.AttachTab("live", "work", "profile-a") == Result::kOk);
  const SpaceSnapshot replacement = {
      {{"personal", "个人", "profile-b"}}, std::string("personal")};
  CHECK(receiver.RestoreSnapshot(replacement) == Result::kSpaceNotEmpty);
  CHECK(receiver.active_space_id() == "work");
  CHECK(receiver.FindSpace("work")->profile_key == "profile-a");
  CHECK(receiver.TabsInSpace("work") == std::vector<std::string>({"live"}));
  CHECK(receiver.ForgetTab("live") == Result::kOk);
  CHECK(receiver.RestoreSnapshot(replacement) == Result::kOk);
  CHECK(receiver.active_space_id() == "personal");
  CHECK(!receiver.FindSpace("work"));
}

void EmptySnapshotRestoresAnEmptyWorkspace() {
  SpaceModel receiver;
  CHECK(receiver.AddSpace({"old", "Old", "p"}) == Result::kOk);
  CHECK(receiver.RestoreSnapshot({{}, std::nullopt}) == Result::kOk);
  CHECK(receiver.spaces().empty());
  CHECK(!receiver.active_space_id());
  SpaceModel another;
  CHECK(another.RestoreSnapshot(receiver.CaptureSnapshot()) == Result::kOk);
  CHECK(another.spaces().empty());
  CHECK(!another.active_space_id());
}

int main() {
  SwitchingPreservesSpaceMembership();
  ProfileMismatchesLeaveStateUnchanged();
  MovesAndCloseNotificationsDoNotLoseOtherTabs();
  InvalidRequestsPreserveTheExistingWorkspace();
  MetadataRoundTripExcludesLiveBindings();
  InvalidSnapshotsAreRejectedAtomically();
  SnapshotRestoreProtectsExistingLiveTabs();
  EmptySnapshotRestoresAnEmptyWorkspace();
  std::cout << "8 Space model scenarios passed\n";
}
