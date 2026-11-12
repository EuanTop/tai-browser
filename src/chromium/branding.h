// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_BRANDING_H_
#define SIDEBAR_BROWSER_BRANDING_H_
#include <string>
#include "base/base64.h"
#include "base/check.h"
#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/no_destructor.h"
#include "chrome/app/chrome_command_ids.h"
#include "sidebar_browser/brand_resources.h"
#include "skia/ext/image_operations.h"
#include "ui/base/models/image_model.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_operations.h"

namespace sidebar {
inline bool HasTaiBrand() {
  return base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser");
}
inline const std::string& ProductIconBytes() {
  static const base::NoDestructor<std::string> bytes([] {
    std::string result;
    CHECK(base::Base64Decode(brand_resources::kProductIcon, &result));
    return result;
  }());
  return *bytes;
}
inline ui::ImageModel ProductLocationIcon() {
  static const base::NoDestructor<gfx::ImageSkia> image([] {
    const auto original = gfx::Image::CreateFrom1xPNGBytes(
        base::as_byte_span(ProductIconBytes()));
    return gfx::ImageSkiaOperations::CreateResizedImage(original.AsImageSkia(),
        skia::ImageOperations::RESIZE_BEST, gfx::Size(16, 16));
  }());
  return ui::ImageModel::FromImageSkia(*image);
}
// Temporarily unavailable product entry points. Browsing contexts and stored
// credentials are retained; website authentication is not a browser account.
inline bool IsBrowserAccountCommand(int command) {
  return command == IDC_SHOW_AVATAR_MENU || command == IDC_SHOW_SIGNIN ||
      command == IDC_SHOW_SIGNIN_WHEN_PAUSED || command == IDC_ADD_NEW_PROFILE ||
      command == IDC_OPEN_GUEST_PROFILE || command == IDC_MANAGE_CHROME_PROFILES ||
      command == IDC_PROFILE_MENU_IN_APP_MENU;
}
}  // namespace sidebar
#endif
