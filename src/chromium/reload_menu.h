// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_RELOAD_MENU_H_
#define SIDEBAR_BROWSER_RELOAD_MENU_H_

#include "base/values.h"

class BrowserWindowInterface;
class Profile;
namespace content { class WebContents; }
namespace ui { class SimpleMenuModel; }
namespace views { class View; }

namespace sidebar {
// Local menu identifier, never registered as an Agent or browser command.
inline constexpr int kReloadClearingSiteCookies = 0x544152;
bool HasProductReloadMenu();
void AddCookieReloadMenuItem(ui::SimpleMenuModel*, Profile* profile = nullptr);
BrowserWindowInterface* ReloadBrowserForView(const views::View*);
bool CanReloadClearingSiteCookies(BrowserWindowInterface*);
bool HandleCookieReloadCommand(BrowserWindowInterface*, int command);
// Called only by the existing opt-in, disposable-Profile integration probe.
void RunCookieReloadSmokeChecks(BrowserWindowInterface*, content::WebContents*, base::ListValue&);
}  // namespace sidebar
#endif
