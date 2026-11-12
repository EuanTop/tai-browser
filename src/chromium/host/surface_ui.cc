// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/surface_ui.h"
#include "base/command_line.h"
#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "chrome/browser/profiles/profile.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "sidebar_browser/host/native_host.h"
namespace sidebar {
bool SurfaceUIConfig::IsWebUIEnabled(content::BrowserContext* context) {
  return base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&
         !Profile::FromBrowserContext(context)->IsOffTheRecord();
}
SurfaceUI::SurfaceUI(content::WebUI* ui) : UntrustedWebUIController(ui) {
  auto* profile = Profile::FromWebUI(ui);
  auto* source = content::WebUIDataSource::CreateAndAdd(profile, "chrome-untrusted://tai-content/");
  source->SetRequestFilter(base::BindRepeating([](const std::string&) { return true; }),
      base::BindRepeating([](base::WeakPtr<NativeHost> host, const std::string& path,
          content::WebUIDataSource::GotDataCallback reply) {
        auto html = host ? host->SurfaceHtml(path) : std::nullopt;
        if (!html) { std::move(reply).Run(nullptr); return; }
        std::move(reply).Run(base::MakeRefCounted<base::RefCountedString>(std::move(*html)));
      }, NativeHost::ForProfile(profile)->GetWeakPtr()));
  using C = network::mojom::CSPDirectiveName;
  source->AddFrameAncestor(GURL("chrome://tai"));
  source->OverrideContentSecurityPolicy(C::DefaultSrc, "default-src 'none';");
  source->OverrideContentSecurityPolicy(C::ScriptSrc, "script-src 'unsafe-inline' blob:;");
  source->OverrideContentSecurityPolicy(C::StyleSrc, "style-src 'unsafe-inline';");
  source->OverrideContentSecurityPolicy(C::ImgSrc, "img-src data: blob:;");
  source->OverrideContentSecurityPolicy(C::ConnectSrc, "connect-src 'none';");
  source->OverrideContentSecurityPolicy(C::FrameSrc, "frame-src 'none';");
  source->OverrideContentSecurityPolicy(C::WorkerSrc, "worker-src 'none';");
  source->OverrideContentSecurityPolicy(C::ObjectSrc, "object-src 'none';");
  source->OverrideContentSecurityPolicy(C::FormAction, "form-action 'none';");
  source->OverrideContentSecurityPolicy(C::BaseURI, "base-uri 'none';");
  source->OverrideContentSecurityPolicy(C::Sandbox, "sandbox allow-scripts;");
  source->OverrideContentSecurityPolicy(C::TrustedTypes, "trusted-types dompurify tai-app;");
}
SurfaceUI::~SurfaceUI() = default;
}
