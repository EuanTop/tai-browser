// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_INTERNAL_URLS_H_
#define SIDEBAR_BROWSER_INTERNAL_URLS_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include "base/strings/utf_string_conversions.h"
#include "url/gurl.h"

namespace sidebar {
// A UI input/display alias only. No scheme is registered with the network,
// renderer, WebUI factory, security policy, navigation entry or operating system.
inline std::optional<GURL> CanonicalTaiInput(const GURL& input) {
  if (!input.SchemeIs("tai")) return input;
  if (!input.is_valid()) return std::nullopt;
  const std::string tail = input.spec().substr(input.scheme().size() + 1);
  if (!tail.starts_with("//")) return std::nullopt;
  // Chromium's host-only internal URL parser can discard authority fields.
  // Reject them before canonicalizing rather than trusting the normalized URL.
  const auto authority = std::string_view(tail).substr(2, tail.find_first_of("/?#", 2) - 2);
  if (authority.empty()) return std::nullopt;
  for (const char ch : authority) {
    if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
          (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.'))
      return std::nullopt;
  }
  GURL canonical("chrome:" + tail);
  if (!canonical.is_valid() || canonical.host().empty() ||
      canonical.has_username() || canonical.has_password() || canonical.has_port())
    return std::nullopt;
  if (canonical.host() == "preferences") {
    GURL::Replacements replacement;
    replacement.SetHostStr("tai");
    canonical = canonical.ReplaceComponents(replacement);
  }
  return canonical;
}
inline std::u16string DisplayTaiURL(const GURL& actual,
                                  std::u16string formatted) {
  if (!actual.SchemeIs("chrome") || !formatted.starts_with(u"chrome://"))
    return formatted;
  if (actual.host() == "tai" && formatted.starts_with(u"chrome://tai"))
    formatted.replace(0, 12, u"tai://preferences");
  else
    formatted.replace(0, 9, u"tai://");
  return formatted;
}
}  // namespace sidebar
#endif
