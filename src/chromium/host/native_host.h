// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_NATIVE_HOST_H_
#define SIDEBAR_BROWSER_HOST_NATIVE_HOST_H_
#include <cstdint>
#include <map>
#include <deque>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <vector>
#include "base/files/file_path.h"
#include "base/callback_list.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/supports_user_data.h"
#include "base/task/sequenced_task_runner.h"
#include "base/values.h"
#include "base/time/time.h"
#include "content/public/browser/weak_document_ptr.h"
class Profile;
namespace content { class WebContents; }
class BrowserWindowInterface;
namespace sidebar {
class WorkspaceState;
class LocalHostServer;
// Native authority, never instantiated in a module or selected by a caller ID.
class NativeHost final : public base::SupportsUserData::Data {
 public:
  using Reply = base::OnceCallback<void(base::DictValue)>;
  static NativeHost* ForProfile(Profile* profile);
  ~NativeHost() override;
  static constexpr char kAgentWindowSessionKey[] = "tai.agent.window";
  static std::string AgentWindowKeyFor(BrowserWindowInterface& window);
  static void RestoreAgentWindow(BrowserWindowInterface& window,
                                 const std::string& key);
  base::WeakPtr<NativeHost> GetWeakPtr();
  base::DictValue Describe() const;
  base::CallbackListSubscription ObserveModules(base::RepeatingClosure callback);
  void ExecuteUI(const base::Value& request, Reply reply);
  void ExecuteAgent(std::string token, base::Value request, Reply reply);
  void GrantLibrary(base::FilePath selected, Reply reply);
  void GrantSource(base::FilePath selected, Reply reply);
  void CreateTask(std::string space, std::vector<std::string> commands,
                  std::vector<std::string> libraries,
                  base::WeakPtr<BrowserWindowInterface> window, Reply reply,
                  std::string provider = "other", std::string reconnect_id = {},
                  bool remember = false);
  bool RevokeTask(const std::string& id);
  bool SetTaskPaused(const std::string& id, BrowserWindowInterface* window,
                     bool paused);
  bool RevealTaskPage(const std::string& id, BrowserWindowInterface* window);
  static void OnUserPageInput(content::WebContents* contents);
  static void OnPageChanged(content::WebContents* contents, std::string_view event);
  void ReleaseSurface(const std::string& handle);
  std::optional<std::string> SurfaceHtml(std::string_view path) const;
 private:
  explicit NativeHost(Profile* profile);
  struct Library;
  struct ClientPresence { std::string name, version; base::TimeTicks seen; };
  struct Task {
    std::string id, token, space, provider, window_key;
    bool reconnected = false, ever_connected = false;
    std::map<std::string, ClientPresence> clients;
    std::set<std::string> commands, libraries;
    base::WeakPtr<BrowserWindowInterface> window;
    bool used = false;
    std::string pause_reason;
    std::string attention_page;
    int sequence = 0;
    int control_epoch = 0;
    std::deque<base::DictValue> events;
  };
  struct Surface {
    std::string id, nonce, component, space, script, markup, style;
    base::DictValue manifest, input;
    base::DictValue base_data, preview_data;
    bool applied = false;
    std::string task_id, registry_version;
    bool registry_enabled = false;
  };
  void Dispatch(const base::Value& request, Task* task, Reply reply);
  void Record(Task& task, std::string_view event, std::string_view request = {},
              std::string_view page = {});
  base::DictValue TaskStatus(const Task& task, int after) const;
  bool IsTaskPaused(const Task& task) const;
  void Pause(Task& task, std::string_view reason, std::string_view page = {});
  void Resume(Task& task);
  struct PageWrite {
    uint64_t generation;
    content::WeakDocumentPtr document;
  };
  void Page(const std::string& id, const std::string& command,
            const base::DictValue& scope, const base::DictValue& payload,
            Task* task, Reply reply);
  void LibraryCommand(const std::string& id, const std::string& command,
                      const base::DictValue& payload, const Task* task, Reply reply);
  void SurfaceCommand(const std::string& id, const std::string& command,
                      const std::string& space, const base::DictValue& payload, Reply reply);
  void LoadConnections();
  void RestoreConnections();
  void StartServer(base::OnceClosure ready);
  std::string RememberWindow(BrowserWindowInterface& window);
  base::DictValue TaskConfig(const Task& task) const;
  void PersistPause(const Task& task);
  void LoadStorage();
  void LoadLibraries();
  base::ListValue DescribeLibraries() const;
  void RevokeLibrary(std::string request, std::string library, Reply reply);
  void WriteStorage(std::string id, std::string handle, std::string key, base::Value value, Reply reply);
  void NextStorageWrite();
  const base::DictValue* SurfaceData(const Surface& surface) const;
  void ApplySurface(std::string id, std::string handle, Reply reply);
  void ChangeModule(std::string id, std::string space, base::DictValue payload, bool disable, Reply reply);
  raw_ptr<Profile> profile_;
  raw_ptr<WorkspaceState> workspace_;
  scoped_refptr<base::SequencedTaskRunner> io_;
  std::map<std::string, std::shared_ptr<Library>> libraries_;
  base::DictValue library_records_;
  bool libraries_ready_ = false, libraries_read_only_ = false, library_pending_ = false;
  std::map<std::string, base::DictValue> sources_;
  std::map<std::string, Task> tasks_;
  std::map<std::string, PageWrite> page_writes_;
  std::set<std::string> page_screenshots_;
  uint64_t next_page_write_ = 0;
  base::DictValue saved_connections_;
  std::map<std::string, base::WeakPtr<BrowserWindowInterface>> remembered_windows_;
  base::CallbackListSubscription workspace_subscription_;
  std::set<std::string> reconnecting_;
  bool connections_loading_ = false;
  bool connections_ready_ = false;
  std::map<std::string, Surface> surfaces_;
  base::DictValue storage_;
  bool storage_busy_ = false;
  std::deque<base::OnceClosure> storage_queue_;
  bool storage_ready_ = false, storage_read_only_ = false;
  std::unique_ptr<LocalHostServer> server_;
  std::string endpoint_;
  bool server_starting_ = false, server_failed_ = false;
  size_t pending_task_writes_ = 0;
  base::RepeatingClosureList module_changes_;
  std::vector<base::OnceClosure> server_waiters_;
  base::WeakPtrFactory<NativeHost> weak_{this};
};
base::DictValue HostFailure(const std::string& id, const char* code);
base::DictValue HostSuccess(const std::string& id, base::Value value);
}  // namespace sidebar
#endif
