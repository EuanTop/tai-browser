// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_AGENT_ACTIVITY_H_
#define SIDEBAR_BROWSER_AGENT_ACTIVITY_H_

#include <string_view>

#include "base/functional/callback_helpers.h"

class BrowserWindowInterface;
namespace views {
class View;
}

namespace sidebar {
enum class AgentPageActivity { kOpen, kRead, kAct, kScreenshot };

void AddAgentActivityChip(views::View& toolbar);
base::ScopedClosureRunner ShowAgentPageActivity(
    BrowserWindowInterface& window,
    std::string_view provider,
    std::string_view space_id,
    std::string_view space_name,
    std::string_view page_id,
    std::u16string_view page_title,
    AgentPageActivity operation);
}  // namespace sidebar

#endif  // SIDEBAR_BROWSER_AGENT_ACTIVITY_H_
