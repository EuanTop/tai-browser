// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/workspace_commands.h"
#include "sidebar_browser/shortcuts.h"

#include "base/files/file_util.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/task/thread_pool.h"
#include "base/uuid.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/browser_process.h"
#include "base/strings/string_util.h"

namespace sidebar {
namespace {
constexpr size_t kMaximumWorkspaceBytes = 16 * 1024 * 1024;
const char kWorkspaceStateKey[] = "sidebar-browser-workspace";
std::optional<std::string> ReadFile(const base::FilePath& path) {
  if (!base::PathExists(path)) return std::string();
  std::string data;
  if (!base::ReadFileToStringWithMaxSize(path, &data, kMaximumWorkspaceBytes)) return std::nullopt;
  return data;
}
std::string String(const base::DictValue& data, const char* key) {
  const auto* value = data.FindString(key);
  return value ? *value : std::string();
}
}  // namespace

WorkspaceState* WorkspaceState::ForProfile(Profile* profile) {
  if (auto* state = profile->GetUserData(kWorkspaceStateKey)) {
    return static_cast<WorkspaceState*>(state);
  }
  auto state = std::unique_ptr<WorkspaceState>(new WorkspaceState(profile));
  auto* result = state.get();
  profile->SetUserData(kWorkspaceStateKey, std::move(state));
  return result;
}

WorkspaceState::WorkspaceState(Profile* profile) : profile_(profile) {
  system_language_ = g_browser_process && base::StartsWith(
      g_browser_process->GetApplicationLocale(), "zh",
      base::CompareCase::INSENSITIVE_ASCII) ? "zh-CN" : "en";
  if (profile->IsOffTheRecord()) {
    OnLoaded(std::string());
    return;
  }
  new_profile_ = profile->IsNewProfile();
  auto runner = base::ThreadPool::CreateSequencedTaskRunner(
      {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
       base::TaskShutdownBehavior::BLOCK_SHUTDOWN});
  auto path = profile->GetPath().AppendASCII("SidebarWorkspace.json");
  writer_ = std::make_unique<base::ImportantFileWriter>(path, runner);
  runner->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&ReadFile, path),
      base::BindOnce(&WorkspaceState::OnLoaded, weak_factory_.GetWeakPtr()));
}

WorkspaceState::~WorkspaceState() = default;

void WorkspaceState::OnLoaded(std::optional<std::string> data) {
  bool restored = data && data->empty();
  welcome_pending_ = restored && new_profile_;
  auto value = data ? base::JSONReader::Read(*data, base::JSON_PARSE_RFC) : std::nullopt;
  if (value && value->is_dict() && value->GetDict().FindInt("version") == 1) {
    const auto& object = value->GetDict();
    welcome_pending_ = object.FindBool("welcome_pending").value_or(false);
    WorkspaceSnapshot snapshot;
    const auto identity = String(object, "profile_id");
    if (base::Uuid::ParseLowercase(identity).is_valid()) profile_id_ = identity;
    const auto edition = String(object, "edition");
    if (edition == "pride") edition_ = edition;
    const auto language = String(object, "language");
    if (language == "en" || language == "zh-CN" || language == "system")
      language_mode_ = language;
    if (const auto* shortcuts = object.FindDict("shortcuts"))
      shortcut_overrides_ = shortcuts->Clone();
    snapshot.active_space_id = String(object, "active");
    bool valid = (!object.contains("profile_id") ||
        (object.FindString("profile_id") && base::Uuid::ParseLowercase(identity).is_valid())) &&
        (!object.contains("edition") || (object.FindString("edition") &&
          (edition == "standard" || edition == "pride")));
    valid = valid && (!object.contains("language") ||
        language == "en" || language == "zh-CN" || language == "system") &&
        (!object.contains("shortcuts") || (object.FindDict("shortcuts") &&
            !ValidateShortcutOverrides(shortcut_overrides_).has_value()));
    if (const auto* spaces = object.FindList("spaces")) {
      for (const auto& entry : *spaces) {
        if (!entry.is_dict()) { valid = false; break; }
        const auto& item = entry.GetDict();
        const auto color = ParseSpaceColor(String(item, "color"));
        const auto icon = String(item, "icon");
        if (!color || (item.contains("color") && !item.FindString("color")) ||
            (item.contains("icon") && (!item.FindString("icon") || !IsSpaceEmoji(icon)))) {
          valid = false; break;
        }
        const auto id = String(item, "id");
        const auto* menu_icon = item.FindString("menu_icon");
        if (!id.empty() && menu_icon && !menu_icon->empty() &&
            menu_icon->size() <= 40) {
          space_menu_icons_.Set(id, *menu_icon);
        }
        snapshot.spaces.push_back({id, String(item, "name"),
                                   "current-profile", *color, icon});
      }
    } else { valid = false; }
    if (const auto* items = object.FindList("items")) {
      for (const auto& entry : *items) {
        if (!entry.is_dict()) { valid = false; break; }
        const auto& item = entry.GetDict();
        const auto kind = item.FindInt("kind");
        if (!kind || *kind < 0 || *kind > 2) { valid = false; break; }
        snapshot.items.push_back({String(item, "id"), String(item, "space"),
            String(item, "parent"), String(item, "title"), String(item, "url"),
            static_cast<SavedKind>(*kind), item.FindBool("collapsed").value_or(false)});
      }
    } else { valid = false; }
    if (valid) restored = model_.RestoreSnapshot(snapshot);
  }
  if (ValidateShortcutOverrides(shortcut_overrides_)) shortcut_overrides_.clear();
  // Preserve an unreadable or malformed original; never replace it with defaults.
  load_error_ = !restored;
  if (load_error_) {
    welcome_pending_ = false;
    writer_.reset();
  }
  const bool created_default = model_.spaces().empty();
  if (created_default) {
    model_.AddSpace({base::Uuid::GenerateRandomV4().AsLowercaseString(),
                     language() == "zh-CN" ? "个人" : "Personal", "current-profile"});
  }
  const bool migrated_identity = profile_id_.empty();
  if (migrated_identity) profile_id_ = base::Uuid::GenerateRandomV4().AsLowercaseString();
  revision_ = base::Uuid::GenerateRandomV4().AsLowercaseString();
  loaded_ = true;
  if ((created_default || migrated_identity) && !load_error_) Commit();
  else changes_.Notify();
}

bool WorkspaceState::SetEdition(const std::string& edition) {
  if (edition != "standard" && edition != "pride") return false;
  edition_ = edition;
  return true;
}

bool WorkspaceState::SetLanguage(const std::string& language) {
  if (language != "en" && language != "zh-CN" && language != "system") return false;
  language_mode_ = language;
  return true;
}

std::string_view WorkspaceState::color_mode() const {
  auto* service = ThemeServiceFactory::GetForProfile(profile_->GetOriginalProfile());
  using Scheme = ThemeService::BrowserColorScheme;
  switch (service->GetBrowserColorScheme()) {
    case Scheme::kLight: return "light";
    case Scheme::kDark: return "dark";
    default: return "system";
  }
}

void WorkspaceState::SetColorMode(std::string_view mode) {
  auto* service = ThemeServiceFactory::GetForProfile(profile_->GetOriginalProfile());
  using Scheme = ThemeService::BrowserColorScheme;
  const auto scheme = mode == "light" ? Scheme::kLight
      : mode == "dark" ? Scheme::kDark : Scheme::kSystem;
  if (scheme != service->GetBrowserColorScheme()) service->SetBrowserColorScheme(scheme);
}

void WorkspaceState::SetShortcutOverrides(base::DictValue overrides) {
  shortcut_overrides_ = std::move(overrides);
}

std::string_view WorkspaceState::SpaceMenuIcon(std::string_view space_id) const {
  const auto* icon = space_menu_icons_.FindString(space_id);
  return icon ? std::string_view(*icon) : std::string_view();
}

void WorkspaceState::SetSpaceMenuIcon(const std::string& space_id,
                                     std::string icon) {
  if (!loaded_ || load_error_ || icon.size() > 40 ||
      !model_.FindSpace(space_id) || SpaceMenuIcon(space_id) == icon) {
    return;
  }
  if (icon.empty()) {
    space_menu_icons_.Remove(space_id);
  } else {
    space_menu_icons_.Set(space_id, std::move(icon));
  }
  Commit();
}

std::optional<std::string> WorkspaceState::Serialize(
    const WorkspaceModel& model) const {
  base::DictValue object;
  object.Set("version", 1);
  if (welcome_pending_) object.Set("welcome_pending", true);
  object.Set("profile_id", profile_id_);
  object.Set("edition", edition_);
  object.Set("language", language_mode_);
  object.Set("shortcuts", shortcut_overrides_.Clone());
  object.Set("active", model.active_space_id());
  base::ListValue spaces;
  for (const auto& space : model.spaces()) {
    base::DictValue item;
    item.Set("id", space.id); item.Set("name", space.name);
    item.Set("color", SpaceColorHex(space.color));
    item.Set("icon", space.icon);
    if (const auto icon = SpaceMenuIcon(space.id); !icon.empty()) {
      item.Set("menu_icon", icon);
    }
    spaces.Append(std::move(item));
  }
  object.Set("spaces", std::move(spaces));
  base::ListValue items;
  for (const auto& node : model.items()) {
    base::DictValue item;
    item.Set("id", node.id); item.Set("space", node.space_id);
    item.Set("parent", node.parent_id); item.Set("title", node.title);
    item.Set("url", node.url); item.Set("kind", static_cast<int>(node.kind));
    item.Set("collapsed", node.collapsed);
    items.Append(std::move(item));
  }
  object.Set("items", std::move(items));
  return base::WriteJson(object);
}

void WorkspaceState::Publish(std::optional<std::string> data) {
  revision_ = base::Uuid::GenerateRandomV4().AsLowercaseString();
  if (writer_ && data) writer_->WriteNow(std::move(*data));
  changes_.Notify();
}

void WorkspaceState::Commit() {
  if (loaded_) Publish(Serialize(model_));
}

bool WorkspaceState::CompleteWelcome() {
  if (!loaded_) return false;
  if (!welcome_pending_) return true;
  if (load_error_) return false;
  welcome_pending_ = false;
  Commit();
  return true;
}

bool WorkspaceState::CommitImport(WorkspaceModel candidate) {
  if (!loaded_ || !writer_) return false;
  auto data = Serialize(candidate);
  if (!data || data->size() > kMaximumWorkspaceBytes) return false;
  model_ = std::move(candidate);
  Publish(std::move(data));
  return true;
}

base::CallbackListSubscription WorkspaceState::Observe(base::RepeatingClosure callback) {
  return changes_.Add(std::move(callback));
}
}  // namespace sidebar
