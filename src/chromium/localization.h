// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_LOCALIZATION_H_
#define SIDEBAR_BROWSER_LOCALIZATION_H_
#include <string>
#include <string_view>
class Profile;
namespace sidebar {
// Own browser chrome follows the actual Profile's preference. Website content
// and upstream Chromium locale resources are never rewritten.
std::string LocalizedText(Profile*, std::string_view chinese, std::string_view english);
std::u16string LocalizedText16(Profile*, std::string_view chinese, std::string_view english);
}
#endif
