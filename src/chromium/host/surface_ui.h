// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_SURFACE_UI_H_
#define SIDEBAR_BROWSER_HOST_SURFACE_UI_H_
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"
#include "ui/webui/untrusted_web_ui_controller.h"
namespace sidebar {
class SurfaceUI : public ui::UntrustedWebUIController {
 public:
  explicit SurfaceUI(content::WebUI* ui);
  ~SurfaceUI() override;
};
class SurfaceUIConfig : public content::DefaultWebUIConfig<SurfaceUI> {
 public:
  SurfaceUIConfig() : DefaultWebUIConfig(content::kChromeUIUntrustedScheme, "tai-content") {}
  bool IsWebUIEnabled(content::BrowserContext* context) override;
};
}
#endif
