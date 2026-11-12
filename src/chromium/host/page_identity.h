// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_PAGE_IDENTITY_H_
#define SIDEBAR_BROWSER_HOST_PAGE_IDENTITY_H_
#include <string>
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
namespace sidebar {
// Runtime identity: follows the real WebContents; revisions follow documents.
class PageIdentity : public content::WebContentsObserver,
                     public content::WebContentsUserData<PageIdentity> {
 public:
  ~PageIdentity() override;
  const std::string& id() const { return id_; }
  int revision() const { return revision_; }
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void DidStopLoading() override;
  void DidGetUserInteraction(const blink::WebInputEvent& event) override;
 private:
  friend class content::WebContentsUserData<PageIdentity>;
  explicit PageIdentity(content::WebContents* contents);
  std::string id_;
  int revision_ = 1;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};
}
#endif
