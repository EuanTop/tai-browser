// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause

#include <CoreFoundation/CoreFoundation.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <pwd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int fail(const char* message) {
  CFStringRef text = CFStringCreateWithCString(NULL, message, kCFStringEncodingUTF8);
  CFUserNotificationDisplayAlert(0, kCFUserNotificationStopAlertLevel,
      NULL, NULL, NULL, CFSTR("TAi Browser"), text, CFSTR("OK"), NULL, NULL, NULL);
  if (text) CFRelease(text);
  return EXIT_FAILURE;
}

int main(int argc, char** argv) {
  char path[PATH_MAX], directory[PATH_MAX], chromium[PATH_MAX];
  uint32_t path_size = sizeof(path);
  if (_NSGetExecutablePath(path, &path_size) || !realpath(path, directory))
    return fail("The application could not locate its browser executable.");
  char* separator = strrchr(directory, '/');
  if (!separator)
    return fail("The application bundle is incomplete.");
  *separator = '\0';

  int chromium_size = snprintf(chromium, sizeof(chromium), "%s/Chromium", directory);
  if (chromium_size < 0 || (size_t)chromium_size >= sizeof(chromium) ||
      access(chromium, X_OK))
    return fail("The browser executable is missing. Reinstall TAi Browser.");

  const char* home = getenv("HOME");
  if (!home || !*home) {
    struct passwd* account = getpwuid(getuid());
    if (!account || !account->pw_dir || !*account->pw_dir)
      return fail("The application could not locate your home folder.");
    home = account->pw_dir;
  }

  char profile[PATH_MAX + sizeof("--user-data-dir=")];
  char node[PATH_MAX + sizeof("--tai-agent-node=")];
  char entry[PATH_MAX + sizeof("--tai-agent-entry=")];
  // Keep the existing profile location used by earlier TAi installations.
  int profile_size = snprintf(profile, sizeof(profile),
      "--user-data-dir=%s/Library/Application Support/TAi Browser/Preview", home);
  if (profile_size < 0 || (size_t)profile_size >= sizeof(profile))
    return fail("The profile path is too long.");

  int node_size = snprintf(node, sizeof(node), "--tai-agent-node=%s/TAiNode", directory);
  int entry_size = snprintf(entry, sizeof(entry),
      "--tai-agent-entry=%s/../Resources/agent-runtime/modules/agent-tools/native-stdio.mjs",
      directory);
  if (node_size < 0 || (size_t)node_size >= sizeof(node) ||
      entry_size < 0 || (size_t)entry_size >= sizeof(entry))
    return fail("The application path is too long.");

  const size_t fixed_count = 8;
  char** arguments = calloc((size_t)argc + fixed_count + 1, sizeof(*arguments));
  if (!arguments)
    return fail("The application could not allocate its launch arguments.");

  size_t next = 0;
  arguments[next++] = chromium;
  arguments[next++] = "--sidebar-browser";
  arguments[next++] = profile;
  arguments[next++] = "--no-first-run";
  arguments[next++] = "--no-default-browser-check";
  arguments[next++] = "--restore-last-session";
  arguments[next++] = node;
  arguments[next++] = entry;
  for (int index = 1; index < argc; ++index)
    arguments[next++] = argv[index];

  umask(077);
  execv(chromium, arguments);
  free(arguments);
  return fail("The browser could not start. Reinstall TAi Browser if the issue persists.");
}
