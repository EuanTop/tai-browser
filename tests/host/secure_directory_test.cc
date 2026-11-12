// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "src/host/files/secure_directory.h"

#include <array>
#include <barrier>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

namespace fs = std::filesystem;
using tai::files::Error;
using tai::files::SecureDirectory;
namespace {
void Check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(message);
}
struct Fixture {
  std::string path;
  Fixture() {
    std::string pattern = (fs::temp_directory_path() / "tai-directory-test-XXXXXX").string();
    Check(mkdtemp(pattern.data()) != nullptr, "create synthetic test directory");
    path = fs::canonical(pattern).string();
    fs::create_directory(path + "/root");
    fs::create_directory(path + "/outside");
  }
  ~Fixture() { std::error_code ignored; fs::remove_all(path, ignored); }
  std::string root() const { return path + "/root"; }
};
void Tests() {
  Fixture f;
  auto directory = SecureDirectory::Open(f.root());
  Check(!!directory, "open selected canonical directory");
  Check(directory->List("", 0).error == Error::kOk && directory->List("").paths.empty(),
        "empty root listing");
  const std::string empty_root = f.path + "/empty";
  fs::create_directory(empty_root);
  auto boundary = SecureDirectory::Open(empty_root);
  Check(boundary->PutIfAbsent("max", std::string(4194304, 'x')) == Error::kOk &&
        boundary->Read("max").text.size() == 4194304, "exact four MiB boundary");
  Check(!SecureDirectory::Open(f.root() + "/../outside"), "reject absolute traversal");
  Check(!SecureDirectory::Open(f.root() + "/"), "reject trailing absolute slash");
  Check(!SecureDirectory::Open("relative"), "reject relative root");
  Check(directory->PutIfAbsent("notes/nested/item.md", "# Saved\n") == Error::kOk,
        "nested immutable write");
  auto reopened = SecureDirectory::Open(f.root());
  Check(reopened->Read("notes/nested/item.md").text == "# Saved\n", "nested persistence");
  struct stat info;
  Check(stat((f.root() + "/notes/nested/item.md").c_str(), &info) == 0 &&
        (info.st_mode & 0777) == 0600, "file mode 0600");
  Check(stat((f.root() + "/notes").c_str(), &info) == 0 &&
        (info.st_mode & 0777) == 0700, "directory mode 0700");
  Check(directory->PutIfAbsent("notes/nested/item.md", "# Saved\n") == Error::kOk,
        "identical publish is idempotent");
  Check(directory->PutIfAbsent("notes/nested/item.md", "replacement") == Error::kConflict,
        "different publish conflicts");
  Check(directory->Read("notes/nested/item.md").text == "# Saved\n", "published bytes unchanged");
  Check(directory->Read("missing").error == Error::kNotFound, "missing read");
  Check(directory->Read("notes").error == Error::kInvalidPath, "directory cannot be read as file");
  Check(directory->Read("notes/nested/item.md", 3).error == Error::kQuota, "read quota");
  Check(directory->Read("notes/nested/item.md", 4194305).error == Error::kQuota,
        "cannot request unbounded read");
  Check(directory->PutIfAbsent("huge", std::string(4194305, 'x')) == Error::kQuota,
        "write quota");
  const std::array<std::string, 15> invalid = {"", "/absolute", "..", "a/../escape",
      "a/./b", "a//b", "a/", "a\\b", "a:b", "%2e%2e/escape", "x%252fy",
      std::string("nul\0name", 8), "line\nname", ".tai-tmp-private", std::string(513, 'x')};
  for (const auto& path : invalid) {
    Check(directory->Read(path).error == Error::kInvalidPath, "reject invalid read path");
    Check(directory->PutIfAbsent(path, "x") == Error::kInvalidPath, "reject invalid write path");
    if (!path.empty())
      Check(directory->List(path).error == Error::kInvalidPath, "reject invalid list path");
  }
  std::string deep;
  for (int i = 0; i < 17; ++i) deep += (i ? "/x" : "x");
  Check(directory->PutIfAbsent(deep, "x") == Error::kInvalidPath, "relative depth bound");
  Check(!fs::exists(f.root() + "/x"), "invalid paths do not create parents");
  std::ofstream(f.path + "/outside/secret") << "outside";
  fs::create_directory_symlink(f.path + "/outside", f.root() + "/escape");
  fs::create_symlink(f.path + "/outside/secret", f.root() + "/file-link");
  Check(!SecureDirectory::Open(f.root() + "/escape"), "root cannot traverse symlink");
  Check(directory->Read("escape/secret").error == Error::kInvalidPath, "directory symlink read denied");
  Check(directory->PutIfAbsent("escape/new", "x") == Error::kInvalidPath, "directory symlink write denied");
  Check(!fs::exists(f.path + "/outside/new"), "no external write");
  Check(directory->Read("file-link").error == Error::kInvalidPath, "file symlink read denied");
  Check(directory->PutIfAbsent("file-link", "x") == Error::kInvalidPath, "file symlink write denied");
  Check(directory->List("escape").error == Error::kInvalidPath, "symlink list prefix denied");
  fs::create_hard_link(f.path + "/outside/secret", f.root() + "/hard-link");
  Check(directory->Read("hard-link").error == Error::kInvalidPath, "external hardlink read denied");
  Check(directory->PutIfAbsent("hard-link", "outside") == Error::kInvalidPath,
        "external hardlink cannot count as idempotent");
  Check(directory->List("").error == Error::kInvalidPath, "hardlink list denied");
  fs::remove(f.root() + "/hard-link");
  std::ofstream(f.root() + "/.tai-tmp-orphan") << "internal";
  auto listed = directory->List("");
  Check(listed.error == Error::kOk && listed.paths == std::vector<std::string>{"notes/nested/item.md"},
        "list regular files, skipping symlinks and internal temps");
  Check(directory->List("notes").paths == listed.paths, "folder prefix remains root relative");
  Check(directory->List("notes/nested/item.md").paths == listed.paths, "file prefix");
  Check(directory->List("missing").error == Error::kNotFound, "missing list prefix");
  Check(directory->PutIfAbsent("second", "two") == Error::kOk, "second file");
  auto quota = directory->List("", 1);
  Check(quota.error == Error::kQuota && quota.paths.empty(), "list quota has no partial unbounded output");
  Check(directory->List("", 10001).error == Error::kQuota, "list maximum bound");
  Check(directory->List("").paths == directory->List("").paths, "repeated listings use independent offsets");
  for (int iteration = 0; iteration < 20; ++iteration) {
    const std::string name = "races/same-" + std::to_string(iteration);
    std::barrier gate(2);
    Error a = Error::kUnavailable, b = Error::kUnavailable;
    std::thread first([&] { gate.arrive_and_wait(); a = directory->PutIfAbsent(name, "same"); });
    std::thread second([&] { gate.arrive_and_wait(); b = reopened->PutIfAbsent(name, "same"); });
    first.join(); second.join();
    Check(a == Error::kOk && b == Error::kOk, "simultaneous identical publishers converge");
  }
  std::barrier gate(2);
  Error a = Error::kUnavailable, b = Error::kUnavailable;
  std::thread first([&] { gate.arrive_and_wait(); a = directory->PutIfAbsent("races/different", "alpha"); });
  std::thread second([&] { gate.arrive_and_wait(); b = reopened->PutIfAbsent("races/different", "beta"); });
  first.join(); second.join();
  Check((a == Error::kOk && b == Error::kConflict) ||
        (b == Error::kOk && a == Error::kConflict), "different concurrent publishers have one winner");
  const auto winner = directory->Read("races/different");
  Check(winner.error == Error::kOk && (winner.text == "alpha" || winner.text == "beta"),
        "concurrent file is complete");
  auto final_list = directory->List("");
  Check(final_list.error == Error::kOk && final_list.paths.size() == 23,
        "publication leaves no visible temporary files");
}
}  // namespace
int main() {
  try { Tests(); std::cout << "SecureDirectory checks passed\n"; return 0; }
  catch (const std::exception& error) { std::cerr << "FAILED: " << error.what() << '\n'; return 1; }
}
