"""Product-only settings/identity changes against the pinned upstream UI."""
SETTINGS_UI = 'chrome/browser/ui/webui/settings/settings_ui.cc'
PAGE_INFO = 'chrome/browser/ui/views/page_info/page_info_bubble_view.cc'
APP_MENU = 'chrome/browser/ui/toolbar/app_menu_model.cc'
ACTION_APP_MENU = 'chrome/browser/ui/views/app_menu/action_app_menu_manager.cc'
BOOKMARK_BAR = 'chrome/browser/ui/bookmarks/bookmark_bar_controller.cc'
BOOKMARK_STAR = 'chrome/browser/ui/views/bookmarks/bookmark_page_action_controller.cc'
LOCATION_ICON = 'chrome/browser/ui/views/location_bar/location_icon_view.cc'
AVATAR = 'chrome/browser/ui/views/toolbar/avatar_toolbar_button_interface.cc'
IMPORT_DATA_HANDLER = 'chrome/browser/ui/webui/settings/import_data_handler.cc'
MAIN_MENU = 'chrome/browser/ui/cocoa/main_menu_builder.mm'
HISTORY_MENU = 'chrome/browser/ui/cocoa/history_menu_bridge.mm'
APP_CONTROLLER = 'chrome/browser/app_controller_mac.mm'
BROWSER_MAC = 'chrome/browser/ui/browser_mac.cc'
PEOPLE = 'chrome/browser/resources/settings/people_page/people_page.ts'
SHELL = 'chrome/browser/resources/settings/settings_ui/settings_ui.html'
SHELL_TS = 'chrome/browser/resources/settings/settings_ui/settings_ui.ts'
MENU = 'chrome/browser/resources/settings/settings_menu/settings_menu.html'
ABOUT = 'chrome/browser/resources/settings/about_page/about_page.html.ts'
ABOUT_STYLE = 'chrome/browser/resources/settings/about_page/about_page.css'
ABOUT_ELEMENT = 'chrome/browser/resources/settings/about_page/about_page.ts'
ABOUT_TAI = 'chrome/browser/resources/settings/about_page/tai_about_page.html.ts'
SETTINGS_BUILD = 'chrome/browser/resources/settings/BUILD.gn'
ROUTER = 'chrome/browser/resources/settings/router.ts'
NATIVE_FILES = (SETTINGS_UI, PAGE_INFO, APP_MENU, LOCATION_ICON, AVATAR,
                IMPORT_DATA_HANDLER, MAIN_MENU, HISTORY_MENU, APP_CONTROLLER, BROWSER_MAC,
                ACTION_APP_MENU, BOOKMARK_BAR, BOOKMARK_STAR)
UPSTREAM_FILES = (*NATIVE_FILES, PEOPLE, SHELL, SHELL_TS, MENU, ABOUT,
                  ABOUT_STYLE, ABOUT_ELEMENT, SETTINGS_BUILD, ROUTER)

# TAi-owned presentation inside Chromium's existing Settings section and Lit
# lifecycle. The non-product template, updater and legal notices stay upstream.
TAI_ABOUT_HTML = '''
    <settings-section page-title="$i18n{aboutPageTitle}">
      <header class="tai-about-header">
        <img id="productLogo" src="$i18n{taiAboutLogo}" width="64" height="64"
            alt="$i18n{aboutProductLogoAlt}">
        <div>
          <h3>TAi Browser</h3>
          <p>$i18n{taiAboutTagline}</p>
        </div>
      </header>
      <div class="tai-about-facts" role="list">
        <div class="tai-about-fact-row" role="listitem"><span class="tai-fact-label">$i18n{taiBuildLabel}</span><div class="tai-fact-value">$i18n{taiDevelopmentBuild}</div></div>
        <div class="tai-about-fact-row" role="listitem"><span class="tai-fact-label">$i18n{taiEngineLabel}</span><div class="tai-fact-value">$i18n{aboutBrowserVersion}</div></div>
        <div class="tai-about-fact-row" role="listitem">
          <span class="tai-fact-label">$i18n{taiUpdatesLabel}</span>
          <div class="tai-fact-value" id="taiUpdateStatus">$i18n{taiManualUpdates}
            <p>$i18n{taiManualUpdatesDescription}</p>
          </div>
        </div>
      </div>
      <p class="tai-system-warning" ?hidden="${!this.obsoleteSystemInfo_.obsolete}"
          role="status">
        $i18n{aboutObsoleteSystem}
        <a href="$i18n{aboutObsoleteSystemURL}" target="_blank" rel="noopener">
          $i18n{learnMore}
        </a>
      </p>
      <nav class="tai-about-links" aria-label="$i18n{aboutPageTitle}">
        <a href="chrome://version/">$i18n{taiVersionDetails}</a>
        <a href="chrome://credits/">$i18n{taiLicenses}</a>
      </nav>
      <details id="taiAcknowledgements" class="tai-acknowledgements">
        <summary>$i18n{taiOpenSource}</summary>
        <div class="tai-legal">
          <p>$i18n{aboutProductCopyright}</p>
          <p>$i18nRaw{aboutProductLicense}</p>
        </div>
      </details>
      <cr-link-row class="hr" @click="${this.onManagementPageClick_}"
          start-icon="${this.managedByIcon_}" label="$i18n{managementPage}"
          role-description="$i18n{subpageArrowRoleDescription}"
          ?hidden="${!this.isManaged_}"></cr-link-row>
    </settings-section>
'''

TAI_ABOUT_CSS = '''
/* TAi product presentation; deliberately scoped to the product template. */
.tai-about-header {
  align-items: center;
  display: flex;
  gap: 20px;
  padding: 32px 28px 28px;
}

.tai-about-header #productLogo {
  flex: none;
  height: 64px;
  margin: 0;
  object-fit: contain;
  width: 64px;
}

.tai-about-header h3 {
  font-size: 24px;
  font-weight: 500;
  line-height: 1.3;
  margin: 0;
}

.tai-about-header p,
.tai-about-facts .tai-fact-value p {
  color: var(--cr-secondary-text-color);
  font-size: 13px;
  line-height: 1.6;
  margin: 6px 0 0;
}

.tai-about-facts { margin: 0;
 padding: 0 28px; }

.tai-about-fact-row {
  border-top: var(--cr-separator-line);
  display: flex;
  gap: 24px;
  padding: 18px 0;
}

.tai-about-facts .tai-fact-label {
  color: var(--cr-secondary-text-color);
  flex: 0 0 28%;
  min-width: 100px;
}

.tai-about-facts .tai-fact-value {
  flex: 1;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tai-about-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  padding: 2px 28px 18px;
}

.tai-about-links a { align-items: center;
 display: inline-flex;
 min-height: 36px; }

.tai-acknowledgements { border-top: var(--cr-separator-line);
 padding: 18px 28px; }

.tai-acknowledgements summary { cursor: pointer;
 line-height: 24px;
 width: fit-content; }

.tai-legal { color: var(--cr-secondary-text-color);
 font-size: 12px;
 line-height: 1.7; }

.tai-legal p { margin: 14px 0 0; }

.tai-system-warning { color: var(--settings-error-color);
 margin: 0 28px 18px; }

.tai-about-links a:focus-visible,
.tai-acknowledgements summary:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--cr-focus-outline-color);
  outline-offset: 4px;
}
@media (max-width: 560px) {
  .tai-about-header { padding: 24px 20px; }
  .tai-about-facts { padding: 0 20px; }
  .tai-about-fact-row {
    flex-direction: column;
    gap: 8px;
  }
  .tai-about-facts .tai-fact-label { flex-basis: auto; }
  .tai-about-links { padding-inline: 20px; }
  .tai-acknowledgements { padding-inline: 20px; }
}
'''

ABOUT_STRINGS = {
    'taiAboutTagline': ('为思考留出空间。', 'Room to think.'),
    'taiBuildLabel': ('构建', 'Build'),
    'taiDevelopmentBuild': ('开发版', 'Development build'),
    'taiEngineLabel': ('浏览器内核', 'Browser engine'),
    'taiUpdatesLabel': ('更新', 'Updates'),
    'taiManualUpdates': ('手动更新', 'Manual updates'),
    'taiManualUpdatesDescription': ('安装新版本即可更新 TAi。', 'Install a newer build to update TAi.'),
    'taiVersionDetails': ('版本详情', 'Version details'),
    'taiLicenses': ('开源许可', 'Open source licenses'),
    'taiOpenSource': ('开源致谢', 'Open source acknowledgements'),
}


def changes(upstream, replace):
    result = {}
    source = upstream(SETTINGS_UI).decode()
    source = replace(source, '#include "chrome/browser/ui/webui/settings/settings_ui.h"',
                     '#include "chrome/browser/ui/webui/settings/settings_ui.h"\n#include "sidebar_browser/branding.h"')
    source = replace(source, '  html_source->AddBoolean("signinAllowed", !profile->IsGuestSession() &&',
        '  const bool tai_browser = sidebar::HasTaiBrand();\n'
        '  html_source->AddBoolean("isTaiBrowser", tai_browser);\n'
        '  html_source->AddString("taiProductLogo", tai_browser\n'
        '      ? "data:image/png;base64," + std::string(sidebar::brand_resources::kProductIcon)\n'
        '      : "chrome://theme/current-channel-logo@1x");\n'
        '  html_source->AddString("taiAboutIcon", tai_browser ? "cr:info" : "cr:chrome-product");\n'
        '  html_source->AddString("taiGeneralIcon", tai_browser ? "cr:settings-filled" : "settings:person");\n'
        '  html_source->AddBoolean("signinAllowed", !tai_browser && !profile->IsGuestSession() &&')
    source = replace(source, '  AddLocalizedStrings(html_source, profile, web_ui->GetWebContents());',
        '  AddLocalizedStrings(html_source, profile, web_ui->GetWebContents());\n'
        '  html_source->AddString("taiAboutLogo", "data:image/png;base64," +\n'
        '      std::string(sidebar::brand_resources::kAboutIcon));\n'
        '  const bool tai_chinese = g_browser_process->GetApplicationLocale().starts_with("zh");\n'
        + ''.join(f'  html_source->AddString("{key}", tai_chinese ? u"{zh}" : u"{en}");\n'
                  for key, (zh, en) in ABOUT_STRINGS.items()) +
        '  if (tai_browser) {\n'
        '    html_source->AddBoolean("replaceSyncPromosWithSignInPromos", true);\n'
        '    const bool zh = g_browser_process->GetApplicationLocale().starts_with("zh");\n'
        '    html_source->AddString("peoplePageTitle", zh ? u"常规" : u"General");\n'
        '    html_source->AddString("importTitle", zh ? u"从其他浏览器导入" : u"Import from another browser");\n'
        '    html_source->AddString("aboutPageTitle", zh ? u"关于 TAI" : u"About TAI");\n'
        '    html_source->AddString("aboutProductTitle", u"TAi Browser");\n'
        '    html_source->AddString("aboutProductLogoAlt", u"TAi Browser");\n'
        '  }')
    result[SETTINGS_UI] = source.encode()

    source = upstream(PEOPLE).decode()
    for signature in ('  protected shouldLinkToProfileRow_(): boolean {',
                      '  protected shouldShowSyncAccountControl_(): boolean {',
                      '  protected shouldLinkToAccountSettingsPage_(): boolean {'):
        source = replace(source, signature, signature + '\n    if (loadTimeData.getBoolean(\'isTaiBrowser\')) return false;')
    source = replace(source, '  protected shouldHideSyncSetupLinkRow_() {',
        "  protected shouldHideSyncSetupLinkRow_() {\n    if (loadTimeData.getBoolean('isTaiBrowser')) return true;")
    source = replace(source, '  protected onImportDataClick_() {',
        "  protected onImportDataClick_() {\n"
        "    if (loadTimeData.getBoolean('isTaiBrowser')) {\n"
        "      chrome.send('openTaiBrowserImport');\n"
        "      return;\n"
        "    }")
    result[PEOPLE] = source.encode()

    source = upstream(IMPORT_DATA_HANDLER).decode()
    source = replace(source, '#include "content/public/browser/web_ui.h"',
        '#include "content/public/browser/web_ui.h"\n'
        '#include "content/public/browser/render_frame_host.h"\n'
        '#include "content/public/browser/web_contents.h"\n'
        '#include "sidebar_browser/tai_ui.h"')
    source = replace(source, '      "importFromBookmarksFile",',
        '      "openTaiBrowserImport",\n'
        '      base::BindRepeating([](content::WebUI* web_ui, const base::ListValue& args) {\n'
        '        auto* frame = web_ui->GetWebContents()->GetPrimaryMainFrame();\n'
        '        if (args.empty() && frame && frame->HasTransientUserActivation())\n'
        '          sidebar::OpenTaiImportDialog(Profile::FromWebUI(web_ui));\n'
        '      }, base::Unretained(web_ui())));\n'
        '  web_ui()->RegisterMessageCallback(\n'
        '      "importFromBookmarksFile",')
    result[IMPORT_DATA_HANDLER] = source.encode()

    source = upstream(SHELL_TS).decode()
    source = replace(source, '      narrow_: {type: Boolean},',
        '      narrow_: {type: Boolean},\n      isTaiBrowser_: {type: Boolean},')
    source = replace(source, '  protected accessor narrow_: boolean = false;',
        '  protected accessor narrow_: boolean = false;\n'
        "  protected accessor isTaiBrowser_: boolean = loadTimeData.getBoolean('isTaiBrowser');")
    result[SHELL_TS] = source.encode()
    source = upstream(SHELL).decode()
    source = replace(source, '    </cr-toolbar>',
        '      ${this.isTaiBrowser_ ? html`\n'
        '        <img slot="product-logo" src="$i18n{taiProductLogo}"\n'
        '            width="28" height="28" style="margin-inline-end:16px" alt="TAi Browser">\n'
        "      ` : ''}\n"
        '    </cr-toolbar>')
    result[SHELL] = source.encode()
    source = upstream(MENU).decode()
    source = replace(source, '<cr-icon icon="cr:chrome-product"></cr-icon>',
        '<cr-icon icon="$i18n{taiAboutIcon}"></cr-icon>')
    source = replace(source, '<cr-icon icon="settings:person"></cr-icon>',
        '<cr-icon icon="$i18n{taiGeneralIcon}"></cr-icon>')
    result[MENU] = source.encode()
    # The upstream template owns its typed DOM IDs. Select the TAi template
    # at the element level so Chromium's static DOM checks remain accurate.
    result[ABOUT] = upstream(ABOUT)
    result[ABOUT_STYLE] = upstream(ABOUT_STYLE) + TAI_ABOUT_CSS.encode()
    source = upstream(SETTINGS_BUILD).decode()
    result[SETTINGS_BUILD] = replace(
        source, '    "about_page/about_page.html.ts",',
        '    "about_page/about_page.html.ts",\n    "about_page/tai_about_page.html.ts",').encode()
    source = upstream(ABOUT_ELEMENT).decode()
    source = replace(source, "import {getHtml} from './about_page.html.js';",
        "import {getHtml} from './about_page.html.js';\n"
        "import {getHtml as getTaiHtml} from './tai_about_page.html.js';")
    source = replace(source, '    return getHtml.bind(this)();',
        "    return (loadTimeData.getBoolean('isTaiBrowser') ? getTaiHtml : getHtml).call(this);")
    source = replace(source, '    this.aboutBrowserProxy_.pageReady();',
        '    this.aboutBrowserProxy_.pageReady();\n'
        "    // The upstream card class has a 550px minimum. Our product layout\n"
        "    // reflows below that width; the override is local to this element.\n"
        "    if (loadTimeData.getBoolean('isTaiBrowser')) this.style.minWidth = '0';")
    source = replace(source, '    this.startListening_();',
        "    if (!loadTimeData.getBoolean('isTaiBrowser')) this.startListening_();")
    result[ABOUT_ELEMENT] = source.encode()

    source = upstream(ROUTER).decode()
    # Keep all upstream Route objects for consumers, but make retired account
    # routes resolve/navigate to General, including direct URLs and old history.
    rule = "loadTimeData.getBoolean('isTaiBrowser') && /^\\/(account|manageProfile|signOut|syncSetup)(\\/|$)/.test("
    source = replace(source, '  getRouteForPath(path: string): Route|null {',
        '  getRouteForPath(path: string): Route|null {\n'
        f'    if ({rule}path)) return this.routes_.PEOPLE;')
    source = replace(source, '    const params = dynamicParameters || new URLSearchParams();',
        f'    if ({rule}route.path)) route = this.routes_.PEOPLE;\n'
        '    const params = dynamicParameters || new URLSearchParams();')
    result[ROUTER] = source.encode()

    source = upstream(LOCATION_ICON).decode()
    source = replace(source, '#include "chrome/browser/ui/views/location_bar/location_icon_view.h"',
        '#include "chrome/browser/ui/views/location_bar/location_icon_view.h"\n#include "sidebar_browser/branding.h"')
    source = replace(source, '  SetImageModel(icon);',
        '  if (sidebar::HasTaiBrand() && !delegate_->IsEditingOrEmpty() &&\n'
        '      delegate_->GetLocationBarModel()->GetURL().SchemeIs("chrome"))\n'
        '    icon = sidebar::ProductLocationIcon();\n'
        '  SetImageModel(icon);')
    result[LOCATION_ICON] = source.encode()
    source = upstream(PAGE_INFO).decode()
    source = replace(source, '#include "chrome/browser/ui/views/page_info/page_info_bubble_view.h"',
        '#include "chrome/browser/ui/views/page_info/page_info_bubble_view.h"\n#include "chrome/browser/profiles/profile.h"\n#include "sidebar_browser/branding.h"\n#include "sidebar_browser/localization.h"')
    source = replace(source, '  SetTitle(text);',
        '  if (sidebar::HasTaiBrand() && web_contents && text == IDS_PAGE_INFO_INTERNAL_PAGE)\n'
        '    SetTitle(sidebar::LocalizedText16(Profile::FromBrowserContext(web_contents->GetBrowserContext()),\n'
        '        "你正在查看受保护的 TAI 内部页面", "You’re viewing a secure TAI page"));\n'
        '  else SetTitle(text);')
    result[PAGE_INFO] = source.encode()
    source = upstream(APP_MENU).decode()
    source = replace(source, '#include "chrome/browser/ui/toolbar/app_menu_model.h"',
        '#include "chrome/browser/ui/toolbar/app_menu_model.h"\n#include "sidebar_browser/branding.h"')
    start = '  sub_menus_.push_back(std::make_unique<ProfileSubMenuModel>(\n'
    source = replace(source, start, '  if (!sidebar::HasTaiBrand()) {\n' + start)
    end = '                      profile_submenu_model->accessible_name());\n  AddSeparator(ui::SPACING_SEPARATOR);'
    source = replace(source, end, end + '\n  }')
    source = replace(source,
        '  if (!browser_->GetProfile()->IsGuestSession()) {\n    bookmark_sub_menu_model_ =',
        '  if (!sidebar::HasTaiBrand() && !browser_->GetProfile()->IsGuestSession()) {\n'
        '    bookmark_sub_menu_model_ =')
    about_item = ('  AddItemWithStringIdAndVectorIcon(this, IDC_ABOUT, IDS_ABOUT,\n'
                  '                                   features::IsRoundedIconsEnabled()\n'
                  '                                       ? vector_icons::kInfoIcon\n'
                  '                                       : vector_icons::kInfoRefreshOldIcon);')
    if source.count(about_item) != 2:
        raise ValueError('About menu structure changed; review upstream')
    source = source.replace(about_item, about_item + '\n'
        '  if (sidebar::HasTaiBrand()) SetLabel(GetIndexOfCommandId(IDC_ABOUT).value(),\n'
        '      g_browser_process->GetApplicationLocale().starts_with("zh") ? u"关于 TAI" : u"About TAI");')
    result[APP_MENU] = source.encode()
    source = upstream(ACTION_APP_MENU).decode()
    source = replace(source, '#include "chrome/browser/ui/views/app_menu/action_app_menu_manager.h"',
        '#include "chrome/browser/ui/views/app_menu/action_app_menu_manager.h"\n#include "sidebar_browser/branding.h"')
    source = replace(source,
        '        if (!profile->IsGuestSession()) {\n          section.AddDynamicSubmenu(\n              kActionBookmarksSubmenu,',
        '        if (!sidebar::HasTaiBrand() && !profile->IsGuestSession()) {\n'
        '          section.AddDynamicSubmenu(\n              kActionBookmarksSubmenu,')
    result[ACTION_APP_MENU] = source.encode()
    for file, signature in (
        (BOOKMARK_BAR, 'bool BookmarkBarController::ShouldShowBookmarkBar() const {'),
        (BOOKMARK_STAR, 'bool BookmarkPageActionController::ShouldShowPageAction() const {'),
    ):
        source = upstream(file).decode()
        header = '#include "' + file.removesuffix('.cc') + '.h"'
        source = replace(source, header, header + '\n#include "sidebar_browser/branding.h"')
        source = replace(source, signature, signature + '\n  if (sidebar::HasTaiBrand()) return false;')
        result[file] = source.encode()
    source = upstream(AVATAR).decode()
    source = replace(source, '#include "chrome/browser/ui/views/toolbar/avatar_toolbar_button_interface.h"',
        '#include "chrome/browser/ui/views/toolbar/avatar_toolbar_button_interface.h"\n#include "sidebar_browser/branding.h"')
    source = replace(source, 'bool AvatarToolbarButtonInterface::CanShowForProfile(Profile* profile) {',
        'bool AvatarToolbarButtonInterface::CanShowForProfile(Profile* profile) {\n'
        '  if (sidebar::HasTaiBrand() && !profile->IsOffTheRecord()) return false;')
    result[AVATAR] = source.encode()
    result.update(mac_menu_changes(upstream, replace))
    return result


def mac_menu_changes(upstream, replace):
    source = upstream(MAIN_MENU).decode()
    source = replace(source, '#include "base/feature_list.h"',
        '#include "base/command_line.h"\n'
        '#include "base/feature_list.h"\n'
        '#include "base/strings/sys_string_conversions.h"\n'
        '#include "sidebar_browser/localization.h"\n'
        '#include "sidebar_browser/shortcuts_mac.h"')
    source = replace(source, 'using Item = internal::MenuItemBuilder;',
        'using Item = internal::MenuItemBuilder;\n\n'
        'bool IsTaiMenu(bool is_pwa) {\n'
        '  return !is_pwa && base::CommandLine::ForCurrentProcess()->HasSwitch("sidebar-browser");\n'
        '}')
    source = replace(source,
        '              Item().is_separator(),\n'
        '              Item(IDS_CLEAR_BROWSING_DATA_MAC)\n'
        '                  .command_id(IDC_CLEAR_BROWSING_DATA)\n'
        '                  .remove_if(is_pwa),',
        '              Item().is_separator().remove_if(IsTaiMenu(is_pwa)),\n'
        '              Item(IDS_CLEAR_BROWSING_DATA_MAC)\n'
        '                  .command_id(IDC_CLEAR_BROWSING_DATA)\n'
        '                  .remove_if(is_pwa || IsTaiMenu(is_pwa)),')
    source = replace(source, '  NSMenuItem* services_item = [item.submenu itemWithTag:-1];',
        '  if (IsTaiMenu(is_pwa)) {\n'
        '    [item.submenu itemWithTag:IDC_IMPORT_SETTINGS].title = base::SysUTF8ToNSString(\n'
        '        sidebar::LocalizedText(nullptr, "从其他浏览器导入…", "Import from Another Browser…"));\n'
        '  }\n'
        '  NSMenuItem* services_item = [item.submenu itemWithTag:-1];')
    for command in ('IDC_SHOW_GOOGLE_LENS_SHORTCUT', 'IDC_SHOW_AI_MODE_OMNIBOX_BUTTON',
                    'IDC_SHOW_SEARCH_TOOLS', 'IDC_TOGGLE_VERTICAL_TABS'):
        source = replace(source, f'.command_id({command}),',
                         f'.command_id({command})\n                  .remove_if(IsTaiMenu(is_pwa)),')
    source = replace(source, '                  .command_id(IDC_SHOW_BOOKMARK_BAR)\n'
        '                  .remove_if(is_pwa),',
        '                  .command_id(IDC_SHOW_BOOKMARK_BAR)\n'
        '                  .remove_if(is_pwa || IsTaiMenu(is_pwa)),')
    # AppController reuses the hidden submenu when swapping Profiles.
    source = replace(source, '          .tag(AppMenuModel::kBookmarksMenuPlaceholder)\n',
        '          .tag(AppMenuModel::kBookmarksMenuPlaceholder)\n'
        '          .set_hidden(IsTaiMenu(is_pwa))\n')
    anchor = 'item.hidden = is_hidden_;'
    if source.count(anchor) != 3:
        raise ValueError('Native menu builder changed; review localization hooks')
    source = source.replace(anchor, anchor + '\n'
        '  sidebar::RegisterTaiMenuLabel(item, string_id_, string_arg1_);')
    source = replace(source, '                  .command_id(IDC_NEW_ISOLATED_WINDOW)\n'
        '                  .remove_if(is_pwa),',
        '                  .command_id(IDC_NEW_ISOLATED_WINDOW)\n'
        '                  .remove_if(is_pwa || IsTaiMenu(is_pwa)),')
    source = replace(source, '                      @"clock.arrow.trianglehead.counterclockwise.rotate.90")\n'
        '                  .remove_if(is_pwa),',
        '                      @"clock.arrow.trianglehead.counterclockwise.rotate.90")\n'
        '                  .remove_if(is_pwa),\n'
        '              Item(IDS_CLEAR_BROWSING_DATA_MAC)\n'
        '                  .command_id(IDC_CLEAR_BROWSING_DATA)\n'
        '                  .remove_if(!IsTaiMenu(is_pwa)),')
    source = replace(source, '    auto item = builder(nsapp, app_delegate, product_name, is_pwa, is_rtl);',
        '    if (IsTaiMenu(is_pwa) && builder == &BuildProfilesMenu) {\n'
        '      [main_menu addItem:sidebar::BuildTaiSpacesMenu()];\n'
        '      continue;\n'
        '    }\n'
        '    const std::u16string name = IsTaiMenu(is_pwa) && builder == &BuildAppMenu\n'
        '        ? u"TAi Browser" : product_name;\n'
        '    auto item = builder(nsapp, app_delegate, name, is_pwa, is_rtl);')
    controller = replace(upstream(APP_CONTROLLER).decode(),
        '  NSMenuItem* profileMenu = [mainMenu itemWithTag:IDC_PROFILE_MAIN_MENU];',
        '  NSMenuItem* profileMenu = [mainMenu itemWithTag:IDC_PROFILE_MAIN_MENU];\n'
        '  if (!profileMenu) return;')
    controller = replace(controller, '#import "chrome/browser/app_controller_mac.h"',
        '#import "chrome/browser/app_controller_mac.h"\n#include "sidebar_browser/shortcuts_mac.h"')
    for resource_id in ('IDS_CLOSE_TAB_MAC', 'IDS_CLOSE_WINDOW_MAC'):
        controller = replace(controller,
            f'  menuItem.title = l10n_util::GetNSStringWithFixup({resource_id});',
            f'  menuItem.title = sidebar::TaiDynamicMenuLabel(menuItem, {resource_id}) ?:\n'
            f'      l10n_util::GetNSStringWithFixup({resource_id});')
    browser = replace(upstream(BROWSER_MAC).decode(), '#include "chrome/browser/ui/browser_mac.h"',
        '#include "chrome/browser/ui/browser_mac.h"\n#include "sidebar_browser/tai_ui.h"')
    browser = replace(browser, 'void OpenImportSettingsDialogWindow(Profile* profile) {',
        'void OpenImportSettingsDialogWindow(Profile* profile) {\n'
        '  if (sidebar::OpenTaiImportDialog(profile)) return;')
    history = replace(upstream(HISTORY_MENU).decode(),
        '    case IDC_SHOW_HISTORY:\n      return !profile_->IsOffTheRecord();',
        '    case IDC_SHOW_HISTORY:\n    case IDC_CLEAR_BROWSING_DATA:\n'
        '      return !profile_->IsOffTheRecord();')
    return {MAIN_MENU: source.encode(), HISTORY_MENU: history.encode(),
            APP_CONTROLLER: controller.encode(), BROWSER_MAC: browser.encode()}

def new_files():
    return {
        ABOUT_TAI: (
            "// SPDX-License-Identifier: BSD-3-Clause\n"
            "import {html} from '//resources/lit/v3_0/lit.rollup.js';\n"
            "import type {SettingsAboutPageElement} from './about_page.js';\n"
            "\nexport function getHtml(this: SettingsAboutPageElement) {\n"
            "  return html`<!--_html_template_start_-->" + TAI_ABOUT_HTML +
            "<!--_html_template_end_-->`;\n"
            "}\n"
        ).encode(),
    }
