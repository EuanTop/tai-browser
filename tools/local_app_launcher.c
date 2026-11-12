// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
// Local component-build launcher; paths are supplied by install_local_app.py.
#include <CoreFoundation/CoreFoundation.h>
#include <mach-o/dyld.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "tai_local_config.h"

static int fail(const char* message) {
  CFStringRef text = CFStringCreateWithCString(NULL, message, kCFStringEncodingUTF8);
  CFUserNotificationDisplayAlert(0, kCFUserNotificationStopAlertLevel,
      NULL, NULL, NULL, CFSTR("TAi Browser 无法启动"), text, CFSTR("好"), NULL, NULL, NULL);
  if (text) CFRelease(text);
  return 1;
}

int main(int argc, char** argv) {
  char path[PATH_MAX], resolved[PATH_MAX], binary[PATH_MAX];
  uint32_t size = sizeof(path);
  if (_NSGetExecutablePath(path, &size) || !realpath(path, resolved))
    return fail("无法定位 TAi Browser，请重新安装本地开发入口。");
  char* slash = strrchr(resolved, '/');
  if (!slash) return fail("TAi Browser 的应用目录不完整。");
  *slash = '\0';
  int length = snprintf(binary, sizeof(binary), "%s/Chromium", resolved);
  if (length < 0 || (size_t)length >= sizeof(binary) || access(binary, X_OK))
    return fail("TAi Browser 的运行文件缺失，请重新安装本地开发入口。");
  if (access(TAI_COMPONENT_LIBRARY, R_OK))
    return fail("请连接 TAi 开发磁盘后再打开浏览器。当前安装的浏览器组件不可用。");
  if (argc > 256) return fail("启动参数过多。");
  char** args = calloc((size_t)argc + 10, sizeof(char*));
  if (!args) return fail("无法分配启动内存。");
  int next = 0;
  args[next++] = binary;
  args[next++] = "--sidebar-browser";
  args[next++] = TAI_PROFILE_ARGUMENT;
  args[next++] = "--no-first-run";
  args[next++] = "--no-default-browser-check";
  args[next++] = "--restore-last-session";
  args[next++] = TAI_AGENT_NODE_ARGUMENT;
  args[next++] = TAI_AGENT_ENTRY_ARGUMENT;
#if TAI_QA_CANDIDATE
  args[next++] = "--use-mock-keychain";
#endif
  for (int i = 1; i < argc; ++i) args[next++] = argv[i];
  args[next] = NULL;
  // Chromium creates this installation's own user-data directory. Ordinary
  // launches use Chromium's real credential storage, never a mock keychain.
  umask(077);
  execv(binary, args);
  free(args);
  return fail("TAi Browser 未能启动，请检查开发磁盘是否已连接。");
}
