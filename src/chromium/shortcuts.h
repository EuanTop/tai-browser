// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_SHORTCUTS_H_
#define SIDEBAR_BROWSER_SHORTCUTS_H_

#include <optional>
#include <string>
#include <string_view>

#include "base/values.h"
#include "ui/base/accelerators/accelerator.h"

class BrowserWindowInterface;
namespace content { class WebContents; }

namespace sidebar {
class WorkspaceState;
enum class ShortcutPhase { kBeforeResponder, kAfterResponder };
enum class ShortcutResult { kUnmatched, kDeferred, kHandled };

// Uses Chromium's accelerator parser and key definitions. Extra named keys
// only cover punctuation/function keys unsupported by the extension parser.
std::optional<ui::Accelerator> ParseShortcut(std::string_view binding);
std::optional<std::string> ValidateShortcutOverrides(
    const base::DictValue& overrides);
std::string ShortcutBinding(const WorkspaceState& state, std::string_view action);
base::ListValue DescribeShortcuts(const WorkspaceState& state);

// Called by the existing native key dispatcher, never an event monitor.
// kDeferred must bypass Chromium's pre-responder command lookup so that the
// webpage/native textfield can handle the key before the fallback phase.
// A system-level action also precedes local high-priority extension commands.
bool IsGlobalSearchKey(BrowserWindowInterface*, const ui::Accelerator&);
ShortcutResult RouteShortcut(BrowserWindowInterface* browser,
                             const ui::Accelerator& accelerator,
                             ShortcutPhase phase);

// Capture is confined to this settings document, expires after 30 seconds,
// and is never persisted. It cannot disable shortcuts in another tab/window.
bool SetShortcutCapture(content::WebContents* contents, bool capturing);

// Returns true for a managed Chromium command, even if unassigned. In that
// case |accelerator| is the default (unknown) Accelerator.
bool GetManagedShortcutForCommand(BrowserWindowInterface* browser,
                                 int command,
                                 ui::Accelerator* accelerator);
void RunShortcutValidationChecks(base::ListValue& checks);
}  // namespace sidebar
#endif
