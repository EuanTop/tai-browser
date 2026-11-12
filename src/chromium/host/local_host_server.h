// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_LOCAL_HOST_SERVER_H_
#define SIDEBAR_BROWSER_HOST_LOCAL_HOST_SERVER_H_
#include <memory>
#include <string>
#include "base/functional/callback.h"
#include "base/values.h"
namespace sidebar {
// Same-user Unix socket. Authentication/leases remain NativeHost's authority.
// One bounded JSON line per connection; no HTTP, global CDP or listening TCP.
class LocalHostServer {
 public:
  using Reply = base::OnceCallback<void(base::DictValue)>;
  using Dispatch = base::RepeatingCallback<void(std::string, base::Value, Reply)>;
  LocalHostServer(Dispatch dispatch, base::OnceCallback<void(std::string)> ready);
  ~LocalHostServer();
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
}
#endif
