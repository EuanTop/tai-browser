// Copyright 2026 Sidebar Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/sidebar_session.h"
#include "base/command_line.h"
#include "content/public/browser/web_contents_user_data.h"

namespace sidebar {
class SidebarTabData : public content::WebContentsUserData<SidebarTabData> {
 public:
  TabOrganization value;
 private:
  explicit SidebarTabData(content::WebContents* contents)
      : content::WebContentsUserData<SidebarTabData>(*contents) {}
  friend content::WebContentsUserData<SidebarTabData>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};
WEB_CONTENTS_USER_DATA_KEY_IMPL(SidebarTabData);

std::optional<TabOrganization> ReadOrganization(content::WebContents* contents) {
  if (const auto* data = SidebarTabData::FromWebContents(contents)) return data->value;
  return std::nullopt;
}
void WriteOrganization(content::WebContents* contents, const TabOrganization& value) {
  SidebarTabData::CreateForWebContents(contents);
  SidebarTabData::FromWebContents(contents)->value = value;
}
void AppendOrganization(content::WebContents* contents,
                         std::map<std::string, std::string>* extra_data) {
  if (auto value = ReadOrganization(contents)) {
    (*extra_data)[kSpaceSessionKey] = value->space_id;
    (*extra_data)[kItemSessionKey] = value->item_id;
    (*extra_data)[kPlaceholderSessionKey] = value->placeholder ? "1" : "0";
  }
}
void RestoreOrganization(content::WebContents* contents,
                          const std::map<std::string, std::string>& extra_data) {
  if (!base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) return;
  const auto space = extra_data.find(kSpaceSessionKey);
  if (space == extra_data.end()) return;
  const auto item = extra_data.find(kItemSessionKey);
  const auto blank = extra_data.find(kPlaceholderSessionKey);
  WriteOrganization(contents, {space->second,
      item == extra_data.end() ? std::string() : item->second,
      blank != extra_data.end() && blank->second == "1"});
}
}  // namespace sidebar
