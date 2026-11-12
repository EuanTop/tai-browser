// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/native_host.h"
#include <utility>
#include <algorithm>
#include <sys/stat.h>
#include <unistd.h>
#include "base/files/file_enumerator.h"
#include "base/command_line.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/rand_util.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "base/uuid.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/session_service.h"
#include "chrome/browser/sessions/session_service_factory.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "sidebar_browser/host/page_identity.h"
#include "sidebar_browser/sidebar_session.h"
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/host/local_host_server.h"
#include "sidebar_browser/host/validation.h"
namespace sidebar {
namespace {
constexpr char kKey[] = "tai-native-host";
const std::set<std::string>& AgentCommands() {
  static const base::NoDestructor<std::set<std::string>> commands(
      {"page.list", "page.open", "page.read", "page.act", "page.screenshot"});
  return *commands;
}
bool ValidProvider(std::string_view name) {
  return name == "codex" || name == "claude" || name == "pi" || name == "other";
}
base::DictValue ConnectionCatalog(base::FilePath directory, std::string profile) {
  base::DictValue records; struct stat info;
  if (lstat(directory.value().c_str(), &info) || !S_ISDIR(info.st_mode) ||
      info.st_uid != getuid() || (info.st_mode & 0077)) return records;
  std::vector<std::pair<base::Time, base::FilePath>> files;
  base::FileEnumerator entries(directory, false, base::FileEnumerator::FILES, "*.json");
  for (auto path = entries.Next(); !path.empty() && files.size() < 512; path = entries.Next())
    files.emplace_back(entries.GetInfo().GetLastModifiedTime(), path);
  std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
  for (const auto& [time, path] : files) {
    if (records.size() >= 16) break;
    const auto id = path.BaseName().RemoveExtension().value();
    if (!base::Uuid::ParseLowercase(id).is_valid() || lstat(path.value().c_str(), &info) ||
        !S_ISREG(info.st_mode) || info.st_uid != getuid() || info.st_nlink != 1 || (info.st_mode & 0077)) continue;
    std::string text;
    if (!base::ReadFileToStringWithMaxSize(path, &text, 16384)) continue;
    auto value = base::JSONReader::Read(text, base::JSON_PARSE_RFC);
    const auto* config = value && value->is_dict() ? &value->GetDict() : nullptr;
    const auto* binding = config ? config->FindDict("binding") : nullptr;
    const auto* commands = config ? config->FindList("commands") : nullptr;
    const auto* libraries = config ? config->FindList("libraries") : nullptr;
    if (!config || !config->FindString("protocol") || *config->FindString("protocol") != "tai.local.v1" || !binding || binding->size() != 3 || !commands || commands->empty() || commands->size() > AgentCommands().size() || !libraries || !libraries->empty() ||
        !binding->FindString("profileId") || *binding->FindString("profileId") != profile ||
        !binding->FindString("taskId") || *binding->FindString("taskId") != id || !binding->FindString("spaceId")) continue;
    bool allowed = true; std::set<std::string> unique;
    for (const auto& command : *commands) {
      if (!command.is_string() || !AgentCommands().contains(command.GetString()) || !unique.insert(command.GetString()).second) { allowed = false; break; }
    }
    if (!allowed || (unique.contains("page.screenshot") &&
                     (!unique.contains("page.list") || !unique.contains("page.read")))) continue;
    const auto* provider = config->FindString("provider");
    base::DictValue record; record.Set("id", id); record.Set("spaceId", *binding->FindString("spaceId"));
    record.Set("provider", provider && ValidProvider(*provider) ? *provider : "other");
    record.Set("commands", commands->Clone());
    const auto* window = config->FindString("windowKey");
    const auto* token = config->FindString("token");
    if (window && base::Uuid::ParseLowercase(*window).is_valid() &&
        token && token->size() == 64 && std::ranges::all_of(*token, base::IsHexDigit<char>)) {
      record.Set("windowKey", *window);
      record.Set("token", *token);
      record.Set("paused", config->FindBool("paused").value_or(false));
    }
    records.Set(id, std::move(record));
  }
  return records;
}
std::optional<base::DictValue> ReadStorage(base::FilePath path) {
  if (!base::PathExists(path)) return base::DictValue();
  std::string text;
  if (!base::ReadFileToStringWithMaxSize(path, &text, 4 * 1024 * 1024)) return {};
  auto value = base::JSONReader::Read(text, base::JSON_PARSE_RFC);
  if (!value || !value->is_dict()) return {};
  return std::move(value->GetDict());
}
bool PublishConfig(base::FilePath directory, base::FilePath path, std::string data) {
  if (!base::CreateDirectory(directory) || !base::SetPosixFilePermissions(directory, 0700)) return false;
  return base::ImportantFileWriter::WriteFileAtomically(path, data) &&
         base::SetPosixFilePermissions(path, 0600);
}
}
base::DictValue HostFailure(const std::string& id, const char* code) {
  base::DictValue result, error;
  error.Set("code", code); error.Set("message", code); error.Set("retryable", false);
  result.Set("id", id); result.Set("ok", false); result.Set("error", std::move(error));
  return result;
}
base::DictValue HostSuccess(const std::string& id, base::Value value) {
  base::DictValue result; result.Set("id", id); result.Set("ok", true); result.Set("value", std::move(value));
  return result;
}
NativeHost* NativeHost::ForProfile(Profile* profile) {
  if (auto* host = profile->GetUserData(kKey)) return static_cast<NativeHost*>(host);
  auto host = std::unique_ptr<NativeHost>(new NativeHost(profile));
  auto* result = host.get(); profile->SetUserData(kKey, std::move(host)); return result;
}
NativeHost::NativeHost(Profile* profile) : profile_(profile), workspace_(WorkspaceState::ForProfile(profile)),
    io_(base::ThreadPool::CreateSequencedTaskRunner({base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN})) {
  // Retired component/library files stay untouched, including malformed data.
  storage_ready_ = true; storage_read_only_ = true;
  libraries_ready_ = true; libraries_read_only_ = true;
  workspace_subscription_ = workspace_->Observe(base::BindRepeating(
      [](base::WeakPtr<NativeHost> self) {
        if (!self) return;
        self->LoadConnections();
        self->RestoreConnections();
      }, weak_.GetWeakPtr()));
  LoadConnections();
}
NativeHost::~NativeHost() = default;
base::WeakPtr<NativeHost> NativeHost::GetWeakPtr() { return weak_.GetWeakPtr(); }
base::CallbackListSubscription NativeHost::ObserveModules(base::RepeatingClosure callback) { return module_changes_.Add(std::move(callback)); }
void NativeHost::LoadConnections() {
  if (!workspace_->loaded() || connections_loading_) return;
  connections_loading_ = true;
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce(&ConnectionCatalog,
      profile_->GetPath().AppendASCII("TAiHostConnections"), workspace_->profile_id()),
      base::BindOnce([](base::WeakPtr<NativeHost> self, base::DictValue saved) {
        if (!self) return;
        self->saved_connections_ = std::move(saved);
        self->connections_ready_ = true;
        self->RestoreConnections();
      }, weak_.GetWeakPtr()));
}
std::string NativeHost::AgentWindowKeyFor(BrowserWindowInterface& window) {
  auto* host = static_cast<NativeHost*>(window.GetProfile()->GetUserData(kKey));
  if (host) {
    for (const auto& [key, saved_window] : host->remembered_windows_) {
      if (saved_window.get() == &window) return key;
    }
  }
  return {};
}

void NativeHost::RestoreAgentWindow(BrowserWindowInterface& window,
                                    const std::string& key) {
  auto* profile = window.GetProfile();
  if (profile->IsOffTheRecord() ||
      window.GetType() != BrowserWindowInterface::TYPE_NORMAL ||
      !base::Uuid::ParseLowercase(key).is_valid() ||
      !AgentWindowKeyFor(window).empty()) return;
  auto* service = SessionServiceFactory::GetForProfile(profile);
  if (!service) return;
  auto* host = ForProfile(profile);
  if (!host->remembered_windows_.emplace(key, window.GetWeakPtr()).second) return;
  service->AddWindowExtraData(window.GetSessionID(), kAgentWindowSessionKey, key);
  host->RestoreConnections();
}

std::string NativeHost::RememberWindow(BrowserWindowInterface& window) {
  if (profile_->IsOffTheRecord() ||
      window.GetType() != BrowserWindowInterface::TYPE_NORMAL) return {};
  auto key = AgentWindowKeyFor(window);
  if (!key.empty()) return key;
  auto* service = SessionServiceFactory::GetForProfile(profile_);
  if (!service) return {};
  key = base::Uuid::GenerateRandomV4().AsLowercaseString();
  service->AddWindowExtraData(window.GetSessionID(), kAgentWindowSessionKey, key);
  remembered_windows_.emplace(key, window.GetWeakPtr());
  return key;
}

void NativeHost::StartServer(base::OnceClosure ready) {
  server_waiters_.push_back(std::move(ready));
  if (server_starting_) return;
  server_starting_ = true;
  server_ = std::make_unique<LocalHostServer>(
      base::BindRepeating(&NativeHost::ExecuteAgent, weak_.GetWeakPtr()),
      base::BindOnce([](base::WeakPtr<NativeHost> self, std::string path) {
        if (!self) return;
        self->endpoint_ = std::move(path);
        self->server_starting_ = false;
        self->server_failed_ = self->endpoint_.empty();
        auto pending = std::move(self->server_waiters_);
        for (auto& callback : pending) std::move(callback).Run();
        self->RestoreConnections();
      }, weak_.GetWeakPtr()));
}

base::DictValue NativeHost::TaskConfig(const Task& task) const {
  base::DictValue binding;
  binding.Set("profileId", workspace_->profile_id());
  binding.Set("spaceId", task.space);
  binding.Set("taskId", task.id);
  base::ListValue commands;
  for (const auto& command : task.commands) commands.Append(command);
  base::DictValue config;
  config.Set("protocol", "tai.local.v1");
  config.Set("provider", task.provider);
  config.Set("endpoint", endpoint_);
  config.Set("token", task.token);
  config.Set("binding", std::move(binding));
  config.Set("commands", std::move(commands));
  config.Set("libraries", base::ListValue());
  if (!task.window_key.empty()) {
    config.Set("windowKey", task.window_key);
    config.Set("paused", !task.pause_reason.empty() &&
                          task.pause_reason != "USER_EDITING");
  }
  return config;
}

void NativeHost::RestoreConnections() {
  if (!connections_ready_ || !workspace_->loaded() || server_failed_) return;
  for (const auto [id, value] : saved_connections_) {
    const auto& saved = value.GetDict();
    const auto* token = saved.FindString("token");
    const auto* key = saved.FindString("windowKey");
    if (!token || !key || tasks_.contains(*token) ||
        reconnecting_.contains(id) ||
        tasks_.size() + pending_task_writes_ >= 16) continue;
    const auto window = remembered_windows_.find(*key);
    const auto* space = saved.FindString("spaceId");
    if (window == remembered_windows_.end() || !window->second ||
        window->second->IsDeleteScheduled() ||
        !space || !workspace_->model().FindSpace(*space)) continue;
    if (endpoint_.empty()) {
      if (!server_starting_) StartServer(base::DoNothing());
      return;
    }
    Task task;
    task.id = id;
    task.token = *token;
    task.space = *space;
    task.provider = *saved.FindString("provider");
    task.window = window->second;
    task.window_key = *key;
    for (const auto& command : *saved.FindList("commands")) {
      task.commands.insert(command.GetString());
    }
    if (saved.FindBool("paused").value_or(false)) task.pause_reason = "USER_PAUSED";
    const auto directory = profile_->GetPath().AppendASCII("TAiHostConnections");
    const auto path = directory.AppendASCII(task.id + ".json");
    auto text = base::WriteJson(TaskConfig(task));
    reconnecting_.insert(task.id);
    ++pending_task_writes_;
    io_->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&PublishConfig, directory, path,
                                  std::move(*text)),
        base::BindOnce([](base::WeakPtr<NativeHost> self, Task task, bool ok) {
          if (!self) return;
          --self->pending_task_writes_;
          self->reconnecting_.erase(task.id);
          if (!ok || !task.window || task.window->IsDeleteScheduled() ||
              !self->saved_connections_.contains(task.id) ||
              !self->workspace_->model().FindSpace(task.space)) return;
          self->Record(task, "restored");
          const auto token = task.token;
          self->tasks_.emplace(token, std::move(task));
        }, weak_.GetWeakPtr(), std::move(task)));
  }
}

void NativeHost::PersistPause(const Task& task) {
  if (task.window_key.empty()) return;
  const auto directory = profile_->GetPath().AppendASCII("TAiHostConnections");
  const auto path = directory.AppendASCII(task.id + ".json");
  auto config = TaskConfig(task);
  if (auto* saved = saved_connections_.FindDict(task.id)) {
    saved->Set("paused", config.FindBool("paused").value_or(false));
  }
  io_->PostTask(FROM_HERE, base::BindOnce(
      [](base::FilePath directory, base::FilePath path, std::string text) {
        // A failed write must not silently restore an older, unpaused grant.
        if (!PublishConfig(directory, path, std::move(text))) base::DeleteFile(path);
      }, directory, path, *base::WriteJson(config)));
}

void NativeHost::LoadStorage() {
  if (profile_->IsOffTheRecord()) { storage_ready_ = true; storage_read_only_ = true; return; }
  io_->PostTaskAndReplyWithResult(FROM_HERE,
      base::BindOnce(&ReadStorage, profile_->GetPath().AppendASCII("TAiComponentData.json")),
      base::BindOnce([](base::WeakPtr<NativeHost> self, std::optional<base::DictValue> data) {
        if (!self) return;
        self->storage_read_only_ = !data.has_value();
        if (data) self->storage_ = std::move(*data);
        self->storage_ready_ = true;
      }, weak_.GetWeakPtr()));
}
base::DictValue NativeHost::Describe() const {
  base::DictValue result;
  result.Set("schema", "tai.host.v1"); result.Set("ready", workspace_->loaded() && connections_ready_);
  result.Set("profileId", workspace_->profile_id());
  result.Set("storageReadOnly", storage_read_only_);
  base::ListValue commands;
  for (const auto& command : AgentCommands()) commands.Append(command);
  result.Set("agentCommands", std::move(commands));
  result.Set("libraries", DescribeLibraries());
  base::ListValue unavailable;
  for (const auto [id, value] : library_records_) if (!libraries_.contains(id)) {
    base::DictValue item; item.Set("id", id); item.Set("name", *value.GetDict().FindString("name"));
    unavailable.Append(std::move(item));
  }
  result.Set("unavailableLibraries", std::move(unavailable));
  result.Set("libraryCatalogReadOnly", libraries_read_only_);
  base::DictValue runtime;
  const auto* launch = base::CommandLine::ForCurrentProcess();
  const auto node = launch->GetSwitchValuePath("tai-agent-node");
  const auto entry = launch->GetSwitchValuePath("tai-agent-entry");
  if (node.IsAbsolute() && entry.IsAbsolute()) {
    runtime.Set("node", node.value()); runtime.Set("entry", entry.value());
    runtime.Set("piEntry", entry.DirName().AppendASCII("pi-extension.mjs").value());
  }
  result.Set("agentRuntime", std::move(runtime));
  base::ListValue tasks;
  for (const auto& [token, task] : tasks_) {
    base::DictValue item; item.Set("id", task.id); item.Set("spaceId", task.space);
    base::ListValue allowed; for (const auto& command : task.commands) allowed.Append(command);
    item.Set("commands", std::move(allowed)); item.Set("used", task.used);
    item.Set("provider", task.provider); item.Set("everConnected", task.ever_connected);
    item.Set("windowClosed", !task.window);
    item.Set("remembered", !task.window_key.empty());
    const bool paused = IsTaskPaused(task);
    item.Set("paused", paused);
    item.Set("pauseReason", paused ? task.pause_reason : std::string());
    item.Set("hasAttentionPage", paused && !task.attention_page.empty());
    item.Set("activity", task.events.empty() ? std::string() :
                         *task.events.back().FindString("event"));
    base::ListValue clients;
    for (const auto& [id, client] : task.clients) if (base::TimeTicks::Now() - client.seen < base::Seconds(45)) {
      base::DictValue row; row.Set("name", client.name); row.Set("version", client.version); clients.Append(std::move(row));
    }
    item.Set("connected", !clients.empty()); item.Set("clients", std::move(clients)); tasks.Append(std::move(item));
  }
  result.Set("tasks", std::move(tasks));
  base::ListValue saved;
  for (const auto [id, value] : saved_connections_) {
    bool active = false; for (const auto& [token, task] : tasks_) if (task.id == id) active = true;
    const auto* space = value.GetDict().FindString("spaceId");
    if (!active && space && workspace_->model().FindSpace(*space)) {
      auto row = value.GetDict().Clone();
      row.Set("remembered", row.contains("windowKey"));
      row.Remove("windowKey");
      row.Remove("token");
      row.Remove("paused");
      saved.Append(std::move(row));
    }
  }
  result.Set("savedTasks", std::move(saved));
  return result;
}
void NativeHost::Record(Task& task, std::string_view event,
                        std::string_view request, std::string_view page) {
  constexpr size_t kMaxEvents = 32;
  base::DictValue entry;
  entry.Set("cursor", ++task.sequence);
  entry.Set("event", event);
  if (!request.empty()) entry.Set("requestId", request);
  if (!page.empty()) entry.Set("pageId", page);
  if (task.events.size() == kMaxEvents) task.events.pop_front();
  task.events.push_back(std::move(entry));
}

base::DictValue NativeHost::TaskStatus(const Task& task, int after) const {
  base::DictValue status;
  status.Set("cursor", task.sequence);
  status.Set("state", !task.window ? "window_closed" :
                      task.pause_reason.empty() ? "ready" : "paused");
  if (!task.pause_reason.empty()) {
    status.Set("reason", task.pause_reason);
    status.Set("pauseScope", task.pause_reason == "USER_EDITING" ? "page" : "task");
  }
  if (!task.attention_page.empty()) status.Set("pageId", task.attention_page);
  const bool reset = after > task.sequence ||
                     after < task.sequence - static_cast<int>(task.events.size());
  status.Set("reset", reset);
  base::ListValue events;
  if (!reset) {
    for (const auto& entry : task.events) {
      if (entry.FindInt("cursor").value_or(0) > after)
        events.Append(entry.Clone());
    }
  }
  status.Set("events", std::move(events));
  return status;
}

bool NativeHost::IsTaskPaused(const Task& task) const {
  if (task.pause_reason != "USER_EDITING") return !task.pause_reason.empty();
  auto* tabs = task.window ? task.window->GetTabStripModel() : nullptr;
  auto* active = tabs ? tabs->GetActiveWebContents() : nullptr;
  if (!active || !active->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) return false;
  const auto* identity = PageIdentity::FromWebContents(active);
  const auto binding = ReadOrganization(active);
  return identity && identity->id() == task.attention_page && binding &&
         !binding->placeholder && binding->space_id == task.space;
}

void NativeHost::Pause(Task& task, std::string_view reason,
                       std::string_view page) {
  // An explicit pause or a handoff can supersede local page protection.
  // Repeated input on the same page must not invalidate its references again.
  if (!task.pause_reason.empty() &&
      (task.pause_reason != "USER_EDITING" ||
       (reason == "USER_EDITING" && task.attention_page == page))) return;
  task.pause_reason = reason;
  task.attention_page = page;
  ++task.control_epoch;
  Record(task, "paused", {}, page);
  if (reason != "USER_EDITING") PersistPause(task);
}

void NativeHost::Resume(Task& task) {
  if (task.pause_reason.empty()) return;
  const bool persist = task.pause_reason != "USER_EDITING";
  task.pause_reason.clear();
  task.attention_page.clear();
  ++task.control_epoch;
  Record(task, "resumed");
  if (persist) PersistPause(task);
}

void NativeHost::OnUserPageInput(content::WebContents* contents) {
  auto* view = contents->GetRenderWidgetHostView();
  if (!view || !view->HasFocus() ||
      !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) return;
  auto* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  auto* host = static_cast<NativeHost*>(profile->GetUserData(kKey));
  if (!host || host->tasks_.empty()) return;
  const auto binding = ReadOrganization(contents);
  const auto* identity = PageIdentity::FromWebContents(contents);
  if (!binding || binding->placeholder || !identity) return;
  for (auto& [token, task] : host->tasks_) {
    if (!task.window || task.space != binding->space_id ||
        !task.commands.contains("page.act"))
      continue;
    const auto* tabs = task.window->GetTabStripModel();
    if (tabs && tabs->GetActiveWebContents() == contents)
      host->Pause(task, "USER_EDITING", identity->id());
  }
}

void NativeHost::OnPageChanged(content::WebContents* contents,
                               std::string_view event) {
  if (!contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) return;
  auto* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  auto* host = static_cast<NativeHost*>(profile->GetUserData(kKey));
  if (!host || host->tasks_.empty()) return;
  const auto binding = ReadOrganization(contents);
  const auto* identity = PageIdentity::FromWebContents(contents);
  if (!binding || binding->placeholder || !identity) return;
  for (auto& [token, task] : host->tasks_) {
    if (!task.window || task.space != binding->space_id ||
        !task.commands.contains("page.list"))
      continue;
    const auto* tabs = task.window->GetTabStripModel();
    if (tabs && tabs->GetIndexOfWebContents(contents) != TabStripModel::kNoTab)
      host->Record(task, event, {}, identity->id());
  }
}

bool NativeHost::SetTaskPaused(const std::string& id,
                               BrowserWindowInterface* window, bool paused) {
  for (auto& [token, task] : tasks_) {
    if (task.id != id || !window || task.window.get() != window ||
        (!task.commands.contains("page.act") && !task.commands.contains("page.open")))
      continue;
    if (paused) {
      Pause(task, "USER_PAUSED");
    } else {
      Resume(task);
    }
    return true;
  }
  return false;
}

void NativeHost::ExecuteUI(const base::Value& request, Reply reply) { Dispatch(request, nullptr, std::move(reply)); }
void NativeHost::ExecuteAgent(std::string token, base::Value request, Reply reply) {
  const auto found = tasks_.find(token);
  if (found == tasks_.end()) { const auto* request_id = request.is_dict() ? request.GetDict().FindString("id") : nullptr;
    std::move(reply).Run(HostFailure(request_id && request_id->size() <= 100 ? *request_id : std::string(), "LEASE_REVOKED")); return; }
  Dispatch(request, &found->second, std::move(reply));
}
void NativeHost::Dispatch(const base::Value& input, Task* task, Reply reply) {
  if (!input.is_dict()) { std::move(reply).Run(HostFailure("", "INVALID_REQUEST")); return; }
  const auto& request = input.GetDict();
  const auto* id = request.FindString("id"); const auto* protocol = request.FindString("protocol");
  const auto* command = request.FindString("command"); const auto* scope = request.FindDict("scope");
  const auto* payload = request.FindDict("payload");
  if (!id || id->empty() || id->size() > 100 || !protocol || *protocol != "tai.v1" || !command ||
      !scope || !payload || !HostOnly(request, {"id","protocol","command","scope","payload"}) ||
      !HostOnly(*scope, {"profileId","spaceId","taskId","pageId","pageRevision"})) {
    std::move(reply).Run(HostFailure("", "INVALID_REQUEST")); return;
  }
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(*id, code)); };
  if (!workspace_->loaded() || !storage_ready_) { fail("NOT_READY"); return; }
  const auto* profile = scope->FindString("profileId"); const auto* space = scope->FindString("spaceId");
  if (!profile || *profile != workspace_->profile_id()) { fail("PROFILE_MISMATCH"); return; }
  if (!space || !workspace_->model().FindSpace(*space)) { fail("SPACE_NOT_FOUND"); return; }
  if (task) {
    const auto* task_id = scope->FindString("taskId");
    if (*space != task->space || !task_id || *task_id != task->id) { fail("SCOPE_MISMATCH"); return; }
    if (task->pause_reason == "USER_EDITING" && !IsTaskPaused(*task)) Resume(*task);
  }
  if (task && *command == "host.client") {
    const auto* event = payload->FindString("event"); const auto* session = payload->FindString("sessionId");
    if (!event || !session || !base::Uuid::ParseLowercase(*session).is_valid() || scope->size() != 3) { fail("INVALID_ARGUMENTS"); return; }
    for (auto it = task->clients.begin(); it != task->clients.end();) {
      if (base::TimeTicks::Now() - it->second.seen >= base::Seconds(45)) it = task->clients.erase(it); else ++it;
    }
    if (*event == "connected") {
      const auto* name = payload->FindString("name"); const auto* version = payload->FindString("version");
      if (!name || name->empty() || name->size() > 100 || !base::IsStringUTF8(*name) || !version || version->size() > 100 ||
          !base::IsStringUTF8(*version) || !HostOnly(*payload, {"event","sessionId","name","version"}) || task->clients.size() >= 8) { fail("INVALID_ARGUMENTS"); return; }
      task->clients[*session] = {*name, *version, base::TimeTicks::Now()}; task->ever_connected = true;
    } else {
      if (!HostOnly(*payload, {"event","sessionId"})) { fail("INVALID_ARGUMENTS"); return; }
      if (*event == "disconnected") task->clients.erase(*session);
      else if (*event == "heartbeat") {
        if (!task->clients.contains(*session)) { fail("CLIENT_NOT_REGISTERED"); return; }
        task->clients[*session].seen = base::TimeTicks::Now();
      }
      else { fail("INVALID_ARGUMENTS"); return; }
    }
    std::move(reply).Run(HostSuccess(*id, base::Value(true))); return;
  }
  if (task && *command == "page.status") {
    if (!task->commands.contains("page.list")) { fail("CAPABILITY_DENIED"); return; }
    const auto after = payload->FindInt("after");
    if (scope->size() != 3 || !HostOnly(*payload, {"after"}) ||
        (payload->contains("after") && (!after || *after < 0))) {
      fail("INVALID_ARGUMENTS"); return;
    }
    std::move(reply).Run(HostSuccess(*id, base::Value(TaskStatus(*task, after.value_or(task->sequence)))));
    return;
  }
  if (task && !task->commands.contains(*command)) { fail("CAPABILITY_DENIED"); return; }
  if (*command == "host.describe" && !task && payload->empty()) {
    std::move(reply).Run(HostSuccess(*id, base::Value(Describe()))); return;
  }
  if (command->starts_with("page.")) {
    if (task) task->used = true;
    Page(*id, *command, *scope, *payload, task, std::move(reply));
    return;
  }
  // Only browser-page tools are exposed. Historical business commands cannot
  // be reactivated by opening an old WebUI URL or forging a trusted request.
  fail("COMMAND_UNAVAILABLE");
}
void NativeHost::CreateTask(std::string space, std::vector<std::string> commands,
    std::vector<std::string> libraries, base::WeakPtr<BrowserWindowInterface> window, Reply reply, std::string provider, std::string reconnect_id, bool remember) {
  if (!workspace_->loaded() || !workspace_->model().FindSpace(space) || !window ||
      window->GetProfile() != profile_ || tasks_.size() + pending_task_writes_ >= 16 || libraries.size() > 8 || commands.empty() || commands.size() > 8) {
    std::move(reply).Run(HostFailure("", "INVALID_ARGUMENTS")); return;
  }
  for (const auto& command : commands) if (!AgentCommands().contains(command)) {
    std::move(reply).Run(HostFailure("", "CAPABILITY_DENIED")); return;
  }
  const std::set<std::string> requested(commands.begin(), commands.end());
  if (!libraries.empty() ||
      (requested.contains("page.screenshot") &&
       (!requested.contains("page.list") || !requested.contains("page.read")))) {
    std::move(reply).Run(HostFailure("", "CAPABILITY_DENIED")); return;
  }
  if (!connections_ready_ || !ValidProvider(provider)) { std::move(reply).Run(HostFailure("", "NOT_READY")); return; }
  if (!reconnect_id.empty()) {
    const auto* saved = saved_connections_.FindDict(reconnect_id);
    const auto* previous = saved ? saved->FindList("commands") : nullptr;
    std::set<std::string> old; if (previous) for (const auto& c : *previous) old.insert(c.GetString());
    bool active = reconnecting_.contains(reconnect_id); for (const auto& [key, task] : tasks_) if (task.id == reconnect_id) active = true;
    auto with_screenshot = old;
    const bool can_upgrade_screenshot =
        old.contains("page.list") && old.contains("page.read") &&
        with_screenshot.insert("page.screenshot").second;
    const auto* previous_provider = saved ? saved->FindString("provider") : nullptr;
    if (!saved || !saved->FindString("spaceId") ||
        *saved->FindString("spaceId") != space || active ||
        (old != requested &&
         (!can_upgrade_screenshot || requested != with_screenshot ||
          !previous_provider || *previous_provider != provider))) {
      std::move(reply).Run(HostFailure("", "RECONNECT_DENIED")); return;
    }
  }
  if (server_failed_) { std::move(reply).Run(HostFailure("", "CONNECTION_UNAVAILABLE")); return; }
  if (endpoint_.empty()) {
    if (server_waiters_.size() >= 16) { std::move(reply).Run(HostFailure("", "QUOTA_EXCEEDED")); return; }
    StartServer(base::BindOnce(&NativeHost::CreateTask, weak_.GetWeakPtr(),
        space, commands, libraries, window, std::move(reply), provider,
        reconnect_id, remember));
    return;
  }
  Task task;
  task.id = reconnect_id.empty() ? base::Uuid::GenerateRandomV4().AsLowercaseString() : reconnect_id;
  task.provider = provider;
  task.reconnected = !reconnect_id.empty();
  task.token = base::HexEncode(base::RandBytesAsString(32));
  task.space = space;
  task.commands = requested;
  task.window = window;
  if (remember) {
    task.window_key = RememberWindow(*window);
    if (task.window_key.empty()) {
      std::move(reply).Run(HostFailure("", "CONNECTION_UNAVAILABLE"));
      return;
    }
  }
  if (task.reconnected) reconnecting_.insert(task.id);
  auto config = TaskConfig(task);
  auto scope = config.FindDict("binding")->Clone();
  const auto directory = profile_->GetPath().AppendASCII("TAiHostConnections");
  const auto path = directory.AppendASCII(task.id + ".json");
  auto text = base::WriteJson(config);
  ++pending_task_writes_;
  io_->PostTaskAndReplyWithResult(FROM_HERE, base::BindOnce(&PublishConfig, directory, path, *text),
      base::BindOnce([](base::WeakPtr<NativeHost> self, Task task, base::FilePath path,
                       base::DictValue scope, Reply reply, bool saved) {
        if (!self) return;
        --self->pending_task_writes_; self->reconnecting_.erase(task.id);
        if (task.reconnected && !self->saved_connections_.contains(task.id)) saved = false;
        if (!saved || self->tasks_.size() >= 16 || !task.window || !self->workspace_->model().FindSpace(task.space)) {
          self->io_->PostTask(FROM_HERE, base::BindOnce([](base::FilePath path) { base::DeleteFile(path); }, path));
          std::move(reply).Run(HostFailure("", "CONNECTION_UNAVAILABLE")); return;
        }
        base::DictValue result; result.Set("taskId", task.id); result.Set("binding", std::move(scope));
        result.Set("configFile", path.value());
        base::DictValue record; record.Set("id", task.id); record.Set("spaceId", task.space); record.Set("provider", task.provider);
        base::ListValue commands; for (const auto& c : task.commands) commands.Append(c);
        record.Set("commands", std::move(commands));
        if (!task.window_key.empty()) {
          record.Set("windowKey", task.window_key);
          record.Set("token", task.token);
        }
        self->saved_connections_.Set(task.id, std::move(record));
        self->Record(task, "authorized");
        const auto token = task.token;
        self->tasks_.emplace(token, std::move(task));
        std::move(reply).Run(HostSuccess("", base::Value(std::move(result))));
      }, weak_.GetWeakPtr(), std::move(task), path, std::move(scope), std::move(reply)));
}
bool NativeHost::RevokeTask(const std::string& id) {
  bool removed = saved_connections_.Remove(id);
  for (auto it = tasks_.begin(); it != tasks_.end(); ++it) if (it->second.id == id) {
    tasks_.erase(it); removed = true; break;
  }
  if (!removed) return false;
  for (auto it = surfaces_.begin(); it != surfaces_.end();) {
    if (it->second.task_id == id) it = surfaces_.erase(it); else ++it;
  }
  module_changes_.Notify();
  io_->PostTask(FROM_HERE, base::BindOnce([](base::FilePath path) { base::DeleteFile(path); },
      profile_->GetPath().AppendASCII("TAiHostConnections").AppendASCII(id + ".json")));
  return true;
}
}
