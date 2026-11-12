// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_TAI_UI_H_
#define SIDEBAR_BROWSER_TAI_UI_H_
#include "content/public/browser/web_ui_controller.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"
class BrowserWindowInterface;
class Profile;
namespace sidebar {
bool DeferBrowserForWelcome(BrowserWindowInterface* browser);
bool OpenTaiImportDialog(Profile* profile);
bool OpenTaiHelpDialog(Profile* profile);
class TaiUI : public content::WebUIController {
 public:
  explicit TaiUI(content::WebUI* web_ui);
  ~TaiUI() override;
};
class TaiUIConfig : public content::DefaultWebUIConfig<TaiUI> {
 public:
  TaiUIConfig() : DefaultWebUIConfig(content::kChromeUIScheme, "tai") {}
  bool IsWebUIEnabled(content::BrowserContext* context) override;
};
}  // namespace sidebar
#endif
