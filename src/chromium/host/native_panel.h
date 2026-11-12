// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_NATIVE_PANEL_H_
#define SIDEBAR_BROWSER_HOST_NATIVE_PANEL_H_
#include <memory>
#include "base/values.h"
#include "ui/actions/action_id.h"
class BrowserWindowInterface;
class BrowserView;
namespace content { class WebContents; }
namespace views { class View; class Background; }
namespace sidebar {
actions::ActionId TaiPanelActionId();
void RefreshTaiPanelLabels(BrowserWindowInterface* browser);
bool SetTaiPanelVisible(BrowserWindowInterface* browser, bool visible);
bool ToggleTaiPanel(BrowserWindowInterface* browser);
bool IsTaiPanelContents(content::WebContents* contents);
base::DictValue DescribeTaiPanel(BrowserWindowInterface* browser,
                                  content::WebContents* caller);
std::unique_ptr<views::Background> CreateUnifiedPanelBackground(BrowserView& browser);
}
#endif
