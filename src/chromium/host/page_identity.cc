// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/page_identity.h"
#include "base/uuid.h"
#include "content/public/browser/navigation_handle.h"
#include "sidebar_browser/host/native_host.h"
#include "third_party/blink/public/common/input/web_input_event.h"
namespace sidebar {
WEB_CONTENTS_USER_DATA_KEY_IMPL(PageIdentity);
PageIdentity::PageIdentity(content::WebContents* contents)
    : WebContentsObserver(contents), WebContentsUserData<PageIdentity>(*contents),
      id_(base::Uuid::GenerateRandomV4().AsLowercaseString()) {}
PageIdentity::~PageIdentity() = default;
void PageIdentity::DidFinishNavigation(content::NavigationHandle* handle) {
  if (!handle->HasCommitted() || !handle->IsInPrimaryMainFrame()) return;
  ++revision_;
  NativeHost::OnPageChanged(web_contents(), "page_committed");
}
void PageIdentity::DidStopLoading() {
  NativeHost::OnPageChanged(web_contents(), "page_loaded");
}
void PageIdentity::DidGetUserInteraction(const blink::WebInputEvent& event) {
  using Type = blink::WebInputEvent::Type;
  if (event.GetType() == Type::kMouseDown ||
      event.GetType() == Type::kRawKeyDown ||
      event.GetType() == Type::kTouchStart) {
    NativeHost::OnUserPageInput(web_contents());
  }
}
}
