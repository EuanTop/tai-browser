// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_WORKSPACE_STATE_H_
#define SIDEBAR_BROWSER_WORKSPACE_STATE_H_

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include "base/callback_list.h"
#include "base/files/important_file_writer.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/supports_user_data.h"
#include "base/values.h"
#include "sidebar_browser/model/workspace_model.h"

class Profile;
namespace sidebar {
// One shared organization store per Profile, including across multiple windows.
// Off-the-record profiles are memory-only and never read/write this file.
class WorkspaceState final : public base::SupportsUserData::Data {
 public:
  static WorkspaceState* ForProfile(Profile* profile);
  ~WorkspaceState() override;
  WorkspaceModel& model() { return model_; }
  const WorkspaceModel& model() const { return model_; }
  bool loaded() const { return loaded_; }
  bool load_error() const { return load_error_; }
  const std::string& profile_id() const { return profile_id_; }
  const std::string& revision() const { return revision_; }
  const std::string& edition() const { return edition_; }
  bool SetEdition(const std::string& edition);
  const std::string& language() const {
    return language_mode_ == "system" ? system_language_ : language_mode_;
  }
  const std::string& language_mode() const { return language_mode_; }
  bool SetLanguage(const std::string& language);
  std::string_view color_mode() const;
  void SetColorMode(std::string_view mode);
  const base::DictValue& shortcut_overrides() const { return shortcut_overrides_; }
  void SetShortcutOverrides(base::DictValue overrides);
  std::string_view SpaceMenuIcon(std::string_view space_id) const;
  void SetSpaceMenuIcon(const std::string& space_id, std::string icon);
  bool welcome_pending() const { return welcome_pending_; }
  bool CompleteWelcome();
  bool CommitImport(WorkspaceModel candidate);
  void Commit();
  base::CallbackListSubscription Observe(base::RepeatingClosure callback);
 private:
  explicit WorkspaceState(Profile* profile);
  void OnLoaded(std::optional<std::string> data);
  std::optional<std::string> Serialize(const WorkspaceModel& model) const;
  void Publish(std::optional<std::string> data);
  const raw_ptr<Profile> profile_;
  WorkspaceModel model_;
  std::string profile_id_;
  std::string revision_;
  std::string edition_ = "standard";
  std::string system_language_;
  std::string language_mode_ = "system";
  base::DictValue shortcut_overrides_;
  base::DictValue space_menu_icons_;
  bool new_profile_ = false;
  bool welcome_pending_ = false;
  bool loaded_ = false;
  bool load_error_ = false;
  std::unique_ptr<base::ImportantFileWriter> writer_;
  base::RepeatingClosureList changes_;
  base::WeakPtrFactory<WorkspaceState> weak_factory_{this};
};
}  // namespace sidebar
#endif
