// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/localization.h"
#include "sidebar_browser/workspace_state.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
namespace sidebar {
std::string LocalizedText(Profile* profile, std::string_view chinese, std::string_view english) {
  const std::string locale = profile ? WorkspaceState::ForProfile(profile)->language()
      : g_browser_process ? g_browser_process->GetApplicationLocale() : "en";
  return std::string(base::StartsWith(locale, "zh", base::CompareCase::INSENSITIVE_ASCII) ? chinese : english);
}
std::u16string LocalizedText16(Profile* profile, std::string_view chinese, std::string_view english) {
  return base::UTF8ToUTF16(LocalizedText(profile, chinese, english));
}
}
