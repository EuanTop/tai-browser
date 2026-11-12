// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/native_host.h"
#include <atomic>
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "chrome/browser/profiles/profile.h"
#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/uuid.h"
#include "crypto/hash.h"
#include "sidebar_browser/host-files/secure_directory.h"
#include "sidebar_browser/host/validation.h"
namespace sidebar {
namespace {
using Error = tai::files::Error;
bool ProtectedLocation(const base::FilePath& directory, const base::FilePath& browser_data) {
  return directory.empty() || browser_data.empty() || directory == browser_data ||
         directory.IsParent(browser_data) || browser_data.IsParent(directory);
}
const char* Code(Error error) {
  switch (error) {
    case Error::kNotFound: return "RESOURCE_NOT_FOUND";
    case Error::kInvalidPath: return "INVALID_RESOURCE";
    case Error::kConflict: return "IMMUTABLE_CONFLICT";
    case Error::kQuota: return "QUOTA_EXCEEDED";
    default: return "STORAGE_UNAVAILABLE";
  }
}
}
struct NativeHost::Library {
  std::unique_ptr<tai::files::SecureDirectory> store;
  std::string name, path;
  std::atomic<bool> revoked{false};
};
void NativeHost::LoadLibraries() {
  if (profile_->IsOffTheRecord()) { libraries_ready_ = true; libraries_read_only_ = true; return; }
  struct Loaded {
    base::DictValue records;
    std::map<std::string, std::shared_ptr<Library>> grants;
    bool read_only = false;
  };
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, base::FilePath data_path) {
    Loaded result;
    if (!base::PathExists(path)) return result;
    std::string text;
    if (!base::ReadFileToStringWithMaxSize(path, &text, 65536)) { result.read_only = true; return result; }
    auto parsed = base::JSONReader::Read(text, base::JSON_PARSE_RFC);
    if (!parsed || !parsed->is_dict() || parsed->GetDict().size() > 8) { result.read_only = true; return result; }
    for (const auto [id, value] : parsed->GetDict()) {
      const auto* record = value.is_dict() ? &value.GetDict() : nullptr;
      if (!base::Uuid::ParseLowercase(id).is_valid() || !record || record->size() != 3 ||
          !record->FindString("path") || !record->FindString("name") || !record->FindString("identity")) {
        result.read_only = true; return result;
      }
    }
    result.records = std::move(parsed->GetDict());
    const auto protected_root = base::MakeAbsoluteFilePath(data_path);
    for (const auto [id, value] : result.records) {
      auto grant = std::make_shared<Library>();
      grant->path = *value.GetDict().FindString("path"); grant->name = *value.GetDict().FindString("name");
      if (ProtectedLocation(base::FilePath(grant->path), protected_root)) continue;
      // Walk each component without following symlinks. A replaced folder is
      // not the directory the user selected, even if it has the same pathname.
      grant->store = tai::files::SecureDirectory::Open(grant->path);
      if (grant->store && grant->store->Identity() == *value.GetDict().FindString("identity")) result.grants.emplace(id, grant);
    }
    return result;
  }, profile_->GetPath().AppendASCII("TAiLibraries.json"), profile_->GetPath().DirName()), base::BindOnce([](base::WeakPtr<NativeHost> self, Loaded result) {
    if (!self) return;
    self->library_records_ = std::move(result.records); self->libraries_ = std::move(result.grants);
    self->libraries_read_only_ = result.read_only; self->libraries_ready_ = true;
  }, weak_.GetWeakPtr()));
}
base::ListValue NativeHost::DescribeLibraries() const {
  base::ListValue result;
  for (const auto& [id, grant] : libraries_) {
    base::DictValue item; item.Set("id", id); item.Set("name", grant->name); item.Set("persistent", true);
    result.Append(std::move(item));
  }
  return result;
}
void NativeHost::GrantLibrary(base::FilePath selected, Reply reply) {
  if (!libraries_ready_ || library_pending_) { std::move(reply).Run(HostFailure("", "BUSY")); return; }
  if (libraries_read_only_) { std::move(reply).Run(HostFailure("", "READ_ONLY")); return; }
  library_pending_ = true;
  const auto catalog = profile_->GetPath().AppendASCII("TAiLibraries.json");
  struct Saved { std::string id; std::shared_ptr<Library> grant; base::DictValue records; const char* error = "STORAGE_UNAVAILABLE"; };
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, base::FilePath catalog, base::DictValue records, base::FilePath data_path) {
    Saved result;
    auto canonical = base::MakeAbsoluteFilePath(path);
    if (ProtectedLocation(canonical, base::MakeAbsoluteFilePath(data_path))) { result.error = "INVALID_LIBRARY_LOCATION"; return result; }
    auto grant = std::make_shared<Library>(); grant->path = canonical.value(); grant->name = canonical.BaseName().value();
    grant->store = tai::files::SecureDirectory::Open(grant->path);
    if (!grant->store || grant->store->Identity().empty()) return result;
    std::string id;
    std::string replaced;
    for (const auto [existing, value] : records) if (*value.GetDict().FindString("path") == grant->path) {
      if (*value.GetDict().FindString("identity") == grant->store->Identity()) id = existing;
      else replaced = existing;
    }
    if (!replaced.empty()) records.Remove(replaced);
    if (id.empty()) { if (records.size() >= 8) { result.error = "LIBRARY_LIMIT"; return result; } id = base::Uuid::GenerateRandomV4().AsLowercaseString(); }
    base::DictValue record; record.Set("path", grant->path); record.Set("name", grant->name); record.Set("identity", grant->store->Identity());
    records.Set(id, std::move(record)); auto text = base::WriteJson(records);
    if (!text || !base::ImportantFileWriter::WriteFileAtomically(catalog, *text) || !base::SetPosixFilePermissions(catalog, 0600)) return result;
    result.id = id; result.grant = grant; result.records = std::move(records); return result;
  }, selected, catalog, library_records_.Clone(), profile_->GetPath().DirName()), base::BindOnce([](base::WeakPtr<NativeHost> self, Reply reply, Saved result) {
    if (!self) return;
    self->library_pending_ = false;
    if (!result.grant) { std::move(reply).Run(HostFailure("", result.error)); return; }
    const std::string id = result.id;
    self->library_records_ = std::move(result.records);
    for (auto it = self->libraries_.begin(); it != self->libraries_.end();) {
      if (!self->library_records_.contains(it->first)) { it->second->revoked = true; it = self->libraries_.erase(it); }
      else ++it;
    }
    self->libraries_[id] = result.grant;
    base::DictValue value; value.Set("libraryId", id); value.Set("name", result.grant->name); value.Set("sessionOnly", false);
    std::move(reply).Run(HostSuccess("", base::Value(std::move(value))));
  }, weak_.GetWeakPtr(), std::move(reply)));
}
void NativeHost::RevokeLibrary(std::string id, std::string library, Reply reply) {
  if (library_pending_ || libraries_read_only_) { std::move(reply).Run(HostFailure(id, "BUSY")); return; }
  auto found = libraries_.find(library);
  auto grant = found == libraries_.end() ? nullptr : found->second;
  if (grant) grant->revoked = true;
  library_pending_ = true;
  auto next = library_records_.Clone(); next.Remove(library); auto text = base::WriteJson(next);
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path, std::string text) {
    return base::ImportantFileWriter::WriteFileAtomically(path, text) && base::SetPosixFilePermissions(path, 0600);
  }, profile_->GetPath().AppendASCII("TAiLibraries.json"), *text), base::BindOnce([](base::WeakPtr<NativeHost> self,
      std::string id, std::string library, std::shared_ptr<Library> grant, base::DictValue next, Reply reply, bool saved) {
    if (!self) return;
    self->library_pending_ = false;
    if (saved) { self->library_records_ = std::move(next); self->libraries_.erase(library); }
    else if (grant) grant->revoked = false;
    std::move(reply).Run(saved ? HostSuccess(id, base::Value(true)) : HostFailure(id, "STORAGE_UNAVAILABLE"));
  }, weak_.GetWeakPtr(), id, library, grant, std::move(next), std::move(reply)));
}
void NativeHost::GrantSource(base::FilePath selected, Reply reply) {
  if (sources_.size() >= 4) { std::move(reply).Run(HostFailure("", "QUOTA_EXCEEDED")); return; }
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](base::FilePath path) {
    base::DictValue snapshot;
    auto canonical = base::MakeAbsoluteFilePath(path);
    auto parent = tai::files::SecureDirectory::Open(canonical.DirName().value());
    if (!parent) return snapshot;
    auto text = parent->Read(canonical.BaseName().value());
    if (text.error != Error::kOk || !base::IsStringUTF8(text.text)) return snapshot;
    snapshot.Set("name", canonical.BaseName().value()); snapshot.Set("text", text.text);
    snapshot.Set("sha256", base::HexEncode(crypto::hash::Sha256(text.text)));
    snapshot.Set("bytes", static_cast<int>(text.text.size()));
    return snapshot;
  }, selected), base::BindOnce([](base::WeakPtr<NativeHost> self, Reply reply, base::DictValue snapshot) {
    if (!self) return;
    if (snapshot.empty() || self->sources_.size() >= 4) { std::move(reply).Run(HostFailure("", "SOURCE_UNAVAILABLE")); return; }
    const std::string id = base::Uuid::GenerateRandomV4().AsLowercaseString();
    snapshot.Set("sourceId", id); self->sources_.emplace(id, snapshot.Clone());
    std::move(reply).Run(HostSuccess("", base::Value(std::move(snapshot))));
  }, weak_.GetWeakPtr(), std::move(reply)));
}
void NativeHost::LibraryCommand(const std::string& id, const std::string& command,
    const base::DictValue& payload, const Task* task, Reply reply) {
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(id, code)); };
  const auto* library_id = payload.FindString("libraryId");
  if (command == "library.revoke" && !task) {
    if (!library_id || !HostOnly(payload, {"libraryId"})) { fail("INVALID_ARGUMENTS"); return; }
    if (!library_records_.contains(*library_id)) { fail("LIBRARY_NOT_FOUND"); return; }
    RevokeLibrary(id, *library_id, std::move(reply)); return;
  }
  auto found = library_id ? libraries_.find(*library_id) : libraries_.end();
  if (found == libraries_.end()) { fail("LIBRARY_NOT_FOUND"); return; }
  if (task && !task->libraries.contains(*library_id)) { fail("LIBRARY_DENIED"); return; }
  auto grant = found->second;
  const auto* path = payload.FindString(command == "library.list" ? "prefix" : "resourceId");
  const auto* text = payload.FindString("text");
  if (!path || (command != "library.read" && command != "library.list" && command != "library.putIfAbsent") ||
      (command == "library.putIfAbsent" && (!text || text->size() > 4 * 1024 * 1024)) ||
      !HostOnly(payload, command == "library.putIfAbsent" ? std::initializer_list<std::string_view>{"libraryId","resourceId","text"} :
          command == "library.read" ? std::initializer_list<std::string_view>{"libraryId","resourceId"} : std::initializer_list<std::string_view>{"libraryId","prefix"})) {
    fail("INVALID_ARGUMENTS"); return;
  }
  const std::string token = task ? task->token : std::string();
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce([](std::shared_ptr<Library> grant,
      std::string id, std::string command, std::string path, std::string text) {
    if (grant->revoked.load()) return HostFailure(id, "LIBRARY_REVOKED");
    if (command == "library.read") {
      auto result = grant->store->Read(path);
      if (result.error != Error::kOk) return HostFailure(id, Code(result.error));
      if (!base::IsStringUTF8(result.text)) return HostFailure(id, "INVALID_TEXT");
      return HostSuccess(id, base::Value(std::move(result.text)));
    }
    if (command == "library.list") {
      auto result = grant->store->List(path);
      if (result.error != Error::kOk) return HostFailure(id, Code(result.error));
      base::ListValue files;
      for (const auto& file : result.paths) if (base::IsStringUTF8(file)) files.Append(file);
      return HostSuccess(id, base::Value(std::move(files)));
    }
    auto error = grant->store->PutIfAbsent(path, text);
    return error == Error::kOk ? HostSuccess(id, base::Value(true)) : HostFailure(id, Code(error));
  }, grant, id, command, *path, text ? *text : std::string()),
  base::BindOnce([](base::WeakPtr<NativeHost> self, std::shared_ptr<Library> grant,
       std::string token, std::string id, Reply reply, base::DictValue result) {
    if (!self) return;
    if (grant->revoked || (!token.empty() && !self->tasks_.contains(token))) {
      // A dispatched IO operation may already have published bytes. Never
      // represent cancellation/revocation as rollback of completed work.
      std::move(reply).Run(HostFailure(id, "OPERATION_OBSOLETE")); return;
    }
    std::move(reply).Run(std::move(result));
  }, weak_.GetWeakPtr(), grant, token, id, std::move(reply)));
}
}
