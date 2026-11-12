// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_PAGE_SCREENSHOT_H_
#define SIDEBAR_BROWSER_HOST_PAGE_SCREENSHOT_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"

namespace content {
class WebContents;
}

namespace sidebar {
// Captures one bounded document viewport using Chromium's page renderer.
void CapturePageScreenshot(
    content::WebContents& contents,
    bool bottom,
    base::RepeatingCallback<bool()> can_capture,
    base::OnceCallback<void(std::optional<std::string>)> reply);
}  // namespace sidebar
#endif
