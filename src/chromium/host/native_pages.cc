// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/native_host.h"
#include <algorithm>
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/uuid.h"
#include "base/i18n/time_formatting.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "sidebar_browser/agent_activity.h"
#include "sidebar_browser/sidebar_session.h"
#include "sidebar_browser/workspace_state.h"
#include "sidebar_browser/host/page_identity.h"
#include "sidebar_browser/host/page_interaction_resources.h"
#include "sidebar_browser/host/page_screenshot.h"
#include "sidebar_browser/host/validation.h"
#include "url/gurl.h"
namespace sidebar {
namespace {
struct PageTarget { raw_ptr<content::WebContents> contents; raw_ptr<PageIdentity> identity; };
std::vector<PageTarget> Pages(Profile* profile, const std::string& space, bool shared_favorites = false,
    BrowserWindowInterface* window = nullptr) {
  std::vector<PageTarget> result;
  for (auto* browser : GetAllBrowserWindowInterfaces()) {
    if (browser->GetProfile() != profile || (window && browser != window)) continue;
    auto* tabs = browser->GetTabStripModel();
    if (!tabs) continue;
    for (int i = 0; i < tabs->count(); ++i) {
      auto* contents = tabs->GetWebContentsAt(i);
      auto binding = ReadOrganization(contents);
      const auto* saved = binding ? WorkspaceState::ForProfile(profile)->model().FindItem(binding->item_id) : nullptr;
      const bool favorite = shared_favorites && saved && saved->kind == SavedKind::kFavorite;
      if (!binding || binding->placeholder || (binding->space_id != space && !favorite) ||
          !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) continue;
      PageIdentity::CreateForWebContents(contents);
      result.push_back({contents, PageIdentity::FromWebContents(contents)});
    }
  }
  return result;
}
base::DictValue DescribePage(const PageTarget& page) {
  base::DictValue item; item.Set("pageId", page.identity->id()); item.Set("pageRevision", page.identity->revision());
  item.Set("url", page.contents->GetLastCommittedURL().spec()); item.Set("title", base::UTF16ToUTF8(page.contents->GetTitle()));
  item.Set("loading", page.contents->IsLoading());
  return item;
}
}
bool NativeHost::RevealTaskPage(const std::string& id, BrowserWindowInterface* window) {
  if (!window || window->GetProfile() != profile_) return false;
  auto* tabs = window->GetTabStripModel();
  if (!tabs) return false;
  for (const auto& [token, task] : tasks_) {
    if (task.id != id || task.window.get() != window || task.attention_page.empty())
      continue;
    for (const auto& page : Pages(profile_, task.space, false, window)) {
      if (page.identity->id() != task.attention_page) continue;
      const int index = tabs->GetIndexOfWebContents(page.contents);
      if (index == TabStripModel::kNoTab) return false;
      tabs->ActivateTabAt(index);
      return true;
    }
  }
  return false;
}

void NativeHost::Page(const std::string& id, const std::string& command,
    const base::DictValue& scope, const base::DictValue& payload, Task* task, Reply reply) {
  const std::string space = *scope.FindString("spaceId");
  const auto* target_space = workspace_->model().FindSpace(space);
  auto fail = [&](const char* code) { std::move(reply).Run(HostFailure(id, code)); };
  auto* bound_window = task ? task->window.get() : nullptr;
  if (task && (!bound_window || bound_window->GetProfile() != profile_)) {
    fail("WINDOW_CLOSED");
    return;
  }
  if (task && !task->pause_reason.empty() &&
      task->pause_reason != "USER_EDITING" &&
      (command == "page.act" || command == "page.open")) {
    fail("TASK_PAUSED");
    return;
  }
  if (command == "page.list") {
    if (!payload.empty()) { fail("INVALID_ARGUMENTS"); return; }
    base::ListValue list; for (const auto& page : Pages(profile_, space, !task, bound_window)) list.Append(DescribePage(page));
    std::move(reply).Run(HostSuccess(id, base::Value(std::move(list)))); return;
  }
  if (command == "page.open") {
    const auto* url = payload.FindString("url");
    GURL target(url ? *url : "");
    if (!HostOnly(payload, {"url"}) || !target.is_valid() || !target.SchemeIsHTTPOrHTTPS() || target.has_username() || target.has_password() || target.spec().size() > 8192) {
      fail("INVALID_URL"); return;
    }
    BrowserWindowInterface* window = task && task->window ? task->window.get() : nullptr;
    if (!task) for (auto* candidate : GetAllBrowserWindowInterfaces()) {
      if (candidate->GetProfile() == profile_ && (!window || candidate->GetSessionID().id() < window->GetSessionID().id())) window = candidate;
    }
    auto* tabs = window ? window->GetTabStripModel() : nullptr;
    if (!tabs || window->GetProfile() != profile_) { fail("WINDOW_CLOSED"); return; }
    content::WebContents::CreateParams create_params(profile_);
    create_params.initially_hidden = tabs->GetActiveWebContents() != nullptr;
    auto contents = content::WebContents::Create(create_params);
    auto* raw = contents.get();
    WriteOrganization(raw, {space, {}, false});
    PageIdentity::CreateForWebContents(raw);
    // Give background pages the same initial viewport as ordinary browser tabs.
    tabs->AddWebContents(std::move(contents), tabs->count(),
                         ui::PAGE_TRANSITION_LINK, ADD_FORCE_INDEX);
    auto activity = task && target_space
        ? ShowAgentPageActivity(*window, task->provider, space,
                                target_space->name, PageIdentity::FromWebContents(raw)->id(),
                                base::UTF8ToUTF16(target.host()),
                                AgentPageActivity::kOpen)
        : base::ScopedClosureRunner();
    raw->GetController().LoadURL(target, content::Referrer(), ui::PAGE_TRANSITION_LINK, std::string());
    auto opened = DescribePage({raw, PageIdentity::FromWebContents(raw)});
    opened.Set("url", target.spec()); opened.Set("pending", true);
    if (task) Record(*task, "opened", id, *opened.FindString("pageId"));
    std::move(reply).Run(HostSuccess(id, base::Value(std::move(opened)))); return;
  }
  if (command != "page.read" && command != "page.act" &&
      command != "page.screenshot") {
    fail("COMMAND_UNAVAILABLE");
    return;
  }
  const auto* page_id = scope.FindString("pageId"); const auto revision = scope.FindInt("pageRevision");
  PageTarget found{nullptr, nullptr};
  for (const auto& candidate : Pages(profile_, space, !task, bound_window)) if (page_id && candidate.identity->id() == *page_id) found = candidate;
  if (!found.contents) { fail("PAGE_NOT_OWNED"); return; }
  if (!revision || *revision != found.identity->revision() || found.contents->IsLoading()) { fail("STALE_PAGE"); return; }
  auto* frame = found.contents->GetPrimaryMainFrame();
  if (!frame || !frame->IsRenderFrameLive()) { fail("PAGE_UNAVAILABLE"); return; }
  if (command == "page.screenshot") {
    if (!task || !target_space) {
      fail("CAPABILITY_DENIED");
      return;
    }
    const auto* position = payload.FindString("position");
    if (!HostOnly(payload, {"position"}) ||
        (payload.contains("position") && !position) ||
        (position && *position != "viewport" && *position != "bottom")) {
      fail("INVALID_ARGUMENTS");
      return;
    }
    const std::string target_id = found.identity->id();
    if (page_screenshots_.size() >= 4 || !page_screenshots_.insert(target_id).second) {
      fail("PAGE_BUSY");
      return;
    }
    const auto target = base::BindRepeating(
        [](base::WeakPtr<NativeHost> self, const std::string& token,
           const std::string& space, const std::string& target_id, int revision,
           const content::WeakDocumentPtr& document) {
          auto* frame = document.AsRenderFrameHostIfValid();
          if (!self || !frame || !frame->IsActive()) return false;
          const auto task = self->tasks_.find(token);
          if (task == self->tasks_.end() || !task->second.window ||
              !task->second.commands.contains("page.screenshot")) return false;
          auto* tabs = task->second.window->GetTabStripModel();
          auto* contents = content::WebContents::FromRenderFrameHost(frame);
          if (!tabs || !contents ||
              tabs->GetIndexOfWebContents(contents) == TabStripModel::kNoTab ||
              !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS()) return false;
          const auto binding = ReadOrganization(contents);
          const auto* page = PageIdentity::FromWebContents(contents);
          return binding && !binding->placeholder && binding->space_id == space &&
                 page && page->id() == target_id && page->revision() == revision;
        }, weak_.GetWeakPtr(), task->token, space, target_id, *revision,
        frame->GetWeakDocumentPtr());
    auto title = found.contents->GetTitle();
    if (title.empty()) {
      title = base::UTF8ToUTF16(found.contents->GetLastCommittedURL().host());
    }
    auto activity = ShowAgentPageActivity(
        *bound_window, task->provider, space, target_space->name, target_id,
        title, AgentPageActivity::kScreenshot);
    const bool bottom = position && *position == "bottom";
    CapturePageScreenshot(
        *found.contents, bottom, target,
        base::BindOnce([](base::WeakPtr<NativeHost> self, std::string id,
                          std::string page_id, bool bottom,
                          base::RepeatingCallback<bool()> target,
                          base::ScopedClosureRunner activity, Reply reply,
                          std::optional<std::string> data) {
          activity.RunAndReset();
          if (!self) return;
          self->page_screenshots_.erase(page_id);
          if (!target.Run()) {
            std::move(reply).Run(HostFailure(id, "OPERATION_OBSOLETE"));
            return;
          }
          if (!data) {
            std::move(reply).Run(HostFailure(id, "SCREENSHOT_UNAVAILABLE"));
            return;
          }
          base::DictValue result;
          result.Set("image", std::move(*data));
          result.Set("mimeType", "image/png");
          result.Set("position", bottom ? "bottom" : "viewport");
          std::move(reply).Run(HostSuccess(id, base::Value(std::move(result))));
        }, weak_.GetWeakPtr(), id, target_id, bottom, target,
        std::move(activity), std::move(reply)));
    return;
  }
  const bool write = command == "page.act";
  const std::string owner = task ?
      "task:" + task->id + ":" + std::to_string(task->control_epoch) : "ui";
  if (write && task) {
    if (task->pause_reason == "USER_EDITING" &&
        task->attention_page == found.identity->id()) {
      fail("PAGE_IN_USE");
      return;
    }
    const auto* dialogs = web_modal::WebContentsModalDialogManager::FromWebContents(found.contents);
    if (dialogs && dialogs->IsDialogActive()) {
      Pause(*task, "HUMAN_REQUIRED", found.identity->id());
      fail("HUMAN_REQUIRED");
      return;
    }
  }
  std::u16string script;
  if (command == "page.read") {
    const auto* format = payload.FindString("format");
    if (!HostOnly(payload, {"format"}) || (payload.contains("format") && !format) || (format && *format != "text" && *format != "snapshot" && *format != "interactive")) { fail("INVALID_ARGUMENTS"); return; }
    const bool snapshot = format && *format == "snapshot";
    script = u"(()=>{const value={url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,100000)};";
    if (snapshot) script += u"const clean=node=>{for(const input of node.querySelectorAll('input,textarea,select,script,noscript'))input.remove();return node;};const copy=document.documentElement?.cloneNode(true);if(copy)value.html=clean(copy).outerHTML.slice(0,1000000);const selection=getSelection();if(selection&&!selection.isCollapsed&&selection.rangeCount){const holder=document.createElement('div');for(let i=0;i<selection.rangeCount;i++)holder.append(selection.getRangeAt(i).cloneContents());value.selectionHtml=clean(holder).innerHTML.slice(0,1000000);}";
    script += u"return value;})()";
    if (format && *format == "interactive") {
      base::DictValue args;
      args.Set("mode", "read");
      args.Set("owner", owner);
      args.Set("snapshotId", base::Uuid::GenerateRandomV4().AsLowercaseString());
      script = base::UTF8ToUTF16(std::string(kPageInteraction) + "(" + *base::WriteJson(args) + ")");
    }
  } else {
    const auto* action = payload.FindString("action"); const auto* selector = payload.FindString("selector");
    const auto* value = payload.FindString("value");
    const auto* ref = payload.FindString("ref");
    const auto* snapshot_id = payload.FindString("snapshotId");
    const bool by_ref = ref && !ref->empty() && ref->size() <= 16 && snapshot_id &&
        !snapshot_id->empty() && snapshot_id->size() <= 100 && !payload.contains("selector");
    const bool by_selector = selector && !selector->empty() && selector->size() <= 1000 &&
        !payload.contains("ref") && !payload.contains("snapshotId");
    if (!HostOnly(payload, {"action","selector","value","ref","snapshotId"}) || !action || (*action != "click" && *action != "fill") ||
        (!by_ref && !by_selector) || (*action == "click" && payload.contains("value")) ||
        (*action == "fill" && (!value || value->size() > 16000))) { fail("INVALID_ARGUMENTS"); return; }
    auto args = payload.Clone();
    args.Set("mode", "act");
    args.Set("owner", owner);
    script = base::UTF8ToUTF16(std::string(kPageInteraction) + "(" + *base::WriteJson(args) + ")");
  }
  const auto document = frame->GetWeakDocumentPtr();
  const std::string token = task ? task->token : std::string();
  const std::string target_id = found.identity->id(); const int target_revision = *revision;
  uint64_t write_generation = 0;
  if (write) {
    std::erase_if(page_writes_, [](const auto& entry) {
      auto* frame = entry.second.document.AsRenderFrameHostIfValid();
      return !frame || !frame->IsActive() || !frame->IsRenderFrameLive();
    });
    if (page_writes_.contains(target_id) || page_writes_.size() >= 32) {
      fail("PAGE_BUSY");
      return;
    }
    write_generation = ++next_page_write_;
    page_writes_.emplace(target_id, PageWrite{write_generation, document});
    if (task) Record(*task, "action_started", id, target_id);
  }
  base::ScopedClosureRunner activity;
  if (task && target_space) {
    auto title = found.contents->GetTitle();
    if (title.empty()) {
      title = base::UTF8ToUTF16(found.contents->GetLastCommittedURL().host());
    }
    activity = ShowAgentPageActivity(*bound_window, task->provider,
        space, target_space->name, found.identity->id(), title,
        write ? AgentPageActivity::kAct : AgentPageActivity::kRead);
  }
  frame->ExecuteJavaScriptInIsolatedWorld(script,
      base::BindOnce([](base::WeakPtr<NativeHost> self, std::string id, std::string token,
          std::string space, std::string page_id, int revision, content::WeakDocumentPtr document,
          uint64_t write_generation, base::ScopedClosureRunner activity,
          Reply reply, base::Value value) {
        activity.RunAndReset();
        if (!self) return;
        const bool write = write_generation != 0;
        if (write) {
          const auto held = self->page_writes_.find(page_id);
          if (held != self->page_writes_.end() &&
              held->second.generation == write_generation)
            self->page_writes_.erase(held);
        }
        const bool lease = token.empty() || self->tasks_.contains(token);
        auto* window = !token.empty() && lease ? self->tasks_.at(token).window.get() : nullptr;
        bool current = false;
        if (lease && (token.empty() || window))
          for (const auto& candidate : Pages(self->profile_, space, token.empty(), window)) if (candidate.identity->id() == page_id && candidate.identity->revision() == revision) current = true;
        auto* task = !token.empty() && lease ? &self->tasks_.at(token) : nullptr;
        if (!lease || !current || !document.AsRenderFrameHostIfValid() || !self->workspace_->model().FindSpace(space)) {
          if (write && task) self->Record(*task, "outcome_unknown", id, page_id);
          std::move(reply).Run(HostFailure(id, "OPERATION_OBSOLETE")); return;
        }
        if (!value.is_dict()) {
          if (write && task) self->Record(*task, "outcome_unknown", id, page_id);
          std::move(reply).Run(HostFailure(id, write ? "OUTCOME_UNKNOWN" : "PAGE_UNAVAILABLE"));
          return;
        }
        if (write && task) {
          const auto* reason = value.GetDict().FindString("reason");
          const bool performed = value.GetDict().FindBool("performed").value_or(false);
          self->Record(*task, performed ? "action_dispatched" : "action_declined", id, page_id);
          if (reason && *reason == "HUMAN_REQUIRED")
            self->Pause(*task, *reason, page_id);
        }
        base::DictValue verified; verified.Set("profileId", self->workspace_->profile_id()); verified.Set("spaceId", space);
        if (!token.empty()) verified.Set("taskId", self->tasks_.at(token).id);
        verified.Set("pageId", page_id); verified.Set("pageRevision", revision);
        value.GetDict().Set("scope", std::move(verified));
        value.GetDict().Set("capturedAt", base::TimeFormatAsIso8601(base::Time::Now()));
        std::move(reply).Run(HostSuccess(id, std::move(value)));
      }, weak_.GetWeakPtr(), id, token, space, target_id, target_revision, document, write_generation,
         std::move(activity), std::move(reply)),
      ISOLATED_WORLD_ID_CHROME_INTERNAL);
}
}
