// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "secure_directory.h"

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <cstdint>
#include <dirent.h>
#include <fcntl.h>
#include <string_view>
#include <span>
#include <sys/stat.h>
#include <unistd.h>
#include <utility>

namespace tai::files {
std::string SecureDirectory::Identity() const {
  struct stat info;
  if (fstat(fd_, &info) != 0 || !S_ISDIR(info.st_mode)) return {};
  return std::to_string(static_cast<uint64_t>(info.st_dev)) + ":" +
         std::to_string(static_cast<uint64_t>(info.st_ino));
}
namespace {
constexpr size_t kMaxBytes = 4194304;
constexpr size_t kMaxEntries = 10000;
constexpr size_t kMaxScanned = 100000;
constexpr std::string_view kTemporaryPrefix = ".tai-tmp-";
class Descriptor {
 public:
  explicit Descriptor(int fd = -1) : fd_(fd) {}
  ~Descriptor() { if (fd_ >= 0) close(fd_); }
  Descriptor(Descriptor&& other) noexcept : fd_(std::exchange(other.fd_, -1)) {}
  Descriptor& operator=(Descriptor&& other) noexcept {
    if (this != &other) {
      if (fd_ >= 0) close(fd_);
      fd_ = std::exchange(other.fd_, -1);
    }
    return *this;
  }
  Descriptor(const Descriptor&) = delete;
  Descriptor& operator=(const Descriptor&) = delete;
  int get() const { return fd_; }
  int release() { return std::exchange(fd_, -1); }
 private:
  int fd_;
};
Error OsError(int error) {
  switch (error) {
    case ENOENT: return Error::kNotFound;
    case ELOOP: case ENOTDIR: case EISDIR: return Error::kInvalidPath;
    case EEXIST: return Error::kConflict;
    case ENOSPC: case EDQUOT: case EFBIG: return Error::kQuota;
    default: return Error::kUnavailable;
  }
}
bool Segment(std::string_view part) {
  if (part.empty() || part == "." || part == ".." || part.size() > 255 ||
      part.starts_with(kTemporaryPrefix)) return false;
  for (unsigned char c : part) {
    if (c < 32 || c == 127 || c == '\\' || c == ':' || c == '%' || c == '/')
      return false;
  }
  return true;
}
bool Split(const std::string& path, bool absolute, bool allow_empty,
           std::vector<std::string>* parts) {
  if (absolute) {
    if (path.empty() || path.front() != '/' || path.size() > 4096) return false;
    if (path == "/") return true;
  } else if (path.empty()) {
    return allow_empty;
  } else if (path.front() == '/' || path.size() > 512) return false;
  size_t start = absolute ? 1 : 0;
  while (start < path.size()) {
    const size_t slash = path.find('/', start);
    const size_t end = slash == std::string::npos ? path.size() : slash;
    const auto part = std::string_view(path).substr(start, end - start);
    if (!Segment(part)) return false;
    parts->emplace_back(part);
    if (parts->size() > (absolute ? 64u : 16u)) return false;
    if (slash == std::string::npos) return true;
    start = slash + 1;
  }
  return false;  // Trailing slash, including paths made only of slashes.
}
Descriptor DirectoryAt(int parent, const std::string& name) {
  return Descriptor(openat(parent, name.c_str(),
                           O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
}
bool Sync(int fd);
Descriptor Walk(int root, const std::vector<std::string>& parts, size_t count,
                bool create, Error* error) {
  Descriptor current(fcntl(root, F_DUPFD_CLOEXEC, 0));
  if (current.get() < 0) { *error = OsError(errno); return Descriptor(); }
  for (size_t i = 0; i < count; ++i) {
    auto next = DirectoryAt(current.get(), parts[i]);
    if (next.get() < 0 && errno == ENOENT && create) {
      const bool created = mkdirat(current.get(), parts[i].c_str(), 0700) == 0;
      if (!created && errno != EEXIST) {
        *error = OsError(errno); return Descriptor();
      }
      next = DirectoryAt(current.get(), parts[i]);
    }
    if (next.get() < 0) { *error = OsError(errno); return Descriptor(); }
    if (create && !Sync(current.get())) { *error = OsError(errno); return Descriptor(); }
    current = std::move(next);
  }
  *error = Error::kOk;
  return current;
}
TextResult ReadAt(int directory, const std::string& name, size_t max_bytes) {
  Descriptor file(openat(directory, name.c_str(), O_RDONLY | O_NOFOLLOW |
                         O_CLOEXEC | O_NONBLOCK));
  if (file.get() < 0) return {OsError(errno), {}};
  struct stat info;
  if (fstat(file.get(), &info) != 0) return {OsError(errno), {}};
  if (!S_ISREG(info.st_mode) || info.st_nlink != 1)
    return {Error::kInvalidPath, {}};
  if (info.st_size < 0 || static_cast<uint64_t>(info.st_size) > max_bytes)
    return {Error::kQuota, {}};
  std::string bytes;
  bytes.reserve(static_cast<size_t>(info.st_size));
  std::array<char, 16384> buffer;
  while (true) {
    const ssize_t count = read(file.get(), buffer.data(), buffer.size());
    if (count < 0) { if (errno == EINTR) continue; return {OsError(errno), {}}; }
    if (count == 0) break;
    if (static_cast<size_t>(count) > max_bytes - bytes.size())
      return {Error::kQuota, {}};
    bytes.append(buffer.data(), static_cast<size_t>(count));
  }
  if (fstat(file.get(), &info) != 0) return {OsError(errno), {}};
  if (info.st_nlink != 1) return {Error::kInvalidPath, {}};
  return {Error::kOk, std::move(bytes)};
}
bool Sync(int fd) {
  while (fsync(fd) != 0) { if (errno != EINTR) return false; }
  return true;
}
bool RandomName(std::string* name) {
  Descriptor random(open("/dev/urandom", O_RDONLY | O_CLOEXEC));
  if (random.get() < 0) return false;
  std::array<unsigned char, 16> bytes;
  size_t have = 0;
  while (have < bytes.size()) {
    const ssize_t count = read(random.get(), std::span(bytes).subspan(have).data(), bytes.size() - have);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    have += static_cast<size_t>(count);
  }
  *name = kTemporaryPrefix;
  for (unsigned char byte : bytes) {
    constexpr std::string_view hex = "0123456789abcdef";
    name->push_back(hex[byte >> 4]); name->push_back(hex[byte & 15]);
  }
  return true;
}
Error ConfirmExisting(int directory, const std::string& name,
                      const std::string& text) {
  auto existing = ReadAt(directory, name, kMaxBytes);
  if (existing.error != Error::kOk) return existing.error;
  if (existing.text != text) return Error::kConflict;
  Descriptor file(openat(directory, name.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK));
  if (file.get() < 0) return OsError(errno);
  struct stat info;
  if (fstat(file.get(), &info) != 0) return OsError(errno);
  if (!S_ISREG(info.st_mode) || info.st_nlink != 1) return Error::kInvalidPath;
  if (!Sync(file.get()) || !Sync(directory)) return OsError(errno);
  return Error::kOk;
}
Error CompareExisting(int directory, const std::string& name,
                      const std::string& text) {
  // linkat publication briefly has both the hidden temp and final links.
  // Reads still reject hardlinks; an immutable concurrent publisher may finish
  // unlinking its temp before this bounded retry expires.
  for (int attempt = 0; attempt < 50; ++attempt) {
    auto existing = ReadAt(directory, name, kMaxBytes);
    if (existing.error != Error::kInvalidPath || attempt == 49)
      return existing.error == Error::kOk
          ? ConfirmExisting(directory, name, text)
          : existing.error;
    usleep(1000);
  }
  return Error::kUnavailable;
}
Error Enumerate(int directory, const std::string& prefix, size_t depth,
                size_t max_entries, size_t* scanned,
                std::vector<std::string>* paths) {
  // openat(".") gives a separate directory stream offset; dup() would share it.
  Descriptor copy(openat(directory, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (copy.get() < 0) return OsError(errno);
  DIR* stream = fdopendir(copy.get());
  if (!stream) return OsError(errno);
  copy.release();
  Error error = Error::kOk;
  while (true) {
    errno = 0;
    dirent* entry = readdir(stream);
    if (!entry) { if (errno) error = OsError(errno); break; }
    const std::string name(entry->d_name);
    if (name == "." || name == "..") continue;
    if (++*scanned > kMaxScanned) { error = Error::kQuota; break; }
    if (!Segment(name)) continue;
    const std::string path = prefix.empty() ? name : prefix + "/" + name;
    struct stat info;
    if (fstatat(directory, name.c_str(), &info, AT_SYMLINK_NOFOLLOW) != 0) {
      if (errno == ENOENT) continue;
      error = OsError(errno); break;
    }
    if (S_ISLNK(info.st_mode)) continue;
    if (!S_ISDIR(info.st_mode) && !S_ISREG(info.st_mode)) continue;
    if (depth >= 16 || path.size() > 512) { error = Error::kQuota; break; }
    if (S_ISDIR(info.st_mode)) {
      auto child = DirectoryAt(directory, name);
      if (child.get() < 0) {
        if (errno == ENOENT || errno == ENOTDIR || errno == ELOOP) continue;
        error = OsError(errno); break;
      }
      error = Enumerate(child.get(), path, depth + 1, max_entries, scanned, paths);
      if (error != Error::kOk) break;
    } else {
      // Re-open without following a replacement symlink; verify the actual
      // descriptor rather than trusting the preceding directory entry stat.
      Descriptor file(openat(directory, name.c_str(), O_RDONLY | O_NOFOLLOW |
                             O_NONBLOCK | O_CLOEXEC));
      if (file.get() < 0) {
        if (errno == ENOENT || errno == ELOOP) continue;
        error = OsError(errno); break;
      }
      if (fstat(file.get(), &info) != 0) { error = OsError(errno); break; }
      if (!S_ISREG(info.st_mode)) continue;
      if (info.st_nlink != 1) { error = Error::kInvalidPath; break; }
      if (paths->size() >= max_entries) { error = Error::kQuota; break; }
      paths->push_back(path);
    }
  }
  closedir(stream);
  return error;
}
}  // namespace

std::unique_ptr<SecureDirectory> SecureDirectory::Open(const std::string& absolute_path) {
  std::vector<std::string> parts;
  if (!Split(absolute_path, true, false, &parts)) return nullptr;
  Descriptor root(open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC));
  if (root.get() < 0) return nullptr;
  Error error;
  auto directory = Walk(root.get(), parts, parts.size(), false, &error);
  if (directory.get() < 0) return nullptr;
  return std::unique_ptr<SecureDirectory>(new SecureDirectory(directory.release()));
}
SecureDirectory::~SecureDirectory() { close(fd_); }
TextResult SecureDirectory::Read(const std::string& relative, size_t max_bytes) const {
  std::vector<std::string> parts;
  if (!Split(relative, false, false, &parts)) return {Error::kInvalidPath, {}};
  if (max_bytes > kMaxBytes) return {Error::kQuota, {}};
  Error error;
  auto parent = Walk(fd_, parts, parts.size() - 1, false, &error);
  if (parent.get() < 0) return {error, {}};
  return ReadAt(parent.get(), parts.back(), max_bytes);
}
Error SecureDirectory::PutIfAbsent(const std::string& relative,
                                  const std::string& text) const {
  std::vector<std::string> parts;
  if (!Split(relative, false, false, &parts)) return Error::kInvalidPath;
  if (text.size() > kMaxBytes) return Error::kQuota;
  Error error;
  auto parent = Walk(fd_, parts, parts.size() - 1, true, &error);
  if (parent.get() < 0) return error;
  auto existing = ReadAt(parent.get(), parts.back(), kMaxBytes);
  if (existing.error == Error::kOk)
    return ConfirmExisting(parent.get(), parts.back(), text);
  if (existing.error != Error::kNotFound)
    return existing.error == Error::kInvalidPath
        ? CompareExisting(parent.get(), parts.back(), text) : existing.error;
  std::string temporary;
  if (!RandomName(&temporary)) return Error::kUnavailable;
  Descriptor file(openat(parent.get(), temporary.c_str(), O_WRONLY | O_CREAT |
                         O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600));
  if (file.get() < 0) return OsError(errno);
  auto clean = [&] { return unlinkat(parent.get(), temporary.c_str(), 0) == 0; };
  size_t written = 0;
  while (written < text.size()) {
    const ssize_t count = write(file.get(), std::string_view(text).substr(written).data(), text.size() - written);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) { error = count < 0 ? OsError(errno) : Error::kUnavailable; clean(); return error; }
    written += static_cast<size_t>(count);
  }
  if (!Sync(file.get())) { error = OsError(errno); clean(); return error; }
  if (linkat(parent.get(), temporary.c_str(), parent.get(), parts.back().c_str(), 0) != 0) {
    const int failure = errno;
    clean();
    return failure == EEXIST ? CompareExisting(parent.get(), parts.back(), text) : OsError(failure);
  }
  // The final name is immutable even if cleanup/directory durability fails.
  // Never remove or replace a published file to turn uncertainty into success.
  if (!clean()) return Error::kUnavailable;
  if (!Sync(parent.get())) return OsError(errno);
  return Error::kOk;
}
ListResult SecureDirectory::List(const std::string& relative_prefix,
                                 size_t max_entries) const {
  std::vector<std::string> parts;
  if (!Split(relative_prefix, false, true, &parts)) return {Error::kInvalidPath, {}};
  if (max_entries > kMaxEntries) return {Error::kQuota, {}};
  Error error;
  auto parent = Walk(fd_, parts, parts.empty() ? 0 : parts.size() - 1, false, &error);
  if (parent.get() < 0) return {error, {}};
  Descriptor directory;
  if (parts.empty()) directory = std::move(parent);
  else {
    struct stat info;
    if (fstatat(parent.get(), parts.back().c_str(), &info, AT_SYMLINK_NOFOLLOW) != 0)
      return {OsError(errno), {}};
    if (S_ISREG(info.st_mode)) {
      Descriptor file(openat(parent.get(), parts.back().c_str(),
                             O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC));
      if (file.get() < 0) return {OsError(errno), {}};
      if (fstat(file.get(), &info) != 0) return {OsError(errno), {}};
      if (!S_ISREG(info.st_mode) || info.st_nlink != 1)
        return {Error::kInvalidPath, {}};
      if (max_entries == 0) return {Error::kQuota, {}};
      return {Error::kOk, {relative_prefix}};
    }
    if (!S_ISDIR(info.st_mode)) return {Error::kInvalidPath, {}};
    directory = DirectoryAt(parent.get(), parts.back());
    if (directory.get() < 0) return {OsError(errno), {}};
  }
  std::vector<std::string> paths;
  size_t scanned = 0;
  error = Enumerate(directory.get(), relative_prefix, parts.size(), max_entries, &scanned, &paths);
  if (error != Error::kOk) return {error, {}};
  std::sort(paths.begin(), paths.end());
  return {Error::kOk, std::move(paths)};
}
}  // namespace tai::files
