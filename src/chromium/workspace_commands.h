// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_WORKSPACE_COMMANDS_H_
#define SIDEBAR_BROWSER_WORKSPACE_COMMANDS_H_
#include "base/values.h"
#include <string_view>
namespace sidebar {
class WorkspaceState;
bool IsSpaceEmoji(std::string_view icon);
// Caller supplies the state of its ACTUAL BrowserContext, never a caller ID.
base::DictValue DescribeWorkspace(const WorkspaceState& state);
base::DictValue ImportWelcomeSpaces(WorkspaceState& state,
                                    const base::Value& input);
base::DictValue ExecuteWorkspaceCommand(WorkspaceState& state,
                                       const base::Value& request);
}  // namespace sidebar
#endif
