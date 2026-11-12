// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_GLOBAL_SEARCH_MAC_H_
#define SIDEBAR_BROWSER_GLOBAL_SEARCH_MAC_H_

#include <string_view>

class BrowserWindowInterface;
namespace sidebar {
// Registers one owned system shortcut. Called for the last-active product
// window; an empty binding unregisters it. No background helper is installed.
bool UpdateGlobalSearch(BrowserWindowInterface* browser,
                        std::string_view binding = "Alt+Command+N");
bool GlobalSearchRegistered();
// Creates the native view without displaying it or registering a hotkey.
bool CheckGlobalSearchInitialization();
// Stable codes: registered, unassigned, conflict, unsupported, invalid.
std::string_view GlobalSearchStatus();
void ForgetGlobalSearchWindow(BrowserWindowInterface* browser);
void ShowGlobalSearch(BrowserWindowInterface* browser = nullptr);
// Only TAi's registration is suspended, never another extension's shortcuts.
// Recording automatically expires after 30 seconds if no stop arrives.
void SetGlobalSearchCapture(bool capturing);
}  // namespace sidebar
#endif
