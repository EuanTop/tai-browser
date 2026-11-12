// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/workspace_commands.h"
#include <algorithm>
#include <initializer_list>
#include <string>
#include <string_view>
#include "base/hash/sha1.h"
#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/shortcuts.h"
#include "third_party/icu/source/common/unicode/uchar.h"
#include "url/gurl.h"

namespace sidebar {
namespace {
bool Only(const base::DictValue& object,
          std::initializer_list<std::string_view> keys) {
  return std::ranges::all_of(object, [&](const auto& entry) {
    return std::ranges::find(keys, entry.first) != keys.end();
  });
}
base::DictValue Failure(const std::string& id, const char* code) {
  base::DictValue result, error;
  error.Set("code", code); error.Set("message", code);
  result.Set("id", id); result.Set("ok", false);
  result.Set("error", std::move(error));
  return result;
}
base::DictValue Success(const std::string& id, const WorkspaceState& state) {
  base::DictValue result;
  result.Set("id", id); result.Set("ok", true);
  result.Set("value", DescribeWorkspace(state));
  return result;
}
}  // namespace

bool IsSpaceEmoji(std::string_view icon) {
  if (icon.empty() || icon.size() > 64 || !base::IsStringUTF8(icon)) return false;
  const auto text = base::UTF8ToUTF16(icon);
  return u_stringHasBinaryProperty(text.data(), text.size(), UCHAR_RGI_EMOJI);
}

base::DictValue DescribeWorkspace(const WorkspaceState& state) {
  base::DictValue result;
  result.Set("schema", "tai.settings.v1");
  result.Set("ready", state.loaded());
  result.Set("readOnly", state.load_error());
  if (!state.loaded()) return result;
  result.Set("profileId", state.profile_id());
  result.Set("welcomePending", state.welcome_pending());
  result.Set("revision", state.revision());
  result.Set("edition", state.edition());
  result.Set("language", state.language());
  result.Set("languageMode", state.language_mode());
  result.Set("colorMode", state.color_mode());
  result.Set("shortcutOverrides", state.shortcut_overrides().Clone());
  result.Set("shortcuts", DescribeShortcuts(state));
  base::ListValue spaces;
  // The model has no mutable getter; describing never mutates Profile data.
  for (const auto& space : state.model().spaces()) {
    base::DictValue item;
    item.Set("id", space.id); item.Set("name", space.name);
    item.Set("color", SpaceColorHex(space.color));
    item.Set("icon", space.icon);
    spaces.Append(std::move(item));
  }
  result.Set("spaces", std::move(spaces));
  base::ListValue capabilities;
  capabilities.Append("settings.describe"); capabilities.Append("settings.patch");
  result.Set("capabilities", std::move(capabilities));
  return result;
}

base::DictValue ImportWelcomeSpaces(WorkspaceState& state,
                                    const base::Value& input) {
  if (!state.loaded()) return Failure("", "NOT_READY");
  if (state.load_error()) return Failure("", "READ_ONLY");
  if (!input.is_list() || input.GetList().empty() ||
      input.GetList().size() > 256) {
    return Failure("", "INVALID_IMPORT");
  }

  const auto valid_title = [](const std::string* text, size_t limit) {
    return text && !text->empty() && text->size() <= limit &&
           base::IsStringUTF8(*text) &&
           std::ranges::none_of(*text, [](unsigned char c) {
             return c < 32 || c == 127;
           });
  };

  size_t item_count = 0;
  size_t link_count = 0;
  for (const auto& space : input.GetList()) {
    if (!space.is_dict() || !Only(space.GetDict(), {"name", "items"}) ||
        !valid_title(space.GetDict().FindString("name"), 320)) {
      return Failure("", "INVALID_IMPORT");
    }
    const auto* items = space.GetDict().FindList("items");
    if (!items || (item_count += items->size()) > 10000)
      return Failure("", "INVALID_IMPORT");
    int index = 0;
    for (const auto& item : *items) {
      if (!item.is_dict() ||
          !Only(item.GetDict(), {"title", "parent", "url"}) ||
          !valid_title(item.GetDict().FindString("title"), 1600)) {
        return Failure("", "INVALID_IMPORT");
      }
      const auto& node = item.GetDict();
      const auto parent = node.FindInt("parent");
      if (!parent || *parent < -1 || *parent >= index++)
        return Failure("", "INVALID_IMPORT");
      if (node.contains("url")) {
        const auto* text = node.FindString("url");
        if (!text || text->size() > 8192)
          return Failure("", "INVALID_IMPORT");
        const GURL url(*text);
        if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS() ||
            url.has_username() || url.has_password()) {
          return Failure("", "INVALID_IMPORT");
        }
        ++link_count;
      }
    }
  }
  if (!link_count) return Failure("", "INVALID_IMPORT");

  // Stable IDs make exact repeated imports idempotent across browser restarts.
  // The digest is a batch identifier. It grants no access to source data.
  const auto json = base::WriteJson(input);
  if (!json || json->size() > 8 * 1024 * 1024)
    return Failure("", "IMPORT_STORAGE_LIMIT");
  const auto prefix = "import-" + base::HexEncode(base::SHA1HashString(*json));
  auto snapshot = state.model().CaptureSnapshot();
  size_t space_index = 0;
  for (const auto& value : input.GetList()) {
    const auto& space = value.GetDict();
    const auto space_id = prefix + "-" + std::to_string(space_index++);
    if (state.model().FindSpace(space_id))
      return Failure("", "ALREADY_IMPORTED");
    snapshot.spaces.push_back(
        {space_id, *space.FindString("name"), "current-profile", 0,
         DefaultSpaceIcon(snapshot.spaces.size())});
    size_t index = 0;
    for (const auto& entry : *space.FindList("items")) {
      const auto& node = entry.GetDict();
      const auto item_id = space_id + "-" + std::to_string(index++);
      const auto parent = *node.FindInt("parent");
      const auto parent_id =
          parent == -1 ? std::string() : space_id + "-" + std::to_string(parent);
      const auto* text = node.FindString("url");
      snapshot.items.push_back(
          {item_id, space_id, parent_id, *node.FindString("title"),
           text ? GURL(*text).spec() : std::string(),
           text ? SavedKind::kPage : SavedKind::kFolder});
    }
  }

  WorkspaceModel candidate;
  if (!candidate.RestoreSnapshot(snapshot))
    return Failure("", "INVALID_IMPORT");
  if (!state.CommitImport(std::move(candidate)))
    return Failure("", "IMPORT_STORAGE_LIMIT");
  return Success("", state);
}

base::DictValue ExecuteWorkspaceCommand(WorkspaceState& state,
                                       const base::Value& input) {
  if (!input.is_dict()) return Failure("", "INVALID_REQUEST");
  const auto& request = input.GetDict();
  const auto* id = request.FindString("id");
  if (!id || id->empty() || id->size() > 100) return Failure("", "INVALID_REQUEST");
  const auto* protocol = request.FindString("protocol");
  const auto* command = request.FindString("command");
  const auto* scope = request.FindDict("scope");
  const auto* payload = request.FindDict("payload");
  if (!Only(request, {"id", "protocol", "command", "scope", "payload"}) ||
      !protocol || *protocol != "tai.v1" || !command || !scope || !payload ||
      !Only(*scope, {"profileId", "spaceId"})) return Failure(*id, "INVALID_REQUEST");
  if (!state.loaded()) return Failure(*id, "NOT_READY");
  const auto* profile = scope->FindString("profileId");
  const auto* space_id = scope->FindString("spaceId");
  if (!profile || *profile != state.profile_id()) return Failure(*id, "PROFILE_MISMATCH");
  if (!space_id || space_id->size() > 100 || !state.model().FindSpace(*space_id)) return Failure(*id, "SPACE_NOT_FOUND");
  if (*command == "settings.describe") {
    if (!payload->empty()) return Failure(*id, "INVALID_ARGUMENTS");
    return Success(*id, state);
  }
  if (*command != "settings.patch") return Failure(*id, "COMMAND_UNAVAILABLE");
  if (state.load_error()) return Failure(*id, "READ_ONLY");
  const auto* revision = payload->FindString("revision");
  const auto* changes = payload->FindDict("changes");
  if (!Only(*payload, {"revision", "changes"}) || !revision || !changes || changes->empty() ||
      !Only(*changes, {"name", "color", "icon", "edition", "language", "colorMode", "shortcuts"})) return Failure(*id, "INVALID_ARGUMENTS");
  if (*revision != state.revision()) return Failure(*id, "STALE_REVISION");
  // Validate the ENTIRE patch before touching either model or appearance.
  std::string name;
  if (changes->contains("name")) {
    const auto* value = changes->FindString("name");
    if (!value || value->size() > 320 || !base::IsStringUTF8(*value)) return Failure(*id, "INVALID_NAME");
    auto utf16 = base::UTF8ToUTF16(*value);
    base::TrimWhitespace(utf16, base::TRIM_ALL, &utf16);
    if (utf16.empty() || utf16.size() > 80 ||
        std::ranges::any_of(utf16, [](char16_t c) { return c < 32 || c == 127; }))
      return Failure(*id, "INVALID_NAME");
    name = base::UTF16ToUTF8(utf16);
  }
  if (changes->contains("color")) {
    const auto* value = changes->FindString("color");
    if (!value || !ParseSpaceColor(*value)) return Failure(*id, "INVALID_COLOR");
  }
  if (changes->contains("edition")) {
    const auto* value = changes->FindString("edition");
    if (!value || (*value != "standard" && *value != "pride")) return Failure(*id, "INVALID_EDITION");
  }
  if (changes->contains("icon")) {
    const auto* value = changes->FindString("icon");
    if (!value || !IsSpaceEmoji(*value)) return Failure(*id, "INVALID_ICON");
  }
  if (changes->contains("language")) {
    const auto* language = changes->FindString("language");
    if (!language || (*language != "en" && *language != "zh-CN" && *language != "system"))
      return Failure(*id, "INVALID_LANGUAGE");
  }
  if (changes->contains("colorMode")) {
    const auto* mode = changes->FindString("colorMode");
    if (!mode || (*mode != "system" && *mode != "light" && *mode != "dark"))
      return Failure(*id, "INVALID_COLOR_MODE");
  }
  if (changes->contains("shortcuts")) {
    const auto* shortcuts = changes->FindDict("shortcuts");
    if (!shortcuts) return Failure(*id, "INVALID_SHORTCUT");
    if (const auto error = ValidateShortcutOverrides(*shortcuts))
      return Failure(*id, error->c_str());
  }
  if (changes->contains("name")) state.model().RenameSpace(*space_id, name);
  if (const auto* icon = changes->FindString("icon")) state.model().SetSpaceIcon(*space_id, *icon);
  if (const auto* color = changes->FindString("color")) state.model().SetSpaceColor(*space_id, *color);
  if (const auto* edition = changes->FindString("edition")) state.SetEdition(*edition);
  if (const auto* language = changes->FindString("language")) state.SetLanguage(*language);
  if (const auto* mode = changes->FindString("colorMode")) state.SetColorMode(*mode);
  if (const auto* shortcuts = changes->FindDict("shortcuts"))
    state.SetShortcutOverrides(shortcuts->Clone());
  state.Commit();
  return Success(*id, state);
}
}  // namespace sidebar
