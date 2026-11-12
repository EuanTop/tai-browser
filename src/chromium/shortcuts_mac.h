// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_SHORTCUTS_MAC_H_
#define SIDEBAR_BROWSER_SHORTCUTS_MAC_H_

#include <string>

#include "ui/events/keycodes/keyboard_codes.h"

class BrowserWindowInterface;
#ifdef __OBJC__
@class NSMenuItem;
@class NSString;
#endif
namespace sidebar {
bool ShortcutModifierIsDown(int modifier);
// Same unmodified-layout mapping used by Chromium's system hotkey listener.
ui::KeyboardCode GlobalSearchKeyCode(unsigned short native_code);
// Keep the native menu and its shortcuts in sync with the active browser.
#ifdef __OBJC__
NSMenuItem* BuildTaiSpacesMenu();
void RegisterTaiMenuLabel(NSMenuItem* item, int resource_id,
                          const std::u16string& format_argument);
NSString* TaiDynamicMenuLabel(NSMenuItem* item, int resource_id);
#endif
void UpdateShortcutMenu(BrowserWindowInterface* browser);
}  // namespace sidebar
#endif
