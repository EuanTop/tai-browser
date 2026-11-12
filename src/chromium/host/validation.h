// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#ifndef SIDEBAR_BROWSER_HOST_VALIDATION_H_
#define SIDEBAR_BROWSER_HOST_VALIDATION_H_
#include <algorithm>
#include <initializer_list>
#include <string_view>
#include "base/values.h"
namespace sidebar {
inline bool HostOnly(const base::DictValue& object, std::initializer_list<std::string_view> keys) {
  return std::ranges::all_of(object, [&](const auto& entry) {
    return std::ranges::find(keys, entry.first) != keys.end();
  });
}
}
#endif
