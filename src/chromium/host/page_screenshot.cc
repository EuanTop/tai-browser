// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/page_screenshot.h"

#include <algorithm>
#include <cmath>
#include <utility>

#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/ref_counted.h"
#include "base/strings/string_view_util.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"

namespace sidebar {
namespace {

constexpr double kMaxWidth = 1600;
constexpr double kMaxHeight = 1200;
constexpr size_t kMaxImageData = 8 * 1024 * 1024;
constexpr auto kCaptureTimeout = base::Seconds(12);

class ScreenshotRequest final
    : public base::RefCounted<ScreenshotRequest>,
      public content::DevToolsAgentHostClient {
 public:
  ScreenshotRequest(bool bottom,
                    base::RepeatingCallback<bool()> can_capture,
                    base::OnceCallback<void(std::optional<std::string>)> reply)
      : bottom_(bottom),
        can_capture_(std::move(can_capture)),
        reply_(std::move(reply)) {}

  void Start(content::WebContents& contents) {
    const auto* view = contents.GetRenderWidgetHostView();
    if (!view || !can_capture_.Run()) {
      Finish(std::nullopt);
      return;
    }
    device_scale_ = std::max(1.f, view->GetDeviceScaleFactor());
    host_ = content::DevToolsAgentHost::GetOrCreateFor(&contents);
    if (!host_ || !host_->AttachClient(this)) {
      Finish(std::nullopt);
      return;
    }
    attached_ = true;
    timer_.Start(FROM_HERE, kCaptureTimeout,
                 base::BindOnce(&ScreenshotRequest::Finish,
                                base::WrapRefCounted(this), std::nullopt));
    Send(1, "Page.getLayoutMetrics", {});
  }

 private:
  friend class base::RefCounted<ScreenshotRequest>;
  ~ScreenshotRequest() override = default;

  bool MayAttachToURL(const GURL& url, bool is_webui) override {
    return !is_webui && url.SchemeIsHTTPOrHTTPS();
  }
  bool IsTrusted() override { return false; }
  bool MayReadLocalFiles() override { return false; }
  bool MayWriteLocalFiles() override { return false; }
  bool AllowUnsafeOperations() override { return false; }

  void Send(int id, const char* method, base::DictValue params) {
    base::DictValue request;
    request.Set("id", id);
    request.Set("method", method);
    request.Set("params", std::move(params));
    auto json = base::WriteJson(request);
    if (!json || !host_) {
      Finish(std::nullopt);
      return;
    }
    host_->DispatchProtocolMessage(this, base::as_byte_span(*json));
  }

  void DispatchProtocolMessage(content::DevToolsAgentHost*,
                               base::span<const uint8_t> message) override {
    auto keep_alive = base::WrapRefCounted(this);
    if (!reply_) return;
    if (message.size() > kMaxImageData + 4096) {
      Finish(std::nullopt);
      return;
    }
    auto response = base::JSONReader::ReadDict(
        base::as_string_view(message), base::JSON_PARSE_RFC);
    const auto id = response ? response->FindInt("id") : std::nullopt;
    if (id != 1 && id != 2) return;
    const auto* result = response->FindDict("result");
    if (!result || !can_capture_.Run()) {
      Finish(std::nullopt);
      return;
    }
    if (id == 1) {
      Capture(*result);
      return;
    }
    const auto* image = result->FindString("data");
    if (!image || image->empty() || image->size() > kMaxImageData) {
      Finish(std::nullopt);
      return;
    }
    Finish(*image);
  }

  void Capture(const base::DictValue& metrics) {
    const auto* viewport = metrics.FindDict("cssLayoutViewport");
    const auto* content = metrics.FindDict("cssContentSize");
    if (!viewport || !content) {
      Finish(std::nullopt);
      return;
    }
    const double content_x = content->FindDouble("x").value_or(0);
    const double content_y = content->FindDouble("y").value_or(0);
    const double content_width = content->FindDouble("width").value_or(0);
    const double content_height = content->FindDouble("height").value_or(0);
    const double width = std::min(viewport->FindDouble("clientWidth").value_or(0),
                                  content_width);
    const double height = std::min(viewport->FindDouble("clientHeight").value_or(0),
                                   content_height);
    if (!std::isfinite(width) || !std::isfinite(height) ||
        width < 1 || height < 1) {
      Finish(std::nullopt);
      return;
    }
    const double x = std::clamp(viewport->FindDouble("pageX").value_or(0),
                                content_x, content_x + content_width - width);
    const double y = bottom_
        ? content_y + content_height - height
        : std::clamp(viewport->FindDouble("pageY").value_or(0),
                     content_y, content_y + content_height - height);
    const double scale = std::min(
        {1.0, kMaxWidth / (width * device_scale_),
         kMaxHeight / (height * device_scale_)});

    base::DictValue clip;
    clip.Set("x", x);
    clip.Set("y", y);
    clip.Set("width", width);
    clip.Set("height", height);
    clip.Set("scale", scale);
    base::DictValue params;
    params.Set("format", "png");
    params.Set("fromSurface", true);
    params.Set("captureBeyondViewport", true);
    params.Set("clip", std::move(clip));
    Send(2, "Page.captureScreenshot", std::move(params));
  }

  void AgentHostClosed(content::DevToolsAgentHost*) override {
    attached_ = false;
    Finish(std::nullopt);
  }

  void Finish(std::optional<std::string> data) {
    auto keep_alive = base::WrapRefCounted(this);
    if (!reply_) return;
    auto reply = std::move(reply_);
    timer_.Stop();
    auto host = std::exchange(host_, nullptr);
    if (host && std::exchange(attached_, false)) host->DetachClient(this);
    std::move(reply).Run(std::move(data));
  }

  const bool bottom_;
  base::RepeatingCallback<bool()> can_capture_;
  base::OnceCallback<void(std::optional<std::string>)> reply_;
  float device_scale_ = 1;
  bool attached_ = false;
  scoped_refptr<content::DevToolsAgentHost> host_;
  base::OneShotTimer timer_;
};

}  // namespace

void CapturePageScreenshot(
    content::WebContents& contents,
    bool bottom,
    base::RepeatingCallback<bool()> can_capture,
    base::OnceCallback<void(std::optional<std::string>)> reply) {
  auto request = base::MakeRefCounted<ScreenshotRequest>(
      bottom, std::move(can_capture), std::move(reply));
  request->Start(contents);
}

}  // namespace sidebar
