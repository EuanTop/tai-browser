// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_SIDEBAR_SESSION_H_
#define SIDEBAR_BROWSER_SIDEBAR_SESSION_H_
#include <map>
#include <optional>
#include <string>
namespace content { class WebContents; }
namespace sidebar {
inline constexpr char kSpaceSessionKey[] = "sidebar.space";
inline constexpr char kItemSessionKey[] = "sidebar.item";
inline constexpr char kPlaceholderSessionKey[] = "sidebar.placeholder";
struct TabOrganization {
  std::string space_id;
  std::string item_id;
  bool placeholder = false;
  bool operator==(const TabOrganization&) const = default;
};
std::optional<TabOrganization> ReadOrganization(content::WebContents* contents);
void WriteOrganization(content::WebContents* contents, const TabOrganization& value);
void AppendOrganization(content::WebContents* contents,
                         std::map<std::string, std::string>* extra_data);
void RestoreOrganization(content::WebContents* contents,
                          const std::map<std::string, std::string>& extra_data);
}  // namespace sidebar
#endif
