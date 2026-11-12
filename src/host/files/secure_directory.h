// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef TAI_HOST_FILES_SECURE_DIRECTORY_H_
#define TAI_HOST_FILES_SECURE_DIRECTORY_H_

#include <cstddef>
#include <memory>
#include <string>
#include <vector>

namespace tai::files {
enum class Error { kOk, kNotFound, kInvalidPath, kConflict, kUnavailable, kQuota };
struct TextResult { Error error; std::string text; };
struct ListResult { Error error; std::vector<std::string> paths; };

// A directory capability, selected by trusted UI. All methods run synchronously
// on the caller's IO sequence. Absolute paths and OS error details stay private.
class SecureDirectory final {
 public:
  static std::unique_ptr<SecureDirectory> Open(const std::string& absolute_path);
  ~SecureDirectory();
  SecureDirectory(const SecureDirectory&) = delete;
  SecureDirectory& operator=(const SecureDirectory&) = delete;
  TextResult Read(const std::string& relative, size_t max_bytes = 4194304) const;
  Error PutIfAbsent(const std::string& relative, const std::string& text) const;
  ListResult List(const std::string& relative_prefix,
                  size_t max_entries = 10000) const;
  // Stable identity of the opened capability, checked before restoring a grant.
  std::string Identity() const;
 private:
  explicit SecureDirectory(int fd) : fd_(fd) {}
  int fd_;
};
}  // namespace tai::files
#endif  // TAI_HOST_FILES_SECURE_DIRECTORY_H_
