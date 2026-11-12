// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/reload_menu.h"
#include "sidebar_browser/localization.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <utility>
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/run_loop.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/toolbar_button_provider.h"
#include "chrome/browser/ui/views/toolbar/reload_control.h"
#include "components/constrained_window/constrained_window_views.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/storage_partition.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "net/cookies/canonical_cookie.h"
#include "net/cookies/cookie_options.h"
#include "services/network/public/mojom/cookie_manager.mojom.h"
#include "ui/base/models/dialog_model.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/bubble/bubble_dialog_model_host.h"
#include "ui/views/widget/widget.h"

namespace sidebar {
namespace {
std::string CookieSite(const GURL& url) {
  if (!url.SchemeIsHTTPOrHTTPS() || !url.is_valid() || url.host().empty()) return {};
  auto site = net::registry_controlled_domains::GetDomainAndRegistry(
      url, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  return site.empty() ? std::string(url.host()) : site;
}

content::WebContents* ActiveContents(BrowserWindowInterface* browser) {
  if (!HasProductReloadMenu() || !browser) return nullptr;
  return browser->GetTabStripModel()->GetActiveWebContents();
}

// Capture the document and its real storage partition before showing a dialog.
// Never retarget an accepted action to whatever tab/Space is active later.
struct CookieReloadRequest {
  base::WeakPtr<content::WebContents> contents;
  content::WeakDocumentPtr document;
  std::string site;

  static std::optional<CookieReloadRequest> Capture(content::WebContents* contents) {
    if (!contents || contents->IsCrashed() || contents->IsBeingDestroyed()) return std::nullopt;
    auto site = CookieSite(contents->GetLastCommittedURL());
    if (site.empty()) return std::nullopt;
    return CookieReloadRequest{contents->GetWeakPtr(),
        contents->GetPrimaryMainFrame()->GetWeakDocumentPtr(), std::move(site)};
  }
  bool IsCurrent() const {
    return contents && !contents->IsBeingDestroyed() &&
        document.AsRenderFrameHostIfValid() == contents->GetPrimaryMainFrame() &&
        CookieSite(contents->GetLastCommittedURL()) == site;
  }
  void Run(base::OnceClosure finished = base::DoNothing()) const {
    if (!IsCurrent()) { std::move(finished).Run(); return; }
    auto filter = network::mojom::CookieDeletionFilter::New();
    // Always nonempty; an unfiltered request would erase the entire cookie jar.
    // Chromium applies eTLD+1 (including private registries), all paths and
    // HttpOnly/Secure cookies. Only this document's Profile/partition is used.
    filter->including_domains = std::vector<std::string>{site};
    contents->GetPrimaryMainFrame()->GetStoragePartition()
        ->GetCookieManagerForBrowserProcess()->DeleteCookies(std::move(filter),
            base::BindOnce([](CookieReloadRequest target, base::OnceClosure done, uint32_t) {
              if (target.IsCurrent()) target.contents->GetController().Reload(
                  content::ReloadType::NORMAL, true);
              std::move(done).Run();
            }, *this, std::move(finished)));
  }
};
}  // namespace

bool HasProductReloadMenu() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser");
}
void AddCookieReloadMenuItem(ui::SimpleMenuModel* menu, Profile* profile) {
  menu->AddSeparator(ui::NORMAL_SEPARATOR);
  menu->AddItem(kReloadClearingSiteCookies, LocalizedText16(profile, "清除此网站 Cookie 并刷新…", "Clear Site Cookies and Reload…"));
}
BrowserWindowInterface* ReloadBrowserForView(const views::View* view) {
  if (!view || !view->GetWidget()) return nullptr;
  auto* widget = view->GetWidget()->GetTopLevelWidget();
  auto* browser = widget ? BrowserView::GetBrowserViewForNativeWindow(widget->GetNativeWindow()) : nullptr;
  return browser ? browser->browser() : nullptr;
}
bool CanReloadClearingSiteCookies(BrowserWindowInterface* browser) {
  return CookieReloadRequest::Capture(ActiveContents(browser)).has_value();
}
bool HandleCookieReloadCommand(BrowserWindowInterface* browser, int command) {
  if (command != kReloadClearingSiteCookies) return false;
  auto* contents = ActiveContents(browser);
  auto target = CookieReloadRequest::Capture(contents);
  if (!target) return true;
  auto model = ui::DialogModel::Builder()
      .SetInternalName("TAiClearSiteCookies")
      .SetTitle(LocalizedText16(browser->GetProfile(), "清除此网站的 Cookie？", "Clear this site’s cookies?"))
      .AddParagraph(ui::DialogModelLabel(base::UTF8ToUTF16(target->site)))
      .AddParagraph(ui::DialogModelLabel(
          LocalizedText16(browser->GetProfile(), "此网站及其子域名可能需要重新登录。同一 Profile 下其他 Space 的此网站也会受影响。其他网站、历史记录和密码不会清除。", "You may need to sign in again on this site and its subdomains, including other Spaces in this Profile. Other sites, history and passwords are kept.")))
      .AddOkButton(base::BindOnce([](CookieReloadRequest target) { target.Run(); }, *target),
          ui::DialogModel::Button::Params().SetLabel(LocalizedText16(browser->GetProfile(), "清除并刷新", "Clear and Reload")))
      .AddCancelButton(base::DoNothing(), ui::DialogModel::Button::Params().SetLabel(LocalizedText16(browser->GetProfile(), "取消", "Cancel")))
      .OverrideDefaultButton(ui::mojom::DialogButton::kCancel)
      .Build();
  auto dialog = views::BubbleDialogModelHost::CreateModal(std::move(model), ui::mojom::ModalType::kChild);
  constrained_window::ShowWebModalDialogViews(dialog.release(), contents);
  return true;
}

void RunCookieReloadSmokeChecks(BrowserWindowInterface* browser, content::WebContents* contents, base::ListValue& checks) {
  const auto* command = base::CommandLine::ForCurrentProcess();
  const auto root = command->GetSwitchValuePath("user-data-dir");
  if (!command->HasSwitch("sidebar-browser-smoke-test") ||
      !root.BaseName().AsUTF8Unsafe().starts_with("native-smoke-") ||
      Profile::FromBrowserContext(contents->GetBrowserContext())->GetPath().DirName() != root) return;
  auto expect = [&checks](std::string name, bool passed) {
    base::DictValue value; value.Set("check", std::move(name)); value.Set("passed", passed);
    checks.Append(std::move(value));
  };
  auto wait = [](auto ready) {
    for (int i = 0; i < 200; ++i) {
      if (ready()) return true;
      base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
          FROM_HERE, loop.QuitClosure(), base::Milliseconds(20));
      loop.Run();
    }
    return ready();
  };
  expect("cookie refresh respects private registries and rejects internal pages",
      CookieSite(GURL("https://one.github.io/")) == "one.github.io" &&
      CookieSite(GURL("https://sub.example.co.uk/path")) == "example.co.uk" &&
      CookieSite(GURL("chrome://tai/")).empty() && !CookieReloadRequest::Capture(contents));
  const GURL url(command->GetSwitchValueASCII("sidebar-cookie-smoke-url"));
  if (!url.SchemeIs("http") || url.host() != "127.0.0.1") {
    expect("cookie refresh has a loopback-only fixture", false); return;
  }
  auto navigate = [&](const GURL& next) {
    contents->GetController().LoadURL(next, content::Referrer(), ui::PAGE_TRANSITION_TYPED, {});
    return wait([&] { return contents->GetLastCommittedURL() == next && !contents->IsLoading(); });
  };
  expect("cookie refresh fixture is a committed HTTP document", navigate(url));
  auto* control = ToolbarButtonProvider::From(browser)->GetReloadButton();
  expect("toolbar cookie refresh is enabled for the actual web tab", control->IsCommandIdEnabled(kReloadClearingSiteCookies));
  auto* manager = contents->GetPrimaryMainFrame()->GetStoragePartition()->GetCookieManagerForBrowserProcess();
  auto seed = [&](network::mojom::CookieManager* jar, const GURL& source, std::string line) {
    auto cookie = net::CanonicalCookie::Create(source, line, base::Time::Now(),
        std::nullopt, std::nullopt, net::CookieSourceType::kHTTP, nullptr);
    if (!cookie) return false;
    auto result = std::make_shared<std::pair<bool, bool>>(false, false);
    jar->SetCanonicalCookie(*cookie, source, net::CookieOptions::MakeAllInclusive(),
        base::BindOnce([](std::shared_ptr<std::pair<bool, bool>> result, net::CookieAccessResult access) {
          result->second = access.status.IsInclude(); result->first = true;
        }, result));
    return wait([&] { return result->first; }) && result->second;
  };
  auto count = [&](network::mojom::CookieManager* jar) {
    auto result = std::make_shared<std::optional<int>>();
    jar->GetAllCookies(base::BindOnce([](std::shared_ptr<std::optional<int>> result, const net::CookieList& cookies) {
      *result = static_cast<int>(std::ranges::count_if(cookies, [](const net::CanonicalCookie& cookie) {
        return cookie.Name().starts_with("tai_reload_");
      }));
    }, result));
    return wait([&] { return result->has_value(); }) ? **result : -1;
  };
  expect("cookie fixture includes all-path HttpOnly Secure and unrelated-site cookies",
      seed(manager, url, "tai_reload_root=fixture; Path=/; HttpOnly") &&
      seed(manager, url, "tai_reload_path=fixture; Path=/elsewhere") &&
      seed(manager, GURL("https://127.0.0.1/"), "tai_reload_secure=fixture; Path=/; Secure; HttpOnly") &&
      seed(manager, GURL("https://unrelated.test/"), "tai_reload_other=fixture; Path=/") && count(manager) == 4);
  auto* other_profile = Profile::FromBrowserContext(contents->GetBrowserContext())->GetPrimaryOTRProfile(true);
  auto* other_manager = other_profile->GetDefaultStoragePartition()->GetCookieManagerForBrowserProcess();
  expect("separate Profile cookie fixture is independent", seed(other_manager, url, "tai_reload_profile=fixture; Path=/") && count(other_manager) == 1);
  auto request = CookieReloadRequest::Capture(contents);
  expect("capturing a cookie refresh request does not delete cookies", request && count(manager) == 4);
  contents->GetController().Reload(content::ReloadType::NORMAL, true);
  expect("ordinary refresh retains cookies", wait([&] { return request && !request->IsCurrent() && !contents->IsLoading(); }) && count(manager) == 4);
  auto hard_target = CookieReloadRequest::Capture(contents);
  contents->GetController().Reload(content::ReloadType::BYPASSING_CACHE, true);
  wait([&] { return hard_target && !hard_target->IsCurrent() && !contents->IsLoading(); });
  expect("ignore-cache refresh retains cookies", count(manager) == 4);
  expect("a navigated document invalidates a pending cookie refresh", request && !request->IsCurrent());
  auto done = std::make_shared<bool>(false);
  if (request) request->Run(base::BindOnce([](std::shared_ptr<bool> done) { *done = true; }, done));
  expect("stale cookie refresh cannot clear the current or another page", wait([&] { return *done; }) && count(manager) == 4);
  request = CookieReloadRequest::Capture(contents); done = std::make_shared<bool>(false);
  if (request) request->Run(base::BindOnce([](std::shared_ptr<bool> done) { *done = true; }, done));
  expect("cookie refresh deletes only the requested site after completion", wait([&] { return *done; }) && count(manager) == 1);
  expect("cookie refresh preserves another Profile cookie", count(other_manager) == 1);
  expect("cookie refresh reloads its captured document", wait([&] { return request && !request->IsCurrent() && !contents->IsLoading(); }));
  expect("toolbar cookie refresh becomes disabled after internal navigation",
      navigate(GURL("chrome://version/")) && !control->IsCommandIdEnabled(kReloadClearingSiteCookies));
}
}  // namespace sidebar
