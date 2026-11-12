#include "sidebar/workspace_model.h"
#include <cstdlib>
#include <iostream>
using namespace sidebar;
void Check(bool value, const char* name) {
  if (!value) { std::cerr << "FAIL: " << name << '\n'; std::exit(1); }
}
int main() {
  WorkspaceModel model;
  Check(model.AddSpace({"a", "Work", "profile"}) && model.AddSpace({"b", "Personal", "profile"}), "create distinct Spaces");
  Check(model.active_space_id() == "a" && model.ActivateSpace("b"), "independent Space selection");
  Check(!model.AddSpace({"a", "Duplicate", "profile"}) && !model.ActivateSpace("missing"), "reject invalid Space requests");
  Check(!model.FindSpace("a")->icon.empty() && model.FindSpace("a")->icon != model.FindSpace("b")->icon, "new Spaces receive distinct default emoji");
  Check(model.SetSpaceIcon("a", "👩🏽‍💻") && model.FindSpace("b")->icon == DefaultSpaceIcon(1), "icon edits belong to one Space");
  Check(!model.SetSpaceIcon("a", "") && !model.SetSpaceIcon("a", std::string(65, 'x')) && model.FindSpace("a")->icon == "👩🏽‍💻", "empty and oversized icons preserve prior metadata");
  Check(model.AddItem({"folder", "a", {}, "Papers", {}, SavedKind::kFolder}), "root folder");
  Check(model.AddItem({"nested", "a", "folder", "Reading", {}, SavedKind::kFolder}), "nested folder");
  Check(model.AddItem({"page", "a", "nested", "Paper", "https://example.com/", SavedKind::kPage}), "page in folder");
  Check(!model.MoveItem("folder", "nested") && model.FindItem("folder")->parent_id.empty(), "cycle rejected atomically");
  Check(!model.AddItem({"bad", "b", "nested", "Other Space", "https://example.com/", SavedKind::kPage}), "cross-Space parent rejected");
  Check(!model.AddItem({"bad", "a", "page", "Non-folder", "https://example.com/", SavedKind::kPage}), "page cannot contain child");
  Check(model.AddItem({"favorite", {}, {}, "Favorite", "https://example.org/", SavedKind::kFavorite}), "profile-wide favorite");
  Check(!model.AddItem({"bad-favorite", "a", {}, "Bad", "https://example.org/", SavedKind::kFavorite}), "favorite cannot belong to Space");
  Check(model.Children("a", "nested") == std::vector<std::string>{"page"}, "children preserve hierarchy");
  Check(model.SetCollapsed("folder", true) && !model.SetCollapsed("page", true), "collapse applies only to folders");
  auto snapshot = model.CaptureSnapshot();
  std::swap(snapshot.items[0], snapshot.items[2]);
  WorkspaceModel restored;
  Check(restored.RestoreSnapshot(snapshot) && restored.FindItem("page")->parent_id == "nested", "unordered snapshot restores parent references");
  auto invalid = snapshot;
  invalid.items[1].parent_id = "missing";
  Check(!restored.RestoreSnapshot(invalid) && restored.FindItem("nested")->parent_id == "folder", "invalid restore leaves tree unchanged");
  invalid = snapshot; invalid.active_space_id = "missing";
  Check(!restored.RestoreSnapshot(invalid) && restored.active_space_id() == "b", "invalid active Space rejected atomically");
  invalid = snapshot; invalid.items.push_back(invalid.items.front());
  Check(!restored.RestoreSnapshot(invalid), "duplicate saved IDs rejected");
  Check(restored.RemoveItem(restored.FindItem("folder")->id) && !restored.FindItem("page") && !restored.FindItem("nested"), "subtree removal including aliased ID");
  Check(restored.FindItem("favorite") && restored.FindSpace("a") && restored.spaces().size() == 2, "empty Space and global favorites survive subtree removal");
  Check(restored.RenameSpace("a", "Renamed") && restored.FindSpace("a")->id == "a", "rename retains identity");
  Check(!restored.AddItem({"empty-url", "a", {}, "Bad", {}, SavedKind::kPage}), "saved page requires URL");
  Check(model.SetSpaceColor("a", "#aBcD09") && model.FindSpace("a")->color == 0xffabcd09, "custom Space color");
  Check(!model.SetSpaceColor("a", "#xyzxyz") && !model.SetSpaceColor("a", "#1234") && model.FindSpace("a")->color == 0xffabcd09, "invalid color is atomic");
  Check(SpaceColorHex(model.FindSpace("a")->color) == "#ABCD09" && ParseSpaceColor("") == 0, "color codec and legacy default");
  Check(model.RelocateItem("folder", SavedKind::kFolder, "b", {}), "folder subtree moves across Spaces");
  Check(model.FindItem("nested")->space_id == "b" && model.FindItem("page")->space_id == "b", "subtree keeps ownership");
  Check(!model.RelocateItem("folder", SavedKind::kFolder, "b", "nested") && model.FindItem("folder")->parent_id.empty(), "drop into descendant rejected atomically");
  Check(model.RelocateItem("page", SavedKind::kFavorite, {}, {}), "saved page becomes global favorite");
  Check(model.FindItem("page")->space_id.empty() && model.FindItem("page")->url == "https://example.com/", "conversion keeps page identity and URL");
  Check(model.RelocateItem("page", SavedKind::kPage, "a", {}), "favorite becomes saved page");
  Check(model.AddItem({"second", "a", {}, "Second", "https://example.org/", SavedKind::kPage}), "ordering fixture");
  Check(model.RelocateItem("second", SavedKind::kPage, "a", {}, "page") && model.Children("a", {}) == std::vector<std::string>{"second", "page"}, "drop before sibling reorders");
  Check(!model.RelocateItem("second", SavedKind::kPage, "a", {}, "nested") && model.Children("a", {}).front() == "second", "invalid anchor preserves order");
  Check(!model.RelocateItem("folder", SavedKind::kFavorite, {}, {}), "folder cannot become favorite");
  Check(model.AddSpace({"other", "Isolated", "other-profile"}) && !model.RelocateItem("page", SavedKind::kPage, "other", {}), "cross-profile drop rejected");
  WorkspaceModel roundtrip;
  Check(roundtrip.RestoreSnapshot(model.CaptureSnapshot()) && roundtrip.FindSpace("a")->color == 0xffabcd09 && roundtrip.Children("a", {}).front() == "second", "order and Space color survive snapshot");
  Check(roundtrip.FindSpace("a")->icon == "👩🏽‍💻", "compound emoji survives restoration");
  auto legacy = model.CaptureSnapshot(); for (auto& space : legacy.spaces) space.icon.clear();
  Check(roundtrip.RestoreSnapshot(legacy) && roundtrip.FindSpace("a")->icon == DefaultSpaceIcon(0) && roundtrip.FindSpace("b")->icon == DefaultSpaceIcon(1), "legacy Spaces acquire stable default emoji");
  std::cout << "Workspace hierarchy, favorites and atomic restoration checks passed\n";
}
