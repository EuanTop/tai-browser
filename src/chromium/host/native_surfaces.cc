// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/native_host.h"
#include <algorithm>
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/string_util.h"
#include "base/uuid.h"
#include "base/strings/utf_string_conversions.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "chrome/browser/profiles/profile.h"
#include "sidebar_browser/host_bundles.h"
#include "sidebar_browser/host/validation.h"
namespace sidebar {
namespace {
std::string StorageNamespace(const std::string& component, const std::string& space) {
  return component.starts_with("tai.") ? component : space + ":" + component;
}
bool Token(std::string_view value, size_t limit = 100) {
  return !value.empty() && value.size() <= limit && std::ranges::all_of(value, [](char c) {
    return base::IsAsciiAlphaNumeric(c) || c == '.' || c == '_' || c == '-';
  });
}
bool Identifier(std::string_view id) {
  const auto dot = id.find('.');
  if (id.size() > 100 || dot == std::string_view::npos || dot == 0 || dot + 1 >= id.size()) return false;
  auto lower = [](char c) { return c >= 'a' && c <= 'z'; };
  if (!lower(id.front()) || !lower(id[dot + 1])) return false;
  for (size_t i = 0; i < id.size(); ++i) {
    const char c = id[i];
    if (!lower(c) && !base::IsAsciiDigit(c) && c != '-' && !(i >= dot && c == '.')) return false;
  }
  return true;
}
bool Version(std::string_view version) {
  if (version.empty() || version.size() > 32) return false;
  int dots = 0; bool digit = false;
  for (char c : version) {
    if (base::IsAsciiDigit(c)) digit = true;
    else if (c == '.' && digit && dots < 2) { ++dots; digit = false; }
    else return false;
  }
  return dots == 2 && digit;
}
bool Manifest(const base::DictValue& value) {
  const auto* id = value.FindString("id"); const auto* version = value.FindString("version");
  const auto* title = value.FindString("title"); const auto* entry = value.FindString("entry");
  const auto* surfaces = value.FindList("surfaces"); const auto* capabilities = value.FindList("capabilities");
  if (!HostOnly(value, {"apiVersion","id","version","title","entry","surfaces","capabilities"}) ||
      value.FindInt("apiVersion") != 1 || !id || !Identifier(*id) ||
      !version || !Version(*version) || !title || base::ContainsOnlyChars(*title, " \t\r\n") || title->size() > 300 ||
      !entry || *entry != "index.html" || !surfaces || surfaces->size() != 1 || !(*surfaces)[0].is_string() || (*surfaces)[0].GetString() != "panel" ||
      !capabilities || capabilities->size() > 4) return false;
  for (const auto& capability : *capabilities) if (!capability.is_string() ||
      (capability.GetString() != "storage" && capability.GetString() != "notifications" &&
       capability.GetString() != "clips.read" && capability.GetString() != "clips.capture")) return false;
  return true;
}
base::DictValue Builtin(std::string id, std::string title, bool storage) {
  base::DictValue manifest; manifest.Set("apiVersion", 1); manifest.Set("id", id); manifest.Set("version", "0.1.0");
  manifest.Set("title", title); manifest.Set("entry", "index.html");
  base::ListValue surfaces; surfaces.Append("panel"); manifest.Set("surfaces", std::move(surfaces));
  base::ListValue capabilities;
  if (storage) { capabilities.Append("storage"); capabilities.Append("notifications"); }
  manifest.Set("capabilities", std::move(capabilities)); return manifest;
}
}
void NativeHost::ReleaseSurface(const std::string& handle) { surfaces_.erase(handle); }
void NativeHost::SurfaceCommand(const std::string& id, const std::string& command,
    const std::string& space, const base::DictValue& payload, Reply reply) {
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(id, code)); };
  if (command == "modules.pending") {
    if (!payload.empty()) { fail("INVALID_ARGUMENTS"); return; }
    base::ListValue candidates;
    for (const auto& [handle, surface] : surfaces_) if (!surface.task_id.empty() && surface.space == space) {
      base::DictValue item, package; item.Set("previewId", handle); item.Set("taskId", surface.task_id);
      package.Set("kind", "custom"); package.Set("manifest", surface.manifest.Clone());
      package.Set("script", surface.script); package.Set("markup", surface.markup); package.Set("style", surface.style);
      item.Set("payload", std::move(package)); candidates.Append(std::move(item));
    }
    std::move(reply).Run(HostSuccess(id, base::Value(std::move(candidates)))); return;
  }
  if (command == "modules.list") {
    if (!payload.empty()) { fail("INVALID_ARGUMENTS"); return; }
    const auto* registry = storage_.FindDict("_tai.modules");
    if (storage_.contains("_tai.modules") && !registry) { fail("READ_ONLY"); return; }
    base::ListValue installed;
    if (registry) for (const auto [key, value] : *registry) {
      if (!value.is_dict()) continue;
      const auto* target = value.GetDict().FindString("spaceId");
      if (target && *target == space) installed.Append(value.Clone());
    }
    std::move(reply).Run(HostSuccess(id, base::Value(std::move(installed)))); return;
  }
  if (command == "modules.disable" || command == "modules.rollback") {
    if (storage_queue_.size() >= 128) { fail("QUOTA_EXCEEDED"); return; }
    storage_queue_.push_back(base::BindOnce(&NativeHost::ChangeModule, weak_.GetWeakPtr(), id, space, payload.Clone(), command == "modules.disable", std::move(reply)));
    if (!storage_busy_) NextStorageWrite();
    return;
  }
  if (command == "modules.preview") {
    if (!HostOnly(payload, {"kind","input","manifest","markup","script","style"}) || surfaces_.size() >= 8) { fail("INVALID_ARGUMENTS"); return; }
    const auto* kind = payload.FindString("kind");
    Surface surface; surface.id = base::Uuid::GenerateRandomV4().AsLowercaseString();
    surface.nonce = base::Uuid::GenerateRandomV4().AsLowercaseString(); surface.space = space;
    surface.markup = "<main></main>";
    surface.style = "body{margin:0;padding:28px;background:#f5f4fc;color:#111735;font:15px/1.65 system-ui}button,input{font:inherit}button{margin:6px;padding:8px 16px}output{display:block;font-size:46px}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}@media(prefers-color-scheme:dark){body{background:#1d1e34;color:#efeffb}button,input{background:#313149;color:#efeffb}td,th{border-color:#494964}}";
    if (kind && *kind == "reader") {
      const auto* input = payload.FindDict("input");
      const auto* format = input ? input->FindString("format") : nullptr;
      const auto* text = input ? input->FindString("text") : nullptr;
      if (!input || !HostOnly(*input, {"format","text"}) || !format || (*format != "markdown" && *format != "json") || !text || text->size() > 2 * 1024 * 1024) { fail("INVALID_DOCUMENT"); return; }
      surface.input = input->Clone(); surface.manifest = Builtin("tai.reader", "Reader", false); surface.script = host_bundles::kReader;
    } else if (kind && *kind == "pomodoro") {
      surface.manifest = Builtin("tai.pomodoro", "Focus timer", true); surface.script = host_bundles::kPomodoro;
    } else if (kind && *kind == "custom") {
      const auto* manifest = payload.FindDict("manifest"); const auto* script = payload.FindString("script");
      const auto* markup = payload.FindString("markup"); const auto* style = payload.FindString("style");
      if (!manifest || !Manifest(*manifest) || !script || script->size() > 2 * 1024 * 1024 ||
          !markup || markup->size() > 256 * 1024 || !style || style->size() > 128 * 1024 ||
          manifest->FindString("id")->starts_with("tai.")) { fail("INVALID_PACKAGE"); return; }
      surface.manifest = manifest->Clone(); surface.script = *script; surface.markup = *markup; surface.style = *style;
    } else { fail("INVALID_ARGUMENTS"); return; }
    surface.component = *surface.manifest.FindString("id");
    const auto storage_key = StorageNamespace(surface.component, surface.space);
    if (storage_.contains(storage_key) && !storage_.FindDict(storage_key)) { fail("READ_ONLY"); return; }
    if (const auto* data = SurfaceData(surface)) surface.base_data = data->Clone();
    surface.preview_data = surface.base_data.Clone();
    if (const auto* registry = storage_.FindDict("_tai.modules")) if (const auto* entry = registry->FindDict(surface.space + ":" + surface.component)) {
      if (const auto* version = entry->FindString("currentVersion")) surface.registry_version = *version;
      surface.registry_enabled = entry->FindBool("enabled").value_or(false);
    }
    base::DictValue result; result.Set("handle", surface.id); result.Set("nonce", surface.nonce);
    result.Set("url", "chrome-untrusted://tai-content/" + surface.id + "/");
    result.Set("componentId", surface.component); result.Set("spaceId", space);
    surfaces_.emplace(surface.id, std::move(surface));
    std::move(reply).Run(HostSuccess(id, base::Value(std::move(result)))); return;
  }
  const auto* handle = payload.FindString("handle");
  auto found = handle ? surfaces_.find(*handle) : surfaces_.end();
  if (found == surfaces_.end() || found->second.space != space) { fail("SURFACE_REVOKED"); return; }
  if (command == "modules.apply") {
    if (!HostOnly(payload, {"handle"}) || storage_queue_.size() >= 128) { fail("INVALID_ARGUMENTS"); return; }
    storage_queue_.push_back(base::BindOnce(&NativeHost::ApplySurface, weak_.GetWeakPtr(), id, *handle, std::move(reply)));
    if (!storage_busy_) NextStorageWrite();
    return;
  }
  if (command == "modules.dispose") {
    if (!HostOnly(payload, {"handle"})) { fail("INVALID_ARGUMENTS"); return; }
    const bool candidate = !found->second.task_id.empty();
    surfaces_.erase(found); if (candidate) module_changes_.Notify();
    std::move(reply).Run(HostSuccess(id, base::Value(true))); return;
  }
  if (command != "modules.call" || !HostOnly(payload, {"handle","op","args"})) { fail("COMMAND_UNAVAILABLE"); return; }
  const auto* op = payload.FindString("op"); const auto* args = payload.FindDict("args");
  if (!op || !args) { fail("INVALID_ARGUMENTS"); return; }
  if (*op == "reader.copyPath") {
    const auto* path = args->FindString("path");
    if (found->second.component != "tai.reader" || !HostOnly(*args, {"path"}) || !path || path->size() > 4096 ||
        (!path->empty() && path->front() != '/') || !base::IsStringUTF8(*path) ||
        std::ranges::any_of(*path, [](unsigned char c) { return c < 32 || c == 127; })) { fail("INVALID_ARGUMENTS"); return; }
    ui::ScopedClipboardWriter(ui::ClipboardBuffer::kCopyPaste).WriteText(base::UTF8ToUTF16(*path));
    std::move(reply).Run(HostSuccess(id, base::Value(true))); return;
  }
  bool storage = false;
  for (const auto& capability : *found->second.manifest.FindList("capabilities")) if (capability.GetString() == "storage") storage = true;
  if ((*op != "storage.get" && *op != "storage.set") || !storage) { fail("CAPABILITY_UNAVAILABLE"); return; }
  const auto* key = args->FindString("key");
  if (!key || !Token(*key) || !HostOnly(*args, *op == "storage.get" ? std::initializer_list<std::string_view>{"key"} : std::initializer_list<std::string_view>{"key","value"})) { fail("INVALID_ARGUMENTS"); return; }
  if (*op == "storage.get") {
    const auto* data = found->second.applied ? SurfaceData(found->second) : &found->second.preview_data;
    const auto* value = data ? data->Find(*key) : nullptr;
    std::move(reply).Run(HostSuccess(id, value ? value->Clone() : base::Value())); return;
  }
  const auto* value = args->Find("value");
  if (!value) { fail("INVALID_ARGUMENTS"); return; }
  auto serialized = base::WriteJson(*value);
  if (!serialized || serialized->size() > 65536) { fail("QUOTA_EXCEEDED"); return; }
  if (storage_queue_.size() >= 128) { fail("QUOTA_EXCEEDED"); return; }
  storage_queue_.push_back(base::BindOnce(&NativeHost::WriteStorage, weak_.GetWeakPtr(),
      id, *handle, *key, value->Clone(), std::move(reply)));
  if (!storage_busy_) NextStorageWrite();
}
void NativeHost::NextStorageWrite() {
  storage_busy_ = false;
  if (storage_queue_.empty()) return;
  auto next = std::move(storage_queue_.front()); storage_queue_.pop_front();
  storage_busy_ = true; std::move(next).Run();
}
const base::DictValue* NativeHost::SurfaceData(const Surface& surface) const {
  const auto key = StorageNamespace(surface.component, surface.space);
  if (const auto* data = storage_.FindDict(key)) return data;
  // Migrate earlier installed, Profile-wide app data by copying it on apply.
  // The legacy record stays untouched; new apps never inherit another Space's
  // namespace just because an Agent chose an existing component identifier.
  const auto* registry = storage_.FindDict("_tai.modules");
  if (!surface.component.starts_with("tai.") && registry && registry->FindDict(surface.space + ":" + surface.component))
    return storage_.FindDict(surface.component);
  return nullptr;
}
void NativeHost::WriteStorage(std::string id, std::string handle, std::string key, base::Value value, Reply reply) {
  auto found = surfaces_.find(handle);
  if (found == surfaces_.end() || storage_read_only_) {
    std::move(reply).Run(HostFailure(id, storage_read_only_ ? "READ_ONLY" : "SURFACE_REVOKED"));
    NextStorageWrite(); return;
  }
  if (!found->second.applied) {
    auto next = found->second.preview_data.Clone(); next.Set(key, std::move(value));
    const auto text = base::WriteJson(next);
    if (!text || text->size() > 4 * 1024 * 1024) std::move(reply).Run(HostFailure(id, "QUOTA_EXCEEDED"));
    else { found->second.preview_data = std::move(next); std::move(reply).Run(HostSuccess(id, base::Value(true))); }
    NextStorageWrite(); return;
  }
  auto next = storage_.Clone();
  const auto storage_key = StorageNamespace(found->second.component, found->second.space);
  auto* data = next.FindDict(storage_key);
  if (!data) { next.Set(storage_key, base::DictValue()); data = next.FindDict(storage_key); }
  data->Set(key, std::move(value));
  auto text = base::WriteJson(next);
  if (!text || text->size() > 4 * 1024 * 1024) {
    std::move(reply).Run(HostFailure(id, "QUOTA_EXCEEDED")); NextStorageWrite(); return;
  }
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, std::string text) {
    return base::ImportantFileWriter::WriteFileAtomically(path, text);
  }, profile_->GetPath().AppendASCII("TAiComponentData.json"), *text),
  base::BindOnce([](base::WeakPtr<NativeHost> self, std::string id, std::string handle,
      base::DictValue next, Reply reply, bool saved) {
    if (!self) return;
    if (saved) self->storage_ = std::move(next);
    std::move(reply).Run(saved ? self->surfaces_.contains(handle) ? HostSuccess(id, base::Value(true)) :
        HostFailure(id, "OPERATION_OBSOLETE") : HostFailure(id, "STORAGE_UNAVAILABLE"));
    self->NextStorageWrite();
  }, weak_.GetWeakPtr(), id, handle, std::move(next), std::move(reply)));
}
void NativeHost::ApplySurface(std::string id, std::string handle, Reply reply) {
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(id, code)); NextStorageWrite(); };
  auto found = surfaces_.find(handle);
  if (found == surfaces_.end()) { fail("SURFACE_REVOKED"); return; }
  if (found->second.component == "tai.reader") {
    found->second.applied = true; std::move(reply).Run(HostSuccess(id, base::Value(true))); NextStorageWrite(); return;
  }
  if (storage_read_only_) { fail("READ_ONLY"); return; }
  if (found->second.applied) { std::move(reply).Run(HostSuccess(id, base::Value(true))); NextStorageWrite(); return; }
  const auto& surface = found->second;
  const auto* current_data = SurfaceData(surface);
  if ((current_data && *current_data != surface.base_data) ||
      (!current_data && !surface.base_data.empty())) { fail("STATE_CONFLICT"); return; }
  auto next = storage_.Clone(); next.Set(StorageNamespace(surface.component, surface.space), surface.preview_data.Clone());
  const bool custom = !surface.component.starts_with("tai.");
  bool changed = false;
  if (custom) {
    auto* registry = next.FindDict("_tai.modules");
    if (!registry) {
      if (next.contains("_tai.modules")) { fail("READ_ONLY"); return; }
      next.Set("_tai.modules", base::DictValue()); registry = next.FindDict("_tai.modules");
    }
    const std::string key = surface.space + ":" + surface.component;
    const auto* previous = registry->FindDict(key);
    if (registry->contains(key) && !previous) { fail("READ_ONLY"); return; }
    const auto* current_version = previous ? previous->FindString("currentVersion") : nullptr;
    if ((current_version ? *current_version : std::string()) != surface.registry_version ||
        (previous && previous->FindBool("enabled").value_or(false)) != surface.registry_enabled) { fail("STATE_CONFLICT"); return; }
    base::DictValue package;
    package.Set("kind", "custom"); package.Set("manifest", surface.manifest.Clone());
    package.Set("script", surface.script); package.Set("markup", surface.markup); package.Set("style", surface.style);
    base::ListValue versions;
    std::string current;
    if (previous) {
      const auto* list = previous->FindList("versions"); const auto* active = previous->FindString("currentVersion");
      if (!list || !active || list->empty() || list->size() > 3) { fail("READ_ONLY"); return; }
      versions = list->Clone();
      for (const auto& version : versions) {
        const auto* item = version.is_dict() ? &version.GetDict() : nullptr;
        const auto* entry_id = item ? item->FindString("id") : nullptr;
        const auto* payload = item ? item->FindDict("payload") : nullptr;
        if (!entry_id || !payload) { fail("READ_ONLY"); return; }
        if (*entry_id == *active && *payload == package) current = *entry_id;
      }
    }
    if (current.empty()) {
      changed = true; current = base::Uuid::GenerateRandomV4().AsLowercaseString();
      base::DictValue version; version.Set("id", current); version.Set("payload", std::move(package));
      versions.Insert(versions.begin(), base::Value(std::move(version)));
      while (versions.size() > 3) versions.erase(versions.end() - 1);
    }
    base::DictValue entry; entry.Set("componentId", surface.component); entry.Set("spaceId", surface.space);
    entry.Set("enabled", true); entry.Set("revision", base::Uuid::GenerateRandomV4().AsLowercaseString());
    entry.Set("currentVersion", current); entry.Set("versions", std::move(versions));
    registry->Set(key, std::move(entry));
  }
  auto text = base::WriteJson(next);
  if (!text || text->size() > 4 * 1024 * 1024) { fail("QUOTA_EXCEEDED"); return; }
  const auto component = surface.component, space = surface.space;
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, std::string text) {
    return base::ImportantFileWriter::WriteFileAtomically(path, text);
  }, profile_->GetPath().AppendASCII("TAiComponentData.json"), *text),
  base::BindOnce([](base::WeakPtr<NativeHost> self, std::string id, std::string handle,
      std::string component, std::string space, bool changed, base::DictValue next, Reply reply, bool saved) {
    if (!self) return;
    if (saved) {
      self->storage_ = std::move(next);
      if (changed) for (auto it = self->surfaces_.begin(); it != self->surfaces_.end();) {
        if (it->first != handle && it->second.component == component && it->second.space == space && it->second.applied) it = self->surfaces_.erase(it);
        else ++it;
      }
      const auto found = self->surfaces_.find(handle);
      if (found != self->surfaces_.end()) {
        found->second.applied = true;
        const auto& applied = found->second;
        for (auto it = self->surfaces_.begin(); it != self->surfaces_.end();) {
          const auto& candidate = it->second;
          if (it->first != handle && !candidate.task_id.empty() && candidate.component == component && candidate.space == space &&
              candidate.script == applied.script && candidate.markup == applied.markup && candidate.style == applied.style && candidate.manifest == applied.manifest) it = self->surfaces_.erase(it);
          else ++it;
        }
      }
      if (!component.starts_with("tai.")) self->module_changes_.Notify();
    }
    std::move(reply).Run(saved ? self->surfaces_.contains(handle) ? HostSuccess(id, base::Value(true)) :
        HostFailure(id, "OPERATION_OBSOLETE") : HostFailure(id, "STORAGE_UNAVAILABLE"));
    self->NextStorageWrite();
  }, weak_.GetWeakPtr(), id, handle, component, space, changed, std::move(next), std::move(reply)));
}
void NativeHost::ChangeModule(std::string id, std::string space, base::DictValue payload, bool disable, Reply reply) {
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(id, code)); NextStorageWrite(); };
  const auto* component = payload.FindString("componentId"); const auto* expected = payload.FindString("expectedRevision");
  const auto* version = payload.FindString("versionId");
  if (storage_read_only_) { fail("READ_ONLY"); return; }
  if (!component || !expected || !HostOnly(payload, disable ? std::initializer_list<std::string_view>{"componentId","expectedRevision"} :
      std::initializer_list<std::string_view>{"componentId","expectedRevision","versionId"}) || (!disable && !version)) { fail("INVALID_ARGUMENTS"); return; }
  auto next = storage_.Clone(); auto* registry = next.FindDict("_tai.modules");
  auto* entry = registry ? registry->FindDict(space + ":" + *component) : nullptr;
  const auto* revision = entry ? entry->FindString("revision") : nullptr;
  if (!entry || !revision) { fail("MODULE_NOT_FOUND"); return; }
  if (*revision != *expected) { fail("STALE_REVISION"); return; }
  if (!disable) {
    const auto* versions = entry->FindList("versions"); bool exists = false;
    if (versions) for (const auto& item : *versions) if (item.is_dict() && item.GetDict().FindString("id") && *item.GetDict().FindString("id") == *version) exists = true;
    if (!exists) { fail("VERSION_NOT_FOUND"); return; }
    entry->Set("currentVersion", *version);
  }
  entry->Set("enabled", !disable); entry->Set("revision", base::Uuid::GenerateRandomV4().AsLowercaseString());
  auto text = base::WriteJson(next);
  if (!text || text->size() > 4 * 1024 * 1024) { fail("QUOTA_EXCEEDED"); return; }
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, std::string text) {
    return base::ImportantFileWriter::WriteFileAtomically(path, text);
  }, profile_->GetPath().AppendASCII("TAiComponentData.json"), *text), base::BindOnce([](base::WeakPtr<NativeHost> self,
      std::string id, std::string component, std::string space, base::DictValue next, Reply reply, bool saved) {
    if (!self) return;
    if (saved) {
      self->storage_ = std::move(next);
      for (auto it = self->surfaces_.begin(); it != self->surfaces_.end();) {
        if (it->second.component == component && it->second.space == space) it = self->surfaces_.erase(it);
        else ++it;
      }
      self->module_changes_.Notify();
    }
    std::move(reply).Run(saved ? HostSuccess(id, base::Value(true)) : HostFailure(id, "STORAGE_UNAVAILABLE")); self->NextStorageWrite();
  }, weak_.GetWeakPtr(), id, *component, space, std::move(next), std::move(reply)));
}
std::optional<std::string> NativeHost::SurfaceHtml(std::string_view path) const {
  const auto slash = path.find('/');
  if (slash == std::string_view::npos) return {};
  const std::string id(path.substr(0, slash));
  auto found = surfaces_.find(id);
  if (found == surfaces_.end() || (path.substr(slash) != "/" && path.substr(slash) != "/index.html")) return {};
  const auto& surface = found->second;
  base::DictValue boot; boot.Set("instance", surface.id); boot.Set("nonce", surface.nonce);
  boot.Set("manifest", surface.manifest.Clone()); boot.Set("script", surface.script); boot.Set("input", surface.input.Clone());
  auto json = base::WriteJson(boot);
  if (!json) return {};
  base::ReplaceSubstringsAfterOffset(&*json, 0, "<", "\\u003c");
  return "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
      "<script>globalThis.__TAI_BOOT__=" + *json + ";</script><script>" + std::string(host_bundles::kBootstrap) +
      "</script><style>" + surface.style + "</style></head><body>" + surface.markup + "</body></html>";
}
}
