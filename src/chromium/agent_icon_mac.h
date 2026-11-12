// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_AGENT_ICON_MAC_H_
#define SIDEBAR_BROWSER_AGENT_ICON_MAC_H_

#include <string>
#include <string_view>

#include "ui/base/models/image_model.h"

namespace sidebar {
ui::ImageModel MacAgentIcon(std::string_view provider);
std::string MacAgentIconPng(std::string_view provider);
}  // namespace sidebar

#endif  // SIDEBAR_BROWSER_AGENT_ICON_MAC_H_
