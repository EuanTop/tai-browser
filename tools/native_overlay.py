#!/usr/bin/env python3
"""Stage/apply the small native UI overlay against the exact locked baseline."""
import argparse
import base64
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

from bundle_host_assets import bundle as bundle_host_assets
import settings_overlay


from workspace_paths import ROOT, WORKSPACE
SOURCE = WORKSPACE / 'chromium/src'
STAGE = ROOT / 'research/local/native-overlay'
OWN_FILES = ('agent_activity.cc', 'agent_activity.h', 'agent_icon_mac.mm', 'agent_icon_mac.h', 'branding.h', 'space_navigation_view.h', 'space_navigation_view.cc', 'reload_menu.h', 'reload_menu.cc', 'localization.h', 'localization.cc', 'shortcuts.h', 'shortcuts.cc', 'shortcuts_mac.h', 'shortcuts_mac.mm', 'global_search_mac.h', 'global_search_mac.mm', 'internal_urls.h',
             'workspace_state.h', 'workspace_state.cc', 'sidebar_session.h',
             'sidebar_session.cc', 'model/workspace_model.h',
             'model/workspace_model.cc', 'workspace_commands.h', 'workspace_commands.cc',
             'tai_ui.h', 'tai_ui.cc', 'webui/tai.html', 'webui/tai.css', 'webui/tai.js', 'webui/i18n.js', 'webui/shortcuts.js', 'webui/shortcuts.css',
             'webui/components.html', 'webui/components.css', 'webui/home.html', 'webui/home.css', 'webui/home.js', 'webui/help.html', 'webui/help.css', 'webui/help.js', 'webui/welcome.html', 'webui/welcome.css', 'webui/welcome.js', 'webui/library.html', 'webui/library.css', 'webui/host-panel.js', 'webui/settings-agent.js', 'webui/panel.html', 'webui/panel.css', 'webui/panel-shell.js', 'webui/agent-setup.js', 'webui/agent-setup.css', 'host/native_host.h', 'host/native_host.cc',
             'host/local_host_server.h', 'host/local_host_server.cc',
             'host/page_identity.h', 'host/page_identity.cc', 'host/native_pages.cc', 'host/page_screenshot.cc', 'host/page_screenshot.h', 'host/page_interaction.js',
             'host/native_libraries.cc', 'host/native_surfaces.cc', 'host/validation.h',
             'host/surface_ui.h', 'host/surface_ui.cc',
             'host/native_panel.h', 'host/native_panel.cc',
             'host-files/secure_directory.h', 'host-files/secure_directory.cc')
BUILD = 'chrome/browser/BUILD.gn'
REGION = 'chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc'
STATE = 'chrome/browser/ui/tabs/vertical_tab_strip_state_controller_impl.cc'
COMMANDS = 'chrome/browser/ui/browser_commands.cc'
RESTORE = 'chrome/browser/ui/browser_tabrestore.cc'
SESSION_RESTORE = 'chrome/browser/sessions/session_restore.cc'
SESSION_SERVICE = 'chrome/browser/sessions/session_service_base.cc'
STARTUP_INFOBARS = 'chrome/browser/ui/startup/infobar_utils.cc'
DEFAULT_BROWSER_INFOBARS = (
    'chrome/browser/ui/startup/default_browser_prompt/default_browser_infobar_delegate.cc',
    'chrome/browser/ui/startup/default_browser_prompt/default_browser_infobar_manager.cc',
)
CONTEXT = 'chrome/browser/ui/browser_live_tab_context.cc'
TOOLBAR = 'chrome/browser/ui/views/toolbar/toolbar_view.cc'
LOCATION = 'chrome/browser/ui/views/location_bar/location_bar_view.cc'
WIDGET = 'chrome/browser/ui/views/frame/browser_widget.cc'
BROWSER_VIEW = 'chrome/browser/ui/views/frame/browser_view.cc'
PAGES = 'chrome/browser/ui/chrome_pages.cc'
COMMAND_CONTROLLER = 'chrome/browser/ui/browser_command_controller.cc'
KEY_DISPATCH = 'chrome/browser/ui/cocoa/chrome_command_dispatcher_delegate.mm'
COCOA_TEXT_INPUT = 'components/remote_cocoa/app_shim/bridged_content_view.mm'
MULTI_CONTENTS = 'chrome/browser/ui/views/frame/multi_contents_view.cc'
RELOAD = 'chrome/browser/ui/views/toolbar/reload_button.cc'
WEBUI_RELOAD = 'chrome/browser/ui/views/toolbar/webui_reload_control.cc'
WEBUI = 'chrome/browser/ui/webui/chrome_web_ui_configs.cc'
UNTRUSTED = 'chrome/browser/ui/webui/chrome_untrusted_web_ui_configs.cc'
OMNIBOX = 'chrome/browser/ui/toolbar/chrome_location_bar_model_delegate.cc'
OMNIBOX_INPUT = 'chrome/browser/ui/omnibox/chrome_omnibox_client.cc'
SCHEME_CLASSIFIER = 'chrome/browser/autocomplete/chrome_autocomplete_scheme_classifier.cc'
LOCATION_IDENTITY = 'chrome/browser/ui/views/location_bar/location_icon_state_helper.cc'
FOCUS = 'chrome/browser/ui/browser_web_contents_delegate/browser_web_contents_delegate.cc'
BINDERS = 'chrome/browser/chrome_browser_interface_binders.cc'
PANEL_IDS = 'chrome/browser/ui/side_panel/side_panel_entry_id.h'
PANEL_ID_IMPL = 'chrome/browser/ui/side_panel/side_panel_entry_id.cc'
SEARCH_FEATURES = 'chrome/browser/metrics/chrome_feature_list_creator.cc'
SEARCH_METRICS_BUILD = 'chrome/browser/metrics/BUILD.gn'
SEARCH_CONTROLLER = ('chrome/browser/ui/omnibox/omnibox_everywhere/'
                     'omnibox_everywhere_controller.cc')
SEARCH_BACKGROUND = ('chrome/browser/background/omnibox_everywhere/'
                     'omnibox_everywhere_background_mode_manager.cc')
SEARCH_WEBUI = 'chrome/browser/ui/webui/omnibox_everywhere/omnibox_everywhere_ui.cc'
SEARCH_MANAGER = ('chrome/browser/ui/omnibox/omnibox_everywhere/'
                  'omnibox_everywhere_ui_manager')
SEARCH_RESOURCES = 'chrome/browser/resources/omnibox_everywhere/'
GLOBAL_SEARCH_FILES = (SEARCH_FEATURES, SEARCH_METRICS_BUILD, SEARCH_CONTROLLER,
                       SEARCH_BACKGROUND, SEARCH_WEBUI,
                       SEARCH_MANAGER + '.cc', SEARCH_MANAGER + '.h',
                       *(SEARCH_RESOURCES + name for name in (
                           'BUILD.gn', 'app.ts', 'app.css', 'omnibox.css',
                           'profile_icon.html.ts', 'profile_icon.css')))
BRAND_ASSETS = {
    'kProductIcon': 'brand/atrium/product-icon-64.png',
    'kAboutIcon': 'brand/atrium/product-icon-256.png',
    'kStandardHero': 'brand/atrium/standard-hero.png',
    'kPrideHero': 'brand/atrium/editions/pride-hero.png',
    'kStandardIcon': 'brand/atrium/editions/standard-icon-aligned.png',
    'kPiAgentIcon': 'brand/agents/pi-badge.png',
    'kPrideIcon': 'brand/atrium/editions/pride-icon-pearl-organza.png',
}



def own_source(name):
    if name.startswith('host-files/'):
        return ROOT / 'src/host/files' / name[len('host-files/'):]
    return ROOT / ('src/sidebar/' + name[6:] if name.startswith('model/')
                   else 'src/chromium/' + name)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise ValueError('Upstream anchor is not unique; review the new source')
    return source.replace(before, after, 1)


def upstream(path):
    return subprocess.check_output(['git', 'show', 'HEAD:' + path], cwd=SOURCE)


def global_search_changes():
    mode = 'base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")'
    features = replace_once(upstream(SEARCH_FEATURES).decode(),
        '#include "chrome/common/chrome_paths.h"',
        '#include "chrome/common/chrome_paths.h"\n'
        '#if BUILDFLAG(IS_MAC)\n'
        '#include "chrome/browser/ui/omnibox/omnibox_next_features.h"\n'
        '#endif')
    features = replace_once(features,
        '  variations_service->SetUpFieldTrials(\n'
        '      variation_ids,\n'
        '      content::GetSwitchDependentFeatureOverrides(\n'
        '          *base::CommandLine::ForCurrentProcess()),\n'
        '      std::move(feature_list), browser_field_trials_.get());',
        '  auto overrides = content::GetSwitchDependentFeatureOverrides(\n'
        '      *base::CommandLine::ForCurrentProcess());\n'
        '#if BUILDFLAG(IS_MAC)\n'
        f'  if ({mode}) {{\n'
        '    overrides.emplace_back(omnibox::kOmniboxEverywhere,\n'
        '                           base::FeatureList::OVERRIDE_ENABLE_FEATURE);\n'
        '    // TAi already exposes this shortcut in its own settings.\n'
        '    overrides.emplace_back(omnibox::kOmniboxEverywhereFre,\n'
        '                           base::FeatureList::OVERRIDE_DISABLE_FEATURE);\n'
        '  }\n'
        '#endif\n'
        '  variations_service->SetUpFieldTrials(\n'
        '      variation_ids, overrides, std::move(feature_list),\n'
        '      browser_field_trials_.get());')
    metrics = replace_once(upstream(SEARCH_METRICS_BUILD).decode(),
        '  if (enable_pdf) {\n    deps += [ "//components/pdf/browser" ]',
        '  if (is_mac) {\n'
        '    deps += [ "//chrome/browser/ui/omnibox" ]\n'
        '  }\n\n'
        '  if (enable_pdf) {\n    deps += [ "//components/pdf/browser" ]')
    controller = replace_once(upstream(SEARCH_CONTROLLER).decode(),
        'namespace omnibox_everywhere {\n',
        'namespace omnibox_everywhere {\n\n'
        'namespace {\n'
        'bool UsesTaiShortcut() {\n'
        f'  return BUILDFLAG(IS_MAC) && {mode};\n'
        '}\n'
        '}  // namespace\n')
    controller = replace_once(controller,
        'void OmniboxEverywhereController::UpdateHotkeyRegistration() {\n',
        'void OmniboxEverywhereController::UpdateHotkeyRegistration() {\n'
        '  if (UsesTaiShortcut()) {\n'
        '    return;\n'
        '  }\n')
    controller = replace_once(controller,
        '  if (source == InvocationSource::kGlobalHotkey) {\n'
        '    if (!IsHotkeyEnabled()) {',
        '  if (source == InvocationSource::kGlobalHotkey && !UsesTaiShortcut()) {\n'
        '    if (!IsHotkeyEnabled()) {')
    controller = replace_once(controller,
        '  // Enable background mode/launch on startup the first time this is invoked.\n'
        '  if (g_browser_process && g_browser_process->local_state()) {',
        '  // Enable background mode/launch on startup the first time this is invoked.\n'
        '  if (!UsesTaiShortcut() && g_browser_process &&\n'
        '      g_browser_process->local_state()) {')
    background = replace_once(upstream(SEARCH_BACKGROUND).decode(),
        '#include "base/check.h"',
        '#include "base/check.h"\n#include "base/command_line.h"')
    background = replace_once(background,
        'void OmniboxEverywhereBackgroundModeManager::OnPrefChanged() {\n',
        'void OmniboxEverywhereBackgroundModeManager::OnPrefChanged() {\n'
        f'  if (BUILDFLAG(IS_MAC) && {mode}) {{\n'
        '    Reset();\n'
        '    return;\n'
        '  }\n')
    webui = upstream(SEARCH_WEBUI).decode()
    if '#include "base/command_line.h"' not in webui:
        webui = replace_once(webui, '#include "base/feature_list.h"',
            '#include "base/command_line.h"\n#include "base/feature_list.h"')
    webui = replace_once(webui,
        '  std::string profile_avatar_url =\n',
        f'  const bool tai_style = BUILDFLAG(IS_MAC) && {mode};\n'
        '  source->AddBoolean("taiStyle", tai_style);\n'
        '  bool tai_default_avatar = tai_style;\n'
        '  std::string profile_avatar_url =\n')
    webui = replace_once(webui,
        '    if (entry) {\n      gfx::Image icon = profiles::GetSizedAvatarIcon(',
        '    if (entry) {\n'
        '      tai_default_avatar = tai_style && entry->IsUsingDefaultAvatar() &&\n'
        '                           !entry->GetGAIAPicture();\n'
        '      gfx::Image icon = profiles::GetSizedAvatarIcon(')
    webui = replace_once(webui,
        '  source->AddBoolean("omniboxEverywhereProfilePickerEnabled",\n'
        '                     omnibox::kOmniboxEverywhereProfilePickerParam.Get());',
        '  source->AddBoolean("taiDefaultAvatar", tai_default_avatar);\n'
        '  source->AddBoolean("omniboxEverywhereProfilePickerEnabled",\n'
        '                     !tai_style &&\n'
        '                         omnibox::kOmniboxEverywhereProfilePickerParam.Get());')
    manager_header = replace_once(upstream(SEARCH_MANAGER + '.h').decode(),
        '  // Closes the Omnibox Everywhere widget.',
        '  // The supplier has process lifetime and only themes this popup.\n'
        '  void SetTaiPalette(ui::ColorProviderKey::InitializerSupplier& palette);\n\n'
        '  // Closes the Omnibox Everywhere widget.')
    manager_header = replace_once(manager_header,
        '  std::unique_ptr<views::Widget> widget_;',
        '  raw_ptr<ui::ColorProviderKey::InitializerSupplier> tai_palette_ = nullptr;\n'
        '  std::unique_ptr<views::Widget> widget_;')
    manager = replace_once(upstream(SEARCH_MANAGER + '.cc').decode(),
        'bool IsFuseboxEligible(Profile* profile) {',
        '''class TaiSearchWidget final : public views::Widget {
 public:
  explicit TaiSearchWidget(ui::ColorProviderKey::InitializerSupplier& palette)
      : palette_(&palette) {}

  void SetPalette(ui::ColorProviderKey::InitializerSupplier& palette) {
    if (palette_ == &palette) {
      return;
    }
    palette_ = &palette;
    ResetLastColorProviderKey();
    ScheduleThemeChanged();
  }

  ui::ColorProviderKey GetColorProviderKey() const override {
    auto key = views::Widget::GetColorProviderKey();
    key.app_controller = palette_.get();
    return key;
  }

 private:
  raw_ptr<ui::ColorProviderKey::InitializerSupplier> palette_;
};

bool IsFuseboxEligible(Profile* profile) {''')
    manager = replace_once(manager,
        'void OmniboxEverywhereUIManager::CreateAndInitWidget(',
        '''void OmniboxEverywhereUIManager::SetTaiPalette(
    ui::ColorProviderKey::InitializerSupplier& palette) {
  // A native entry point can have created the widget before the TAi shortcut.
  if (widget_ && !tai_palette_) {
    CleanUpWidget();
  }
  tai_palette_ = &palette;
  if (widget_) {
    static_cast<TaiSearchWidget*>(widget_.get())->SetPalette(palette);
  }
}

void OmniboxEverywhereUIManager::CreateAndInitWidget(''')
    manager = replace_once(manager,
        '  widget_ = std::make_unique<views::Widget>();',
        '''  if (tai_palette_) {
    widget_ = std::make_unique<TaiSearchWidget>(*tai_palette_);
  } else {
    widget_ = std::make_unique<views::Widget>();
  }''')
    resources = {}

    def style_file(name, before, after):
        path = SEARCH_RESOURCES + name
        original = resources[path].decode() if path in resources else upstream(path).decode()
        resources[path] = replace_once(original, before, after).encode()

    style_file('BUILD.gn',
        '    "//ui/webui/resources/cr_components/composebox:build_ts",',
        '    "//ui/webui/resources/cr_components/color_change_listener:build_ts",\n'
        '    "//ui/webui/resources/cr_components/composebox:build_ts",')
    style_file('app.ts',
        "import type {ComposeboxState} from ",
        "import {ColorChangeUpdater} from '//resources/cr_components/color_change_listener/colors_css_updater.js';\n"
        "import type {ComposeboxState} from ")
    style_file('app.ts',
        '    super.connectedCallback();',
        '''    super.connectedCallback();
    if (loadTimeData.valueExists('taiStyle') && loadTimeData.getBoolean('taiStyle')) {
      this.setAttribute('tai-style', '');
      const colors = ColorChangeUpdater.forDocument();
      colors.start();
      // Covers the first load as well as changes while the cached popup is hidden.
      void colors.refreshColorsCss();
    }''')
    style_file('app.css',
        ':host([small-loomnibox]) {',
        '''@media (forced-colors: none) and (prefers-contrast: no-preference) {
  :host([tai-style]) {
    --tai-search-accent: var(--color-searchbox-results-focus-indicator);
    --tai-search-tint: color-mix(in srgb, var(--tai-search-accent) 11%, transparent);
    --color-searchbox-results-background-selected: var(--tai-search-tint);
    --cr-focus-outline-color: var(--tai-search-accent);
  }

  :host([tai-style]) :is(omnibox-everywhere-omnibox, omnibox-everywhere-composebox) {
    --color-composebox-type-ahead-chip: var(--tai-search-tint);
  }

  :host([tai-style]) #mostVisitedContainer {
    --most-visited-focus-shadow: 0 0 0 2px var(--tai-search-accent);
  }
}

:host([small-loomnibox]) {''')
    style_file('omnibox.css',
        '  --color-searchbox-selection-background: rgba(26, 115, 232, 0.2);',
        '  --color-searchbox-selection-background: '
        'var(--tai-search-tint, rgba(26, 115, 232, 0.2));')
    style_file('profile_icon.html.ts',
        "import {html} from '//resources/lit/v3_0/lit.rollup.js';",
        "import {html} from '//resources/lit/v3_0/lit.rollup.js';\n"
        "import {loadTimeData} from '//resources/js/load_time_data.js';")
    style_file('profile_icon.html.ts',
        '      <img id="profileIcon" src="${this.profileAvatarUrl_}"\n'
        '          alt="${this.i18n(\'profileButtonLabel\')}">',
        '''      ${loadTimeData.valueExists('taiDefaultAvatar') &&
                loadTimeData.getBoolean('taiDefaultAvatar') ? html`
        <span id="taiAvatar" aria-hidden="true"><cr-icon icon="cr:person"></cr-icon></span>
      ` : html`
        <img id="profileIcon" src="${this.profileAvatarUrl_}"
            alt="${this.i18n('profileButtonLabel')}">
      `}''')
    style_file('profile_icon.css',
        ':host([is-enterprise-profile]) #profileContainer {',
        '''#taiAvatar {
  align-items: center;
  background: var(--tai-search-tint, ButtonFace);
  border-radius: 50%;
  color: var(--tai-search-accent, ButtonText);
  display: grid;
  height: 20px;
  justify-items: center;
  width: 20px;
}

#taiAvatar cr-icon {
  --iron-icon-height: 14px;
  --iron-icon-width: 14px;
}

:host([is-enterprise-profile]) #profileContainer {''')
    return {
        SEARCH_FEATURES: features.encode(),
        SEARCH_METRICS_BUILD: metrics.encode(),
        SEARCH_CONTROLLER: controller.encode(),
        SEARCH_BACKGROUND: background.encode(),
        SEARCH_WEBUI: webui.encode(),
        SEARCH_MANAGER + '.cc': manager.encode(),
        SEARCH_MANAGER + '.h': manager_header.encode(),
        **resources,
    }


def changes():
    startup_infobars = upstream(STARTUP_INFOBARS).decode()
    startup_infobars = replace_once(startup_infobars,
        '#if !BUILDFLAG(IS_CHROMEOS) && !BUILDFLAG(IS_ANDROID)\n  if (is_web_app ||',
        '#if !BUILDFLAG(IS_CHROMEOS) && !BUILDFLAG(IS_ANDROID)\n'
        '#if BUILDFLAG(IS_MAC)\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    if (!is_web_app && !IsKioskModeEnabled() && profile->IsRegularProfile() &&\n'
        '        !startup_command_line.HasSwitch(switches::kNoDefaultBrowserCheck)) {\n'
        '      ShowDefaultBrowserPrompt(profile, base::DoNothing());\n'
        '    }\n'
        '    return;\n'
        '  }\n'
        '#endif\n'
        '  if (is_web_app ||')
    default_delegate_path, default_manager_path = DEFAULT_BROWSER_INFOBARS
    default_delegate = upstream(default_delegate_path).decode()
    default_delegate = replace_once(default_delegate,
        '#include "base/types/pass_key.h"',
        '#include "base/command_line.h"\n#include "base/strings/string_util.h"\n'
        '#include "base/types/pass_key.h"')
    default_delegate = replace_once(default_delegate,
        '  return dark_mode() ? features::IsRoundedIconsEnabled()',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser"))\n'
        '    return vector_icons::kGlobeIcon;\n'
        '  return dark_mode() ? features::IsRoundedIconsEnabled()')
    default_delegate = replace_once(default_delegate,
        '  return l10n_util::GetStringUTF16(can_pin_to_taskbar_\n'
        '                                       ? IDS_DEFAULT_BROWSER_PIN_INFOBAR_TEXT\n'
        '                                       : IDS_DEFAULT_BROWSER_INFOBAR_TEXT);',
        '  auto message = l10n_util::GetStringUTF16(can_pin_to_taskbar_\n'
        '                                      ? IDS_DEFAULT_BROWSER_PIN_INFOBAR_TEXT\n'
        '                                      : IDS_DEFAULT_BROWSER_INFOBAR_TEXT);\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    base::ReplaceSubstringsAfterOffset(\n'
        '        &message, 0, l10n_util::GetStringUTF16(IDS_PRODUCT_NAME), u"TAi Browser");\n'
        '  }\n'
        '  return message;')
    default_manager = upstream(default_manager_path).decode()
    default_manager = replace_once(default_manager,
        '#include "base/functional/bind.h"',
        '#include "base/command_line.h"\n#include "base/functional/bind.h"')
    default_manager = replace_once(default_manager,
        'bool IsMigrated() {\n  return infobars::IsInfoBarMigrated(',
        'bool IsMigrated() {\n'
        '  // TAi uses its branded prompt from the native confirm delegate.\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser"))\n'
        '    return false;\n'
        '  return infobars::IsInfoBarMigrated(')
    omni_input = upstream(OMNIBOX_INPUT).decode()
    omni_input = replace_once(omni_input, '#include "chrome/browser/ui/omnibox/chrome_omnibox_client.h"',
        '#include "chrome/browser/ui/omnibox/chrome_omnibox_client.h"\n#include "base/command_line.h"\n#include "sidebar_browser/internal_urls.h"')
    omni_input = replace_once(omni_input,
        '  // Store the details necessary to open the omnibox match via browser commands.',
        '  GURL tai_destination = destination_url;\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    const auto canonical = sidebar::CanonicalTaiInput(destination_url);\n'
        '    if (!canonical) return;\n'
        '    tai_destination = *canonical;\n'
        '  }\n\n'
        '  // Store the details necessary to open the omnibox match via browser commands.')
    omni_input = replace_once(omni_input,
        '      destination_url, disposition, transition, match_selection_timestamp,',
        '      tai_destination, disposition, transition, match_selection_timestamp,')
    scheme = upstream(SCHEME_CLASSIFIER).decode()
    scheme = replace_once(scheme, '#include "base/notreached.h"', '#include "base/notreached.h"\n#include "base/command_line.h"')
    scheme = replace_once(scheme, '  if (scheme.empty()) {',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '      base::EqualsCaseInsensitiveASCII(scheme, "tai")) return metrics::OmniboxInputType::URL;\n'
        '  if (scheme.empty()) {')
    identity = upstream(LOCATION_IDENTITY).decode()
    identity = replace_once(identity, '#include "build/branding_buildflags.h"', '#include "build/branding_buildflags.h"\n#include "base/command_line.h"')
    identity = replace_once(identity, '    return l10n_util::GetStringUTF16(IDS_SHORT_PRODUCT_NAME);',
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) return u"TAi";\n'
        '    return l10n_util::GetStringUTF16(IDS_SHORT_PRODUCT_NAME);')
    build = upstream(BUILD).decode()
    native_sources = [
        name for name in OWN_FILES
        if name.endswith(('.cc', '.h')) and not name.endswith('_mac.h')
    ]
    mac_sources = [name for name in OWN_FILES if name.endswith(('_mac.h', '_mac.mm'))]
    native_list = ''.join('      "//sidebar_browser/' + name + '",\n' for name in native_sources)
    mac_list = ''.join('        "//sidebar_browser/' + name + '",\n' for name in mac_sources)
    build_anchor = '  if (toolkit_views) {\n    deps += [\n      ":resources",'
    build = replace_once(build, build_anchor,
        '  if (toolkit_views) {\n'
        '    deps += [\n'
        '      ":tai_browser_ui",\n'
        '      ":resources",')
    target_anchor = '# These are the dependencies for the "browser" target that are outside of'
    build = replace_once(build, target_anchor,
        'if (toolkit_views) {\n'
        '  source_set("tai_browser_ui") {\n'
        '    sources = [\n' + native_list + '    ]\n'
        '    if (is_mac) {\n'
        '      sources += [\n' + mac_list + '      ]\n'
        '    }\n'
        '    deps = [\n'
        '      ":browser_public_dependencies",\n'
        '      ":core",\n'
        '      "//chrome/browser/ui/views/frame:browser_view_header",\n'
        '      "//content/public/browser",\n'
        '      "//extensions/buildflags",\n'
        '      "//services/network/public/mojom",\n'
        '      "//ui/base/dragdrop/mojom",\n'
        '      "//ui/views",\n'
        '    ]\n'
        '    if (is_mac) {\n'
        '      deps += [\n'
        '        ":browser_process",\n'
        '        ":global_features",\n'
        '        "//chrome/browser/ui/omnibox",\n'
        '        "//chrome/browser/ui/omnibox/omnibox_everywhere",\n'
        '      ]\n'
        '    }\n'
        '  }\n'
        '}\n\n' + target_anchor)
    region = upstream(REGION).decode()
    region = replace_once(region, '#include "base/callback_list.h"',
                          '#include "base/callback_list.h"\n'
                          '#include "base/command_line.h"')
    region = replace_once(region, '#include "ui/views/view_utils.h"',
                          '#include "ui/views/view_utils.h"\n'
                          '#include "ui/views/widget/widget.h"\n'
                          '#include "sidebar_browser/space_navigation_view.h"')
    region = replace_once(region,
        '  gemini_button_ =\n'
        '      content_area_view_->AddChildView(std::make_unique<views::View>());',
        '  gemini_button_ =\n'
        '      content_area_view_->AddChildView(std::make_unique<views::View>());\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    auto* navigation = content_area_view_->AddChildView(\n'
        '        std::make_unique<sidebar::SpaceNavigationView>(\n'
        '            browser_view->browser(), state_controller_));\n'
        '    navigation->SetProperty(views::kFlexBehaviorKey,\n'
        '        views::FlexSpecification(views::LayoutOrientation::kVertical,\n'
        '                                 views::MinimumFlexSizeRule::kScaleToMinimum,\n'
        '                                 views::MaximumFlexSizeRule::kUnbounded));\n'
        '    navigation->SetID(0x534250);\n'
        '    top_button_separator_->SetVisible(false);\n'
        '    bottom_button_container_->SetVisible(false);\n'
        '    gemini_button_->SetVisible(false);\n'
        '  }')
    region = replace_once(region,
        '  content_parent->AddChildViewAt(std::move(view), separator_index.value() + 1);',
        '  if (GetViewByID(0x534250)) view->SetVisible(false);\n'
        '  content_parent->AddChildViewAt(std::move(view), separator_index.value() + 1);')
    region = replace_once(region,
        '  // Lay out the top button container.\n',
        '  const auto* tai_navigation = GetViewByID(0x534250);\n'
        '  // Keep the caption area while the TAi sidebar supplies its own controls.\n'
        '  // Lay out the top button container.\n')
    region = replace_once(region,
        '      {.child_view = top_button_container_.get(),\n       .visible = true,',
        '      {.child_view = top_button_container_.get(),\n       .visible = !tai_navigation,')
    region = replace_once(region,
        'views::View* VerticalTabStripRegionView::GetDefaultFocusableChild() {\n',
        'views::View* VerticalTabStripRegionView::GetDefaultFocusableChild() {\n'
        '  if (GetViewByID(0x534250)) return GetWidget() ? GetWidget()->GetRootView()->GetViewByID(0x534254) : nullptr;\n')
    region = replace_once(region,
        '  SetBackground(std::make_unique<CustomCornersBackground>(\n'
        '      *this, *browser_view,\n'
        '      /*primary_color=*/CustomCornersBackground::FrameTheme(),\n'
        '      /*corner_color=*/CustomCornersBackground::ToolbarTheme()));',
        '  if (GetViewByID(0x534250)) {\n'
        '    SetBackground(sidebar::CreateSidebarBackground(*this, *browser_view));\n'
        '  } else {\n'
        '    SetBackground(std::make_unique<CustomCornersBackground>(\n'
        '        *this, *browser_view,\n'
        '        /*primary_color=*/CustomCornersBackground::FrameTheme(),\n'
        '        /*corner_color=*/CustomCornersBackground::ToolbarTheme()));\n'
        '  }')
    region = replace_once(region,
        '                         ? tabs::kVerticalTabStripCollapsedWidth\n'
        '                         : tabs::kVerticalTabStripUncollapsedMinWidth);',
        '                         ? (GetViewByID(0x534250) ? 0 : tabs::kVerticalTabStripCollapsedWidth)\n'
        '                         : tabs::kVerticalTabStripUncollapsedMinWidth);')
    region = replace_once(region,
        '  const int expand_amount =\n'
        '      std::max(0, target_collapse_state_.uncollapsed_width -\n'
        '                      tabs::kVerticalTabStripCollapsedWidth);',
        '  const int collapsed_width = GetViewByID(0x534250) ? 0 :\n'
        '      tabs::kVerticalTabStripCollapsedWidth;\n'
        '  const int expand_amount =\n'
        '      std::max(0, target_collapse_state_.uncollapsed_width - collapsed_width);')
    region = replace_once(region, '  size.set_width(tabs::kVerticalTabStripCollapsedWidth +',
        '  size.set_width(collapsed_width +')
    region = replace_once(region,
        '  bool collapsed = state != tabs::VerticalTabStripCollapseState::kExpanded;',
        '  bool collapsed = state != tabs::VerticalTabStripCollapseState::kExpanded;\n'
        '  if (auto* navigation = GetViewByID(0x534250)) {\n'
        '    navigation->SetVisible(state != tabs::VerticalTabStripCollapseState::kCollapsed);\n'
        '  }')
    toolbar = upstream(TOOLBAR).decode()
    toolbar = replace_once(toolbar,
        '#include "chrome/browser/ui/views/toolbar/toolbar_view.h"',
        '#include "chrome/browser/ui/views/toolbar/toolbar_view.h"\n'
        '#include "sidebar_browser/agent_activity.h"\n'
        '#include "sidebar_browser/space_navigation_view.h"\n'
        '#include "sidebar_browser/host/native_panel.h"')
    toolbar = replace_once(toolbar,
        '    SetBackground(std::make_unique<CustomCornersBackground>(\n'
        '        *this, *browser_view_,\n'
        '        /*primary_color=*/CustomCornersBackground::ToolbarTheme(),\n'
        '        /*corner_color=*/CustomCornersBackground::FrameTheme()));',
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '      SetBackground(sidebar::CreateToolbarBackground(*this, *browser_view_));\n'
        '    } else {\n'
        '      SetBackground(std::make_unique<CustomCornersBackground>(\n'
        '          *this, *browser_view_, CustomCornersBackground::ToolbarTheme(),\n'
        '          CustomCornersBackground::FrameTheme()));\n'
        '    }')
    toolbar = replace_once(toolbar,
        '  // Only manage the overflow button when there are at least some views',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '      !browser_->GetProfile()->IsOffTheRecord()) {\n'
        '    sidebar::AddAgentActivityChip(*this);\n'
        '  }\n\n'
        '  // Only manage the overflow button when there are at least some views')
    location = upstream(LOCATION).decode()
    location = replace_once(location, '#include "chrome/browser/ui/views/location_bar/location_bar_view.h"',
        '#include "chrome/browser/ui/views/location_bar/location_bar_view.h"\n'
        '#include "sidebar_browser/space_navigation_view.h"')
    location = replace_once(location,
        '  background_color_ = gfx::Tween::ColorValueBetween(opacity, normal, hovered);\n  if (is_caret_visible) {',
        '  const bool quiet_home = !high_contrast && !input_in_progress &&\n'
        '      omnibox_view_->GetText().empty() && sidebar::IsProductHome(\n'
        '          BrowserView::GetBrowserViewForBrowser(browser_));\n'
        '  // Idle TAi chrome belongs to the page canvas; focused/input and high\n'
        '  // contrast states continue through the original Chromium branches.\n'
        '  if ((!is_caret_visible || quiet_home) && !input_in_progress && !high_contrast) {\n'
        '    if (auto color = sidebar::PageChromeColor(\n'
        '            BrowserView::GetBrowserViewForBrowser(browser_))) {\n'
        '      normal = *color;\n'
        '      hovered = color_utils::AlphaBlend(color_utils::IsDark(*color)\n'
        '          ? SK_ColorWHITE : SK_ColorBLACK, *color, static_cast<SkAlpha>(12));\n'
        '    }\n  }\n'
        '  background_color_ = gfx::Tween::ColorValueBetween(opacity, normal, hovered);\n  if (is_caret_visible && !quiet_home) {')
    location = replace_once(location,
        '    views::FocusRing::Get(this)->SetOutsetFocusRingDisabled(true);',
        '    views::FocusRing::Get(this)->SetOutsetFocusRingDisabled(true);\n'
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '        !browser_->GetProfile()->IsOffTheRecord()) {\n'
        '      views::FocusRing::Get(this)->SetColorId(kColorOmniboxResultsFocusIndicator);\n'
        '    }')
    widget = upstream(WIDGET).decode()
    widget = replace_once(widget, '#include "chrome/browser/ui/views/frame/browser_widget.h"',
        '#include "chrome/browser/ui/views/frame/browser_widget.h"\n'
        '#include "sidebar_browser/space_navigation_view.h"')
    widget = replace_once(widget, '  return key;\n}\n\nvoid BrowserWidget::OnMenuClosed()',
        '  sidebar::ApplyPageChromePalette(browser_view_, key);\n'
        '  return key;\n}\n\nvoid BrowserWidget::OnMenuClosed()')
    browser_view = upstream(BROWSER_VIEW).decode()
    browser_view = replace_once(browser_view, '#include "chrome/browser/ui/views/frame/browser_view.h"',
        '#include "chrome/browser/ui/views/frame/browser_view.h"\n'
        '#include "sidebar_browser/space_navigation_view.h"')
    browser_view = replace_once(browser_view,
        '                                        kContentsSeparatorTopEdgeElementId);',
        '                                        kContentsSeparatorTopEdgeElementId);\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    top_container_separator_->SetID(0x534243);\n'
        '    top_container_separator_->SetBackground(sidebar::CreatePageChromeEdgeBackground(*this));\n'
        '  }')
    browser_view = replace_once(browser_view,
        '#include "sidebar_browser/space_navigation_view.h"',
        '#include "sidebar_browser/space_navigation_view.h"\n'
        '#include "sidebar_browser/shortcuts.h"\n#include "sidebar_browser/tai_ui.h"')
    for method, anchor in (
        ('Show', '  if (auto* manager = InitialWebUIManager::From(browser())) {'),
        ('Activate', '  if (auto* manager = InitialWebUIManager::From(browser())) {'),
        ('ShowInactive', '  if (!browser_widget_->IsVisible()) {'),
    ):
        start = browser_view.index('void BrowserView::' + method + '() {')
        insert = browser_view.index(anchor, start)
        browser_view = (browser_view[:insert] +
            '  if (sidebar::DeferBrowserForWelcome(browser())) {\n'
            '    return;\n  }\n\n' + browser_view[insert:])
    browser_view = replace_once(browser_view,
        '      ui::GetAcceleratorFromNativeWebKeyboardEvent(event);\n',
        '      ui::GetAcceleratorFromNativeWebKeyboardEvent(event);\n'
        '  const auto tai_result = sidebar::RouteShortcut(browser_.get(), accelerator,\n'
        '      sidebar::ShortcutPhase::kBeforeResponder);\n'
        '  if (tai_result == sidebar::ShortcutResult::kHandled)\n'
        '    return content::KeyboardEventProcessingResult::HANDLED;\n'
        '  if (tai_result == sidebar::ShortcutResult::kDeferred)\n'
        '    return content::KeyboardEventProcessingResult::NOT_HANDLED_IS_SHORTCUT;\n')
    browser_view = replace_once(browser_view,
        'bool BrowserView::HandleKeyboardEvent(const NativeWebKeyboardEvent& event) {\n',
        'bool BrowserView::HandleKeyboardEvent(const NativeWebKeyboardEvent& event) {\n'
        '  if (sidebar::RouteShortcut(browser_.get(),\n'
        '          ui::GetAcceleratorFromNativeWebKeyboardEvent(event),\n'
        '          sidebar::ShortcutPhase::kAfterResponder) == sidebar::ShortcutResult::kHandled) return true;\n')
    cocoa_text = replace_once(
        upstream(COCOA_TEXT_INPUT).decode(),
        '    _bridge->text_input_host()->GetFirstRectForRange(gfx::Range(range), &rect,\n'
        '                                                     &actualRange);',
        '    _bridge->text_input_host()->GetFirstRectForRange(\n'
        '        gfx::Range::FromPossiblyInvalidNSRange(range), &rect, &actualRange);')
    key_dispatch = upstream(KEY_DISPATCH).decode()
    key_dispatch = replace_once(key_dispatch,
        '#include "base/check.h"',
        '#include "base/check.h"\n#include "chrome/browser/ui/views/frame/browser_view.h"\n'
        '#include "sidebar_browser/shortcuts.h"\n#include "sidebar_browser/shortcuts_mac.h"')
    pre_key = ('  input::NativeWebKeyboardEvent tai_event((base::apple::OwnedNSEvent(event)));\n'
        '  auto* tai_view = BrowserView::GetBrowserViewForNativeWindow(gfx::NativeWindow(window));\n'
        '  if (tai_view && !tai_view->GetFocusManager()->shortcut_handling_suspended()) {\n'
        '    const auto result = sidebar::RouteShortcut(tai_view->browser(),\n'
        '        ui::GetAcceleratorFromNativeWebKeyboardEvent(tai_event),\n'
        '        sidebar::ShortcutPhase::kBeforeResponder);\n'
        '    if (result == sidebar::ShortcutResult::kHandled) return ui::PerformKeyEquivalentResult::kHandled;\n'
        '    if (result == sidebar::ShortcutResult::kDeferred) return ui::PerformKeyEquivalentResult::kUnhandled;\n'
        '  }\n\n')
    key_dispatch = replace_once(key_dispatch,
        '  if ([self eventHandledByViewsFocusManager:event\n'
        '                                   priority:ui::AcceleratorManager::\n'
        '                                                kHighPriority]) {',
        '  // The explicit system search key also owns the in-app key equivalent,\n'
        '  // ahead of Chromium split-view and local extension accelerators.\n'
        '  input::NativeWebKeyboardEvent tai_global_event((base::apple::OwnedNSEvent(event)));\n'
        '  auto* tai_global_view = BrowserView::GetBrowserViewForNativeWindow(gfx::NativeWindow(window));\n'
        '  const auto tai_logical_key = ui::GetAcceleratorFromNativeWebKeyboardEvent(tai_global_event);\n'
        '  const ui::Accelerator tai_global_key(sidebar::GlobalSearchKeyCode([event keyCode]),\n'
        '      tai_logical_key.modifiers(), tai_logical_key.key_state(), tai_logical_key.time_stamp());\n'
        '  if (tai_global_view && sidebar::IsGlobalSearchKey(tai_global_view->browser(), tai_global_key)) {\n'
        '    const auto result = sidebar::RouteShortcut(tai_global_view->browser(), tai_global_key,\n'
        '        sidebar::ShortcutPhase::kBeforeResponder);\n'
        '    if (result == sidebar::ShortcutResult::kHandled) return ui::PerformKeyEquivalentResult::kHandled;\n'
        '    if (result == sidebar::ShortcutResult::kDeferred) return ui::PerformKeyEquivalentResult::kUnhandled;\n'
        '  }\n\n'
        '  if ([self eventHandledByViewsFocusManager:event\n'
        '                                   priority:ui::AcceleratorManager::\n'
        '                                                kHighPriority]) {')
    key_dispatch = replace_once(key_dispatch,
        '  // If this keyEquivalent corresponds to a Chrome command, trigger it directly',
        pre_key + '  // If this keyEquivalent corresponds to a Chrome command, trigger it directly')
    key_dispatch = replace_once(key_dispatch,
        '                                              isRedispatch:(BOOL)isRedispatch {\n',
        '                                              isRedispatch:(BOOL)isRedispatch {\n' +
        pre_key.replace('kBeforeResponder', 'kAfterResponder'))
    toolbar = replace_once(toolbar,
        '#include "sidebar_browser/space_navigation_view.h"',
        '#include "sidebar_browser/space_navigation_view.h"\n#include "sidebar_browser/shortcuts.h"')
    toolbar = replace_once(toolbar,
        '    ui::Accelerator* accelerator) const {\n',
        '    ui::Accelerator* accelerator) const {\n'
        '  if (sidebar::GetManagedShortcutForCommand(browser_, command_id, accelerator))\n'
        '    return accelerator->key_code() != ui::VKEY_UNKNOWN;\n')
    multi_contents = upstream(MULTI_CONTENTS).decode()
    multi_contents = replace_once(multi_contents, '#include "chrome/browser/ui/views/frame/multi_contents_view.h"',
        '#include "chrome/browser/ui/views/frame/multi_contents_view.h"\n'
        '#include "sidebar_browser/space_navigation_view.h"\n'
        '#include "base/command_line.h"')
    multi_contents = replace_once(multi_contents,
        '      views::kElementIdentifierKey, kContentsSeparatorTopEdgeElementId);',
        '      views::kElementIdentifierKey, kContentsSeparatorTopEdgeElementId);\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    contents_separators_.top_separator->SetID(0x534244);\n'
        '    contents_separators_.top_separator->SetBackground(\n'
        '        sidebar::CreatePageChromeEdgeBackground(*browser_view_, true));\n'
        '  }')
    state = upstream(STATE).decode()
    state = replace_once(state, '#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller_impl.h"',
                         '#include "chrome/browser/ui/tabs/vertical_tab_strip_state_controller_impl.h"\n'
                         '#include "base/command_line.h"')
    # Keep the controller's internal state consistent as well as its layout
    # query. Otherwise settings or a fullscreen enable lock could restore the
    # horizontal tab strip even in the independently launched product.
    old = 'pref_service_->GetBoolean(prefs::kVerticalTabsEnabled)'
    new = ('(base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") ||\n'
           '       pref_service_->GetBoolean(prefs::kVerticalTabsEnabled))')
    # Four assignments/comparisons use this preference in this revision.
    if state.count(old) != 4:
        raise ValueError('Vertical-tabs preference call sites changed; review')
    state = state.replace(old, new)
    state = replace_once(state,
        'void VerticalTabStripStateControllerImpl::SetVerticalTabsEnabled(bool enabled) {\n',
        'void VerticalTabStripStateControllerImpl::SetVerticalTabsEnabled(bool enabled) {\n'
        '  if (!enabled && base::CommandLine::ForCurrentProcess()->HasSwitch(\n'
        '                      "sidebar-browser")) {\n'
        '    return;\n'
        '  }\n')
    state = replace_once(state,
        'bool VerticalTabStripStateControllerImpl::IsExpandOnHoverEnabled() const {\n',
        'bool VerticalTabStripStateControllerImpl::IsExpandOnHoverEnabled() const {\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) return false;\n')
    pages = upstream(PAGES).decode()
    pages = replace_once(pages, '#include "chrome/browser/ui/chrome_pages.h"',
        '#include "chrome/browser/ui/chrome_pages.h"\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '#include "sidebar_browser/space_navigation_view.h"\n'
        '#include "sidebar_browser/tai_ui.h"\n#endif')
    pages = replace_once(pages, 'void ShowSettings(BrowserWindowInterface* browser) {\n',
        'void ShowSettings(BrowserWindowInterface* browser) {\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '  if (auto* sidebar = sidebar::SpaceNavigationView::From(browser)) {\n'
        '    sidebar->PerformShortcut("settings"); return;\n'
        '  }\n#endif\n')
    pages = replace_once(pages, 'void ShowImportDialog(BrowserWindowInterface* browser) {\n',
        'void ShowImportDialog(BrowserWindowInterface* browser) {\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '  if (sidebar::OpenTaiImportDialog(browser->GetProfile())) return;\n'
        '#endif\n')
    pages = replace_once(pages,
        'void ShowHelpImpl(BrowserWindowInterface* browser,\n'
        '                  Profile* profile,\n'
        '                  HelpSource source) {\n',
        'void ShowHelpImpl(BrowserWindowInterface* browser,\n'
        '                  Profile* profile,\n'
        '                  HelpSource source) {\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '  if (sidebar::OpenTaiHelpDialog(profile)) return;\n'
        '#endif\n')
    controller = upstream(COMMAND_CONTROLLER).decode()
    controller = replace_once(controller, '#include "chrome/browser/ui/browser_command_controller.h"',
        '#include "chrome/browser/ui/browser_command_controller.h"\n'
        '#include "sidebar_browser/branding.h"\n'
        '#if defined(TOOLKIT_VIEWS)\n#include "sidebar_browser/space_navigation_view.h"\n#endif')
    controller = replace_once(controller, 'bool BrowserCommandController::IsCommandEnabled(int id) const {',
        'bool BrowserCommandController::IsCommandEnabled(int id) const {\n'
        '  if (sidebar::HasTaiBrand()) {\n'
        '    if (sidebar::IsBrowserAccountCommand(id)) return false;\n'
        '    switch (id) {\n'
        '      case IDC_BOOKMARK_THIS_TAB:\n'
        '      case IDC_BOOKMARK_ALL_TABS:\n'
        '      case IDC_SHOW_BOOKMARK_BAR:\n'
        '      case IDC_SHOW_BOOKMARK_MANAGER:\n'
        '      case IDC_SHOW_BOOKMARK_SIDE_PANEL:\n'
        '      case IDC_FOCUS_BOOKMARKS:\n'
        '      case IDC_BOOKMARK_BAR_SUBMENU_ALWAYS_SHOW:\n'
        '      case IDC_BOOKMARK_BAR_SUBMENU_ALWAYS_HIDE:\n'
        '      case IDC_BOOKMARK_BAR_SUBMENU_ONLY_ON_NTP:\n'
        '        return false;\n'
        '    }\n'
        '  }')
    controller = replace_once(controller, '    case IDC_OPTIONS:\n',
        '    case IDC_OPTIONS:\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '      if (auto* sidebar = sidebar::SpaceNavigationView::From(browser_)) {\n'
        '        sidebar->PerformShortcut("settings"); break;\n'
        '      }\n#endif\n')
    commands = upstream(COMMANDS).decode()
    commands = replace_once(commands, '#include "chrome/browser/ui/browser_commands.h"',
        '#include "chrome/browser/ui/browser_commands.h"\n'
        '#if defined(TOOLKIT_VIEWS)\n'
        '#include "sidebar_browser/space_navigation_view.h"\n'
        '#endif')
    for signature, call in (
        ('void CloseTab(BrowserWindowInterface* browser) {', 'CloseActiveTab()'),
        ('void SelectNextTab(BrowserWindowInterface* browser,\n                   TabStripUserGestureDetails gesture_detail) {', 'SelectRelativeTab(1)'),
        ('void SelectPreviousTab(BrowserWindowInterface* browser,\n                       TabStripUserGestureDetails gesture_detail) {', 'SelectRelativeTab(-1)'),
        ('void SelectNumberedTab(BrowserWindowInterface* browser,\n                       int index,\n                       TabStripUserGestureDetails gesture_detail) {', 'SelectNumberedTab(index)'),
        ('void SelectLastTab(BrowserWindowInterface* browser,\n                   TabStripUserGestureDetails gesture_detail) {', 'SelectNumberedTab(-1)'),
    ):
        commands = replace_once(commands, signature, signature + '\n#if defined(TOOLKIT_VIEWS)\n'
            '  if (auto* sidebar = sidebar::SpaceNavigationView::From(browser);\n'
            '      sidebar && sidebar->' + call + ') return;\n#endif')
    commands = replace_once(commands,
        '  if (WindowFeatureController::From(browser)->SupportsWindowFeature(\n          WindowFeatureController::WindowFeature::kFeatureTabStrip)) {\n    return *AddAndReturnTabAt(browser, GURL(), -1,',
        '#if defined(TOOLKIT_VIEWS)\n  const GURL product_new_tab = sidebar::ProductNewTabURL(browser);\n#else\n  const GURL product_new_tab;\n#endif\n'
        '  if (WindowFeatureController::From(browser)->SupportsWindowFeature(\n          WindowFeatureController::WindowFeature::kFeatureTabStrip)) {\n    return *AddAndReturnTabAt(browser, product_new_tab, -1,')
    restore = upstream(RESTORE).decode()
    restore = replace_once(restore, '#include "chrome/browser/ui/browser_tabrestore.h"',
        '#include "chrome/browser/ui/browser_tabrestore.h"\n'
        '#if defined(TOOLKIT_VIEWS)\n#include "sidebar_browser/sidebar_session.h"\n#endif')
    restore = replace_once(restore,
        '  glic::RestoreGlicStateFromExtraData(web_contents.get(), extra_data);',
        '#if defined(TOOLKIT_VIEWS)\n'
        '  sidebar::RestoreOrganization(web_contents.get(), extra_data);\n#endif\n'
        '  glic::RestoreGlicStateFromExtraData(web_contents.get(), extra_data);')
    session_restore = upstream(SESSION_RESTORE).decode()
    session_restore = replace_once(session_restore,
        '#include "build/build_config.h"',
        '#include "build/build_config.h"\n'
        '#if BUILDFLAG(IS_MAC)\n#include "sidebar_browser/host/native_host.h"\n#endif')
    session_restore = replace_once(session_restore,
        '                           &new_group_ids, did_show_browser);\n'
        '      // Newly created browsers should be shown',
        '                           &new_group_ids, did_show_browser);\n'
        '#if BUILDFLAG(IS_MAC)\n'
        '      if (is_normal_window && (!initial_tab_count || browser != browser_) &&\n'
        '          base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '        const auto key = window->extra_data.find(sidebar::NativeHost::kAgentWindowSessionKey);\n'
        '        if (key != window->extra_data.end())\n'
        '          sidebar::NativeHost::RestoreAgentWindow(*browser, key->second);\n'
        '      }\n'
        '#endif\n'
        '      // Newly created browsers should be shown')
    session_service = upstream(SESSION_SERVICE).decode()
    session_service = replace_once(session_service, '#include "build/build_config.h"',
        '#include "build/build_config.h"\n'
        '#if BUILDFLAG(IS_MAC)\n#include "sidebar_browser/host/native_host.h"\n#endif')
    session_service = replace_once(session_service,
        '  if (!BrowserInitState::From(browser)->create_params().app_name.empty()) {',
        '#if BUILDFLAG(IS_MAC)\n'
        '  const auto key = sidebar::NativeHost::AgentWindowKeyFor(*browser);\n'
        '  if (!key.empty()) {\n'
        '    command_storage_manager()->AppendRebuildCommand(\n'
        '        sessions::CreateAddWindowExtraDataCommand(\n'
        '            browser->GetSessionID(), sidebar::NativeHost::kAgentWindowSessionKey, key));\n'
        '  }\n'
        '#endif\n'
        '  if (!BrowserInitState::From(browser)->create_params().app_name.empty()) {')
    context = upstream(CONTEXT).decode()
    context = replace_once(context, '#include "chrome/browser/ui/browser_live_tab_context.h"',
        '#include "chrome/browser/ui/browser_live_tab_context.h"\n'
        '#if defined(TOOLKIT_VIEWS)\n#include "sidebar_browser/sidebar_session.h"\n#endif')
    context = replace_once(context, '  return extra_data;',
        '#if defined(TOOLKIT_VIEWS)\n'
        '  sidebar::AppendOrganization(tab_strip_model_->GetWebContentsAt(index), &extra_data);\n'
        '#endif\n  return extra_data;')
    webui = upstream(WEBUI).decode()
    webui = replace_once(webui,
        '#include "chrome/browser/ui/webui/chrome_web_ui_configs.h"',
        '#include "chrome/browser/ui/webui/chrome_web_ui_configs.h"\n'
        '#include "sidebar_browser/tai_ui.h"')
    webui = replace_once(webui,
        '  auto& map = content::WebUIConfigMap::GetInstance();',
        '  auto& map = content::WebUIConfigMap::GetInstance();\n'
        '  map.AddWebUIConfig(std::make_unique<sidebar::TaiUIConfig>());')
    untrusted = upstream(UNTRUSTED).decode()
    untrusted = replace_once(untrusted, '#include "content/public/browser/webui_config_map.h"',
        '#include "content/public/browser/webui_config_map.h"\n#include "sidebar_browser/host/surface_ui.h"')
    untrusted = replace_once(untrusted, 'void RegisterChromeUntrustedWebUIConfigs() {',
        'void RegisterChromeUntrustedWebUIConfigs() {\n  content::WebUIConfigMap::GetInstance().AddUntrustedWebUIConfig(std::make_unique<sidebar::SurfaceUIConfig>());')
    panel_ids = upstream(PANEL_IDS).decode()
    panel_ids = replace_once(panel_ids, '  /* Extensions (nothing more should be added below here) */',
        '  V(kTai, std::nullopt, "TAi")                                             \\\n'
        '  /* Extensions (nothing more should be added below here) */')
    panel_impl = upstream(PANEL_ID_IMPL).decode()
    panel_impl = replace_once(panel_impl, '#include "chrome/browser/ui/side_panel/side_panel_entry_id.h"',
        '#include "chrome/browser/ui/side_panel/side_panel_entry_id.h"\n'
        '#include "ui/actions/actions.h"')
    panel_impl = replace_once(panel_impl, '    SidePanelEntryId id) {\n  switch (id) { SIDE_PANEL_ENTRY_IDS(SIDE_PANEL_ACTION_ID_CASE_STATEMENT) }',
        '    SidePanelEntryId id) {\n  if (id == SidePanelEntryId::kTai) return actions::ActionIdMap::CreateActionId("tai.browser.panel").first;\n'
        '  switch (id) { SIDE_PANEL_ENTRY_IDS(SIDE_PANEL_ACTION_ID_CASE_STATEMENT) }')
    binders = upstream(BINDERS).decode()
    binders = replace_once(binders, '#include "chrome/browser/chrome_browser_interface_binders.h"',
        '#include "chrome/browser/chrome_browser_interface_binders.h"\n'
        '#include "content/public/browser/security_principal.h"\n'
        '#include "content/public/browser/site_instance.h"\n'
        '#include "services/network/public/mojom/p2p.mojom.h"')
    binders = replace_once(binders,
        '    content::RenderFrameHost* render_frame_host) {\n',
        '    content::RenderFrameHost* render_frame_host) {\n'
        '  // TAi opaque components have no peer-to-peer network capability.\n'
        '  // RegisterBrowserInterfaceBindersForFrame is the embedder override;\n'
        '  // use the isolated WebUI principal before its first commit.\n'
        '  const auto& tai_principal = render_frame_host->GetSiteInstance()->GetSecurityPrincipal();\n'
        '  if (tai_principal.SchemeIs("chrome-untrusted") && tai_principal.GetHost() == "tai-content") {\n'
        '    map->Add<network::mojom::P2PSocketManager>(\n'
        '        [](content::RenderFrameHost*, mojo::PendingReceiver<network::mojom::P2PSocketManager>) {});\n'
        '  }\n')
    binders = replace_once(binders,
        '  predictors::NetworkHintsHandlerImpl::Create(frame_host, std::move(receiver));',
        '  const auto& tai_principal = frame_host->GetSiteInstance()->GetSecurityPrincipal();\n'
        '  if (tai_principal.SchemeIs("chrome-untrusted") && tai_principal.GetHost() == "tai-content") return;\n'
        '  predictors::NetworkHintsHandlerImpl::Create(frame_host, std::move(receiver));')
    focus = upstream(FOCUS).decode()
    focus = replace_once(focus, '#include "base/check_deref.h"', '#include "base/check_deref.h"\n#include "base/command_line.h"')
    focus = replace_once(focus, '    const GURL& virtual_url = entry->GetVirtualURL();',
        '    const GURL& virtual_url = entry->GetVirtualURL();\n'
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '        !virtual_url.SchemeIs(content::kViewSourceScheme) &&\n'
        '        url == GURL("chrome://tai/home.html")) return true;')
    omnibox = upstream(OMNIBOX).decode()
    omnibox = replace_once(omnibox, '#include "chrome/browser/ui/toolbar/chrome_location_bar_model_delegate.h"',
        '#include "chrome/browser/ui/toolbar/chrome_location_bar_model_delegate.h"\n#include "base/command_line.h"')
    omnibox = replace_once(omnibox, '  const auto is_ntp = [](const GURL& url) {\n',
        '  const auto is_ntp = [](const GURL& url) {\n'
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '        url == GURL("chrome://tai/home.html")) return true;\n')
    themed_path = 'chrome/browser/ui/views/frame/themed_background.cc'
    themed = upstream(themed_path).decode()
    themed = replace_once(themed, '#include "chrome/browser/ui/views/frame/themed_background.h"',
        '#include "chrome/browser/ui/views/frame/themed_background.h"\n#include "sidebar_browser/space_navigation_view.h"\n#include "base/command_line.h"')
    themed = replace_once(themed, '  bool painted =\n',
        '  if (theme_choice == kToolbarTheme ? sidebar::PaintPageChrome(canvas, view, browser_view)\n'
        '                                    : sidebar::PaintProductBackdrop(canvas, view, browser_view)) return;\n  bool painted =\n')
    themed = replace_once(themed, '  std::pair<int, ui::ColorId> theme_choice_info =\n',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    if (theme_choice == kToolbarTheme) return sidebar::PageChromeColor(browser_view);\n'
        '    return std::nullopt;\n  }\n'
        '  std::pair<int, ui::ColorId> theme_choice_info =\n')
    main_bg_path = 'chrome/browser/ui/views/frame/main_background_region_view.cc'
    main_bg = upstream(main_bg_path).decode()
    main_bg = replace_once(main_bg, '#include "chrome/browser/ui/views/frame/main_background_region_view.h"',
        '#include "chrome/browser/ui/views/frame/main_background_region_view.h"\n#include "base/command_line.h"\n#include "sidebar_browser/space_navigation_view.h"')
    main_bg = replace_once(main_bg, '  SetBackground(std::make_unique<CustomCornersBackground>(',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '    SetBackground(sidebar::CreateSidebarBackground(*this, browser_view));\n    return;\n  }\n'
        '  SetBackground(std::make_unique<CustomCornersBackground>(')
    mac_path = 'chrome/browser/ui/views/frame/browser_frame_view_mac.mm'
    mac = upstream(mac_path).decode()
    mac = replace_once(mac, '#include "chrome/browser/ui/views/frame/browser_frame_view_mac.h"',
        '#include "chrome/browser/ui/views/frame/browser_frame_view_mac.h"\n#include "sidebar_browser/space_navigation_view.h"\n#include "base/command_line.h"')
    mac = replace_once(mac, '  if (is_glass_frame_eligible_) {\n    // In glass mode,',
        '  if (sidebar::PaintProductBackdrop(canvas, this, GetBrowserView())) return;\n'
        '  if (is_glass_frame_eligible_) {\n    // In glass mode,')
    mac = replace_once(mac, '  if (caption_button_placeholder_container_) {\n    caption_button_placeholder_container_->SetBackground(',
        '  if (caption_button_placeholder_container_) {\n'
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '      caption_button_placeholder_container_->SetBackground(sidebar::CreateSidebarBackground(*caption_button_placeholder_container_, *GetBrowserView()));\n'
        '      return;\n    }\n'
        '    caption_button_placeholder_container_->SetBackground(')
    mac = replace_once(mac, '  if (browser_view->GetIsWebAppType()) {\n',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser") &&\n'
        '      browser_view->browser()->GetType() == BrowserWindowInterface::Type::TYPE_NORMAL) {\n'
        '    AddChildView(sidebar::CreateSidebarToggle(browser_view->browser()));\n  }\n'
        '  if (browser_view->GetIsWebAppType()) {\n')
    mac = replace_once(mac, '  int super_component = BrowserFrameView::NonClientHitTest(point);',
        '  if (auto* toggle = GetViewByID(0x534254); toggle && toggle->GetVisible() &&\n'
        '      toggle->bounds().Contains(point)) return HTCLIENT;\n'
        '  int super_component = BrowserFrameView::NonClientHitTest(point);')
    mac = replace_once(mac, '  LayoutSuperclass<BrowserFrameView>(this);\n',
        '  LayoutSuperclass<BrowserFrameView>(this);\n'
        '  if (auto* toggle = GetViewByID(0x534254)) {\n'
        '    ReorderChildView(toggle, children().size() - 1);\n'
        '    if (toggle->layer() && toggle->layer()->parent())\n'
        '      toggle->layer()->parent()->StackAtTop(toggle->layer());\n'
        '    const auto caption = GetCaptionButtonBounds().bounds;\n'
        '    int center_y = caption.CenterPoint().y() + TopUIFullscreenYOffset();\n'
        '    if (auto* toolbar = GetBrowserView()->toolbar(); toolbar && toolbar->height() > 0) {\n'
        '      gfx::Point center(0, toolbar->height() / 2);\n'
        '      views::View::ConvertPointToTarget(toolbar, this, &center);\n'
        '      center_y = center.y();\n'
        '    }\n'
        '    toggle->SetBounds(CaptionButtonsOnLeadingEdge() ? caption.right() + 10 : caption.x() - 42,\n'
        '                      center_y - 16, 32, 32);\n'
        '  }\n')
    mac = replace_once(mac, '  // Mirror for when caption buttons are on the "wrong" side.\n',
        '  if (GetViewByID(0x534254)) {\n'
        '    if (CaptionButtonsOnLeadingEdge()) result.margins.set_right(result.margins.right() + 42);\n'
        '    else result.margins.set_left(result.margins.left() + 42);\n  }\n'
        '  // Mirror for when caption buttons are on the "wrong" side.\n')
    panel_path = 'chrome/browser/ui/views/side_panel/side_panel.cc'
    panel = upstream(panel_path).decode()
    panel = replace_once(panel, '#include "chrome/browser/ui/views/side_panel/side_panel.h"',
        '#include "chrome/browser/ui/views/side_panel/side_panel.h"\n'
        '#include "base/command_line.h"\n#include "sidebar_browser/host/native_panel.h"\n#include "ui/color/color_id.h"')
    panel = replace_once(panel, '  const base::DictValue& overrides =\n',
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser"))\n'
        '    return SidePanel::HorizontalAlignment::kRight;\n'
        '  const base::DictValue& overrides =\n')
    panel = replace_once(panel, '      ThemedBackground::PaintBackground(canvas, view, browser_view_);',
        '    if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) {\n'
        '      canvas->FillRect(view->GetLocalBounds(), view->GetColorProvider()->GetColor(ui::kColorSysSurface));\n'
        '    } else {\n      ThemedBackground::PaintBackground(canvas, view, browser_view_);\n    }')
    panel = replace_once(panel, 'SidePanel::SidePanel(BrowserView* browser_view) : browser_view_(browser_view) {',
        'SidePanel::SidePanel(BrowserView* browser_view) : browser_view_(browser_view) {\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser"))\n'
        '    SetBackground(sidebar::CreateUnifiedPanelBackground(*browser_view));')
    ext_toolbar_path = 'chrome/browser/ui/views/extensions/extensions_toolbar_desktop.cc'
    ext_toolbar = upstream(ext_toolbar_path).decode()
    ext_toolbar = replace_once(ext_toolbar, '#include "chrome/browser/ui/views/extensions/extensions_toolbar_desktop.h"',
        '#include "chrome/browser/ui/views/extensions/extensions_toolbar_desktop.h"\n#include "base/command_line.h"')
    ext_toolbar = replace_once(ext_toolbar, 'void ExtensionsToolbarDesktop::UpdateSidePanelState(bool is_active) {',
        'void ExtensionsToolbarDesktop::UpdateSidePanelState(bool is_active) {\n'
        '  if (base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")) is_active = false;')
    reload_sources = {}
    for path, cls, view, menu in ((RELOAD, 'ReloadButton', 'sidebar::ReloadBrowserForView(this)', 'menu_model'),
                                  (WEBUI_RELOAD, 'WebUIReloadControl', 'delegate_->GetBrowser()', 'menu_model_')):
        source = upstream(path).decode()
        include = '#include "' + path[:-3] + '.h"'
        source = replace_once(source, include, include + '\n#include "sidebar_browser/reload_menu.h"\n#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"')
        source = replace_once(source,
            f'  {menu}->AddItemWithStringId(IDC_RELOAD_CLEARING_CACHE,\n'
            '                                  IDS_RELOAD_MENU_EMPTY_AND_HARD_RELOAD_ITEM);' if path == RELOAD else
            f'  {menu}->AddItemWithStringId(IDC_RELOAD_CLEARING_CACHE,\n'
            '                                   IDS_RELOAD_MENU_EMPTY_AND_HARD_RELOAD_ITEM);',
            f'  if (sidebar::HasProductReloadMenu()) {{\n'
            f'    sidebar::AddCookieReloadMenuItem({menu}.get(), {view} ? {view}->GetProfile() : nullptr);\n'
            '  } else {\n'
            f'    {menu}->AddItemWithStringId(IDC_RELOAD_CLEARING_CACHE,\n'
            '        IDS_RELOAD_MENU_EMPTY_AND_HARD_RELOAD_ITEM);\n  }')
        source = replace_once(source, f'bool {cls}::IsCommandIdEnabled(int command_id) const {{\n',
            f'bool {cls}::IsCommandIdEnabled(int command_id) const {{\n'
            '  if (command_id == sidebar::kReloadClearingSiteCookies)\n'
            f'    return sidebar::CanReloadClearingSiteCookies({view});\n')
        source = replace_once(source, f'void {cls}::ExecuteCommand(int command_id, int event_flags) {{\n',
            f'void {cls}::ExecuteCommand(int command_id, int event_flags) {{\n'
            f'  if (sidebar::HandleCookieReloadCommand({view}, command_id)) return;\n')
        if path == RELOAD:
            source = replace_once(source, 'return is_dev_tools_connected_ && (visible_mode_ == Mode::kReload);',
                'return (sidebar::HasProductReloadMenu() || is_dev_tools_connected_) && (visible_mode_ == Mode::kReload);')
        else:
            source = replace_once(source, '  if (is_dev_tools_connected_) {',
                '  if ((sidebar::HasProductReloadMenu() || is_dev_tools_connected_) && mode_ == Mode::kReload) {')
            source = replace_once(source, '    menu_runner_->RunMenuAt(widget, nullptr, screen_rect,',
                '    if (sidebar::HasProductReloadMenu()) {\n'
                '      if (menu_runner_->IsRunning()) return true;\n'
                '      // The native runner caches enabled state when created.\n'
                '      // Rebuild at open so navigation can enable/disable the item.\n'
                '      menu_runner_ = std::make_unique<views::MenuRunner>(\n'
                '          menu_model_.get(), views::MenuRunner::HAS_MNEMONICS,\n'
                '          base::BindRepeating(&WebUIReloadControl::UpdateState,\n'
                '                              base::Unretained(this)));\n'
                '    }\n'
                '    menu_runner_->RunMenuAt(widget, nullptr, screen_rect,')
            source = replace_once(source, '      is_dev_tools_connected_ && (mode_ == ReloadControl::Mode::kReload);',
                '      (sidebar::HasProductReloadMenu() || is_dev_tools_connected_) && (mode_ == ReloadControl::Mode::kReload);')
        reload_sources[path] = source.encode()
    omnibox = replace_once(omnibox, '#include "base/command_line.h"',
        '#include "base/command_line.h"\n#include "sidebar_browser/internal_urls.h"')
    omnibox = replace_once(omnibox,
        '  return AutocompleteInput::FormattedStringWithEquivalentMeaning(\n'
        '      url, formatted_url, ChromeAutocompleteSchemeClassifier(GetProfile()),\n'
        '      nullptr);',
        '  auto formatted = AutocompleteInput::FormattedStringWithEquivalentMeaning(\n'
        '      url, formatted_url, ChromeAutocompleteSchemeClassifier(GetProfile()), nullptr);\n'
        '  return base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser")\n'
        '      ? sidebar::DisplayTaiURL(url, std::move(formatted)) : formatted;')
    return {**settings_overlay.changes(upstream, replace_once), **global_search_changes(), OMNIBOX_INPUT: omni_input.encode(), SCHEME_CLASSIFIER: scheme.encode(), LOCATION_IDENTITY: identity.encode(), PAGES: pages.encode(), COMMAND_CONTROLLER: controller.encode(), KEY_DISPATCH: key_dispatch.encode(), COCOA_TEXT_INPUT: cocoa_text.encode(), **reload_sources, ext_toolbar_path: ext_toolbar.encode(), panel_path: panel.encode(), themed_path: themed.encode(), main_bg_path: main_bg.encode(), mac_path: mac.encode(), OMNIBOX: omnibox.encode(), FOCUS: focus.encode(), BINDERS: binders.encode(), PANEL_IDS: panel_ids.encode(), PANEL_ID_IMPL: panel_impl.encode(), UNTRUSTED: untrusted.encode(), BUILD: build.encode(), WEBUI: webui.encode(), REGION: region.encode(), STATE: state.encode(),
            COMMANDS: commands.encode(), RESTORE: restore.encode(), SESSION_RESTORE: session_restore.encode(), SESSION_SERVICE: session_service.encode(), STARTUP_INFOBARS: startup_infobars.encode(), default_delegate_path: default_delegate.encode(), default_manager_path: default_manager.encode(), CONTEXT: context.encode(), TOOLBAR: toolbar.encode(), LOCATION: location.encode(), WIDGET: widget.encode(), BROWSER_VIEW: browser_view.encode(), MULTI_CONTENTS: multi_contents.encode()}


def stage():
    lock = json.loads((ROOT / 'chromium.lock.json').read_text())
    revision = subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
    if revision != lock['revision']:
        raise ValueError('Chromium is not at the reviewed baseline')
    planned = changes()
    STAGE.mkdir(parents=True, exist_ok=True)
    records = {}
    patch = []
    added = settings_overlay.new_files()
    for name, data in {**planned, **added}.items():
        path = SOURCE / name
        original = b'' if name in added else upstream(name)
        live = path.read_bytes() if path.exists() or name in planned else b''
        if live not in (original, data):
            previous = ROOT / 'research/local/native-overlay-installed.json'
            installed = json.loads(previous.read_text()) if previous.exists() else {}
            if sha(live) != installed.get('files', {}).get(name, {}).get('after'):
                raise ValueError('Preserve unrelated edits in ' + name)
        target = STAGE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
        records[name] = {'before': sha(original), 'after': sha(data)}
        patch.extend(difflib.unified_diff(
            original.decode().splitlines(True), data.decode().splitlines(True),
            fromfile='/dev/null' if name in added else 'a/' + name,
            tofile='b/' + name))
    own_data = {name: own_source(name).read_bytes() for name in OWN_FILES}
    interaction = own_data['host/page_interaction.js'].decode('utf-8')
    if ')TAI_CONTROL"' in interaction:
        raise ValueError('Page interaction resource conflicts with raw string delimiter')
    own_data['host/page_interaction_resources.h'] = (
        '#pragma once\nnamespace sidebar {\ninline constexpr char kPageInteraction[] = R"TAI_CONTROL('
        + interaction + ')TAI_CONTROL";\n}\n').encode('utf-8')
    # Generated immutable resources are built from checked-in frontend sources.
    header = '#ifndef SIDEBAR_BROWSER_TAI_RESOURCES_H_\n#define SIDEBAR_BROWSER_TAI_RESOURCES_H_\nnamespace sidebar::resources {\n'
    for name, symbol in [('i18n.js', 'kI18nJs'), ('shortcuts.js', 'kShortcutsJs'), ('shortcuts.css', 'kShortcutsCss'), ('tai.html', 'kHtml'), ('tai.css', 'kCss'), ('tai.js', 'kJs'), ('host-panel.js', 'kHostJs'), ('settings-agent.js', 'kSettingsAgentJs'), ('agent-setup.js','kAgentSetupJs'), ('agent-setup.css','kAgentSetupCss'), ('panel.html','kPanelHtml'), ('panel.css','kPanelCss'), ('panel-shell.js','kPanelJs'),('library.html','kLibraryHtml'),('library.css','kLibraryCss'),('home.html','kHomeHtml'),('home.css','kHomeCss'),('home.js','kHomeJs'), ('help.html', 'kHelpHtml'), ('help.css', 'kHelpCss'), ('help.js', 'kHelpJs'),('welcome.html','kWelcomeHtml'),('welcome.css','kWelcomeCss'),('welcome.js','kWelcomeJs'),('components.html','kComponentsHtml'),('components.css','kComponentsCss')]:
        body = own_data['webui/' + name].decode('utf-8')
        if ')TAI_RESOURCE"' in body:
            raise ValueError('Resource conflicts with C++ raw string delimiter')
        header += 'inline constexpr char ' + symbol + '[] = R"TAI_RESOURCE(' + body + ')TAI_RESOURCE";\n'
    header += '}\n#endif\n'
    own_data['tai_resources.h'] = header.encode('utf-8')
    brand_inputs = {}
    header = '#ifndef SIDEBAR_BROWSER_BRAND_RESOURCES_H_\n#define SIDEBAR_BROWSER_BRAND_RESOURCES_H_\nnamespace sidebar::brand_resources {\n'
    for symbol, path in BRAND_ASSETS.items():
        data = (ROOT / path).read_bytes()
        brand_inputs[path] = sha(data)
        encoded = base64.b64encode(data).decode('ascii')
        header += 'inline constexpr char '+symbol+'[] =\n' + ''.join('"'+encoded[i:i+120]+'"\n' for i in range(0,len(encoded),120)) + ';\n'
    own_data['brand_resources.h'] = (header+'}\n#endif\n').encode()

    bundles = bundle_host_assets()
    header = '#ifndef SIDEBAR_BROWSER_HOST_BUNDLES_H_\n#define SIDEBAR_BROWSER_HOST_BUNDLES_H_\nnamespace sidebar::host_bundles {\n'
    for name, symbol in [('reader','kReader'),('pomodoro','kPomodoro'),('bootstrap','kBootstrap'),('library','kLibrary'),('components','kComponents'),('welcome-import','kWelcomeImport')]:
        body = bundles[name]
        if ')TAI_BUNDLE"' in body: raise ValueError('Bundle conflicts with raw string delimiter')
        header += 'inline constexpr char '+symbol+'[] = R"TAI_BUNDLE('+body+')TAI_BUNDLE";\n'
    own_data['host_bundles.h'] = (header+'}\n#endif\n').encode()

    for name, data in own_data.items():
        path = 'sidebar_browser/' + name
        target = STAGE / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        live = SOURCE / path
        previous = ROOT / 'research/local/native-overlay-installed.json'
        if live.exists() and live.read_bytes() != data:
            installed = json.loads(previous.read_text()) if previous.exists() else {}
            if sha(live.read_bytes()) != installed.get('files', {}).get(path, {}).get('after'):
                raise ValueError('Preserve unrelated overlay file ' + path)
        records[path] = {'after': sha(data)}
    (STAGE / 'upstream.patch').write_text(''.join(patch))
    manifest = {'revision': revision, 'files': records,
                'purpose': 'independent Spaces with saved folders and temporary tabs',
                'upstream_files_changed': len(planned),
                'resource_inputs': {**json.loads((ROOT / 'research/local/host-bundles/manifest.json').read_text())['inputs'], **brand_inputs}}
    (STAGE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


def apply():
    # Call only while holding the shared preparation lock; the build pipeline
    # does that after the baseline has completed or deliberately stopped.
    manifest = stage()
    for name, record in manifest['files'].items():
        target = SOURCE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        data = (STAGE / name).read_bytes()
        if sha(data) != record['after']:
            raise ValueError('Staged overlay changed while applying')
        # Keep timestamps for identical inputs so an incremental run does not
        # recompile every UI adapter just because it reapplied the overlay.
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
    (ROOT / 'research/local/native-overlay-installed.json').write_text(
        json.dumps(manifest, indent=2) + '\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.apply:
        raise SystemExit('Use build_product.py; applying requires its build lock')
    result = stage()
    print(json.dumps({'revision': result['revision'],
                      'upstream_files_changed': result['upstream_files_changed'],
                      'stage': str(STAGE)}, indent=2))


if __name__ == '__main__':
    main()
