#include <dlfcn.h>
#include <fcntl.h>
#include <node_api.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cinttypes>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits.h>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

using InputCallback = void (*)(void *, const unsigned char *, int);
using ResizeCallback = void (*)(void *, int, int);
using FocusCallback = void (*)(void *);
using ShortcutCallback = void (*)(void *, const char *, const char *, bool,
                                  bool, bool, bool, bool, bool);
using RenamePaneCallback = void (*)(void *);
using CreateFn = void *(*)(void *, InputCallback, ResizeCallback,
                           FocusCallback, ShortcutCallback,
                           RenamePaneCallback, void *);
// JS calls setFrame(surface, x, y, width, height, bottomCornerRadius,
// parentHeight). The six numeric args map the renderer's top-left native frame
// plus styling and same-snapshot parent height for Swift's AppKit y-flip.
using SetFrameFn = void (*)(
    void *, double, double, double, double, double, double);
using SetKeybindingsFn = void (*)(void *, const char *);
using SetBackgroundColorFn = void (*)(void *, const char *);
using SetForegroundColorFn = void (*)(void *, const char *);
using SetFontFamilyFn = void (*)(void *, const char *);
using SetResizeThrottleMsFn = void (*)(void *, double);
using WriteFn = void (*)(void *, const unsigned char *, int);
using FocusFn = void (*)(void *);
using ReadGridFn = char *(*)(void *);
using PresentationProbeFn = char *(*)(void *);
using FreeStringFn = void (*)(char *);
using AddSecondaryFn = void (*)(void *, InputCallback, ResizeCallback,
                                FocusCallback, void *, const char *);
using SetSecondaryVisibleFn = void (*)(void *, bool, const char *);
using RemoveSecondaryFn = void (*)(void *);
using WriteSecondaryFn = void (*)(void *, const unsigned char *, int);
using FocusSecondaryFn = void (*)(void *);
using DestroyFn = void (*)(void *);

struct BridgeApi {
  void *library = nullptr;
  std::string loaded_path;
  CreateFn create = nullptr;
  SetFrameFn set_frame = nullptr;
  SetKeybindingsFn set_keybindings = nullptr;
  SetBackgroundColorFn set_background_color = nullptr;
  SetForegroundColorFn set_foreground_color = nullptr;
  SetFontFamilyFn set_font_family = nullptr;
  SetResizeThrottleMsFn set_resize_throttle_ms = nullptr;
  WriteFn write = nullptr;
  FocusFn focus = nullptr;
  ReadGridFn read_grid = nullptr;
  PresentationProbeFn presentation_probe = nullptr;
  FreeStringFn free_string = nullptr;
  AddSecondaryFn add_secondary = nullptr;
  SetSecondaryVisibleFn set_secondary_visible = nullptr;
  RemoveSecondaryFn remove_secondary = nullptr;
  WriteSecondaryFn write_secondary = nullptr;
  FocusSecondaryFn focus_secondary = nullptr;
  DestroyFn destroy = nullptr;
};

// One winsize-ownership fd slot (VIM-399 Phase 2). Two per surface, keyed by
// role: primary (OnResize) and secondary/burner (OnSecondaryResize). The
// mutex serializes state transitions and (in Phase 3) ioctl vs close, which
// is what makes a reused fd number unreachable.
struct PtyFdSlot {
  std::mutex mtx;
  int fd = -1;
  enum class State { Empty, Bound, NativeActive, Releasing } state =
      State::Empty;
  std::string session_id;
  uint64_t generation = 0;
  uint64_t lease_id = 0;
  // Latest size the engine reported — the RELEASING flush source and, from
  // Phase 3 on, what a release carries as its last-applied size.
  int last_columns = 0;
  int last_rows = 0;
};

constexpr int kPtyRolePrimary = 0;
constexpr int kPtyRoleSecondary = 1;

struct SurfaceHandle {
  napi_env env = nullptr;
  napi_threadsafe_function input_tsfn = nullptr;
  napi_threadsafe_function resize_tsfn = nullptr;
  napi_threadsafe_function focus_tsfn = nullptr;
  napi_threadsafe_function shortcut_tsfn = nullptr;
  napi_threadsafe_function rename_pane_tsfn = nullptr;
  napi_threadsafe_function secondary_input_tsfn = nullptr;
  napi_threadsafe_function secondary_resize_tsfn = nullptr;
  napi_threadsafe_function secondary_focus_tsfn = nullptr;
  void *swift_surface = nullptr;
  std::atomic_bool callbacks_released = false;
  std::atomic_bool secondary_callbacks_released = true;
  std::mutex callback_mutex;
  PtyFdSlot pty_slots[2];
};

struct InputPayload {
  std::string data;
};

struct ResizePayload {
  int columns = 0;
  int rows = 0;
};

struct ShortcutPayload {
  std::string key;
  std::string code;
  bool control = false;
  bool meta = false;
  bool alt = false;
  bool shift = false;
  bool repeat = false;
  bool from_secondary = false;
};

BridgeApi bridge;

napi_value Throw(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

// PTY winsize-atomicity transport (VIM-399): an AF_UNIX/SOCK_DGRAM socketpair
// created BEFORE the sidecar spawns. The addon owns the parent end for its
// lifetime (Phase 2 receives PTY fds on it); the child end is inherited by
// the sidecar as stdio[3] and closed here once the spawn completes.
int g_pty_fd_transport_parent = -1;
int g_pty_fd_transport_child = -1;

bool SetCloexec(int fd) {
  int flags = fcntl(fd, F_GETFD);
  return flags >= 0 && fcntl(fd, F_SETFD, flags | FD_CLOEXEC) >= 0;
}

// Winsize-ownership protocol (VIM-399 Phase 2) — implementation lives after
// the surface callbacks; these run early in the file.
void StartPtyFdTransportThread();
void RecordPtySlotSize(SurfaceHandle *surface, int role, int columns,
                       int rows);

// createPtyFdTransport() -> child fd number. Idempotent: repeat calls return
// the existing child end so a retried spawn cannot orphan a pair.
napi_value CreatePtyFdTransport(napi_env env, napi_callback_info) {
  if (g_pty_fd_transport_parent < 0) {
    int fds[2] = {-1, -1};
    if (socketpair(AF_UNIX, SOCK_DGRAM, 0, fds) != 0) {
      return Throw(env, "pty fd transport socketpair failed");
    }
    // CLOEXEC on both our copies; Node's spawn machinery dups the child end
    // into the sidecar regardless, and nothing else may inherit either end.
    if (!SetCloexec(fds[0]) || !SetCloexec(fds[1])) {
      close(fds[0]);
      close(fds[1]);
      return Throw(env, "pty fd transport cloexec failed");
    }
    g_pty_fd_transport_parent = fds[0];
    g_pty_fd_transport_child = fds[1];
    StartPtyFdTransportThread();
  }

  napi_value result = nullptr;
  napi_create_int32(env, g_pty_fd_transport_child, &result);
  return result;
}

// notifyPtyFdTransportSpawned(): the sidecar now holds its inherited copy, so
// the parent-process copy of the child end must close for EOF detection.
napi_value NotifyPtyFdTransportSpawned(napi_env env, napi_callback_info) {
  if (g_pty_fd_transport_child >= 0) {
    close(g_pty_fd_transport_child);
    g_pty_fd_transport_child = -1;
  }
  return nullptr;
}

void ResetBridge() {
  if (bridge.library != nullptr) {
    dlclose(bridge.library);
  }
  bridge = BridgeApi{};
}

bool LoadSymbol(napi_env env, const char *name, void **target) {
  *target = dlsym(bridge.library, name);
  if (*target != nullptr) {
    return true;
  }

  napi_throw_error(env, nullptr, dlerror());
  return false;
}

std::string ParentDir(const std::string &path) {
  const size_t slash = path.find_last_of('/');
  if (slash == std::string::npos) {
    return "";
  }

  return path.substr(0, slash);
}

std::string Basename(const std::string &path) {
  const size_t slash = path.find_last_of('/');
  if (slash == std::string::npos) {
    return path;
  }

  return path.substr(slash + 1);
}

bool RealPath(const std::string &path, std::string *resolved) {
  char buffer[PATH_MAX];
  if (realpath(path.c_str(), buffer) == nullptr) {
    return false;
  }

  *resolved = buffer;
  return true;
}

bool CurrentAddonPath(std::string *path) {
  Dl_info info;
  if (dladdr(reinterpret_cast<void *>(&CurrentAddonPath), &info) == 0 ||
      info.dli_fname == nullptr) {
    return false;
  }

  return RealPath(info.dli_fname, path);
}

bool ValidateBridgePath(napi_env env, const std::string &path,
                        std::string *resolved_path) {
  if (!RealPath(path, resolved_path)) {
    napi_throw_error(env, nullptr, "ghostty native bridge path does not exist");
    return false;
  }

  if (Basename(*resolved_path) != "libGhosttyElectronBridge.dylib") {
    napi_throw_error(env, nullptr, "unexpected ghostty native bridge filename");
    return false;
  }

  std::string addon_path;
  if (!CurrentAddonPath(&addon_path)) {
    napi_throw_error(env, nullptr, "unable to resolve native addon path");
    return false;
  }

  if (ParentDir(*resolved_path) != ParentDir(addon_path)) {
    napi_throw_error(env, nullptr,
                     "ghostty native bridge must be beside native addon");
    return false;
  }

  return true;
}

bool EnsureBridge(napi_env env, const std::string &path) {
  std::string resolved_path;
  if (!ValidateBridgePath(env, path, &resolved_path)) {
    return false;
  }

  if (bridge.library != nullptr) {
    if (bridge.loaded_path != resolved_path) {
      napi_throw_error(env, nullptr,
                       "ghostty native bridge already loaded from another path");
      return false;
    }

    return true;
  }

  bridge.library = dlopen(resolved_path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (bridge.library == nullptr) {
    napi_throw_error(env, nullptr, dlerror());
    return false;
  }

  if (LoadSymbol(env, "vimeflow_ghostty_create",
                 reinterpret_cast<void **>(&bridge.create)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_frame",
                 reinterpret_cast<void **>(&bridge.set_frame)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_keybindings",
                 reinterpret_cast<void **>(&bridge.set_keybindings)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_background_color",
                 reinterpret_cast<void **>(&bridge.set_background_color)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_foreground_color",
                 reinterpret_cast<void **>(&bridge.set_foreground_color)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_font_family",
                 reinterpret_cast<void **>(&bridge.set_font_family)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_resize_throttle_ms",
                 reinterpret_cast<void **>(&bridge.set_resize_throttle_ms)) &&
      LoadSymbol(env, "vimeflow_ghostty_write",
                 reinterpret_cast<void **>(&bridge.write)) &&
      LoadSymbol(env, "vimeflow_ghostty_focus",
                 reinterpret_cast<void **>(&bridge.focus)) &&
      LoadSymbol(env, "vimeflow_ghostty_read_grid",
                 reinterpret_cast<void **>(&bridge.read_grid)) &&
      LoadSymbol(env, "vimeflow_ghostty_presentation_probe",
                 reinterpret_cast<void **>(&bridge.presentation_probe)) &&
      LoadSymbol(env, "vimeflow_ghostty_free_string",
                 reinterpret_cast<void **>(&bridge.free_string)) &&
      LoadSymbol(env, "vimeflow_ghostty_add_secondary",
                 reinterpret_cast<void **>(&bridge.add_secondary)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_secondary_visible",
                 reinterpret_cast<void **>(&bridge.set_secondary_visible)) &&
      LoadSymbol(env, "vimeflow_ghostty_remove_secondary",
                 reinterpret_cast<void **>(&bridge.remove_secondary)) &&
      LoadSymbol(env, "vimeflow_ghostty_write_secondary",
                 reinterpret_cast<void **>(&bridge.write_secondary)) &&
      LoadSymbol(env, "vimeflow_ghostty_focus_secondary",
                 reinterpret_cast<void **>(&bridge.focus_secondary)) &&
      LoadSymbol(env, "vimeflow_ghostty_destroy",
                 reinterpret_cast<void **>(&bridge.destroy))) {
    bridge.loaded_path = resolved_path;
    return true;
  }

  ResetBridge();
  return false;
}

bool GetString(napi_env env, napi_value value, std::string *out) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    napi_throw_error(env, nullptr, "expected string argument");
    return false;
  }

  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(),
                                 &length) != napi_ok) {
    napi_throw_error(env, nullptr, "failed to read string argument");
    return false;
  }

  *out = std::string(buffer.data(), length);
  return true;
}

SurfaceHandle *GetSurface(napi_env env, napi_value value) {
  void *data = nullptr;
  if (napi_get_value_external(env, value, &data) != napi_ok || data == nullptr) {
    napi_throw_error(env, nullptr, "invalid ghostty native surface");
    return nullptr;
  }

  return static_cast<SurfaceHandle *>(data);
}

napi_threadsafe_function AcquireSurfaceCallback(
    SurfaceHandle *surface, napi_threadsafe_function SurfaceHandle::*member) {
  if (surface->callbacks_released.load(std::memory_order_acquire)) {
    return nullptr;
  }

  std::lock_guard<std::mutex> lock(surface->callback_mutex);
  if (surface->callbacks_released.load(std::memory_order_relaxed)) {
    return nullptr;
  }

  napi_threadsafe_function tsfn = surface->*member;
  if (tsfn == nullptr ||
      napi_acquire_threadsafe_function(tsfn) != napi_ok) {
    return nullptr;
  }

  return tsfn;
}

napi_threadsafe_function AcquireSecondaryCallback(
    SurfaceHandle *surface, napi_threadsafe_function SurfaceHandle::*member) {
  if (surface->callbacks_released.load(std::memory_order_acquire) ||
      surface->secondary_callbacks_released.load(std::memory_order_acquire)) {
    return nullptr;
  }

  std::lock_guard<std::mutex> lock(surface->callback_mutex);
  if (surface->callbacks_released.load(std::memory_order_relaxed) ||
      surface->secondary_callbacks_released.load(std::memory_order_relaxed)) {
    return nullptr;
  }

  napi_threadsafe_function tsfn = surface->*member;
  if (tsfn == nullptr ||
      napi_acquire_threadsafe_function(tsfn) != napi_ok) {
    return nullptr;
  }

  return tsfn;
}

void OnInput(void *context, const unsigned char *data, int length) {
  if (context == nullptr || data == nullptr || length <= 0) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSurfaceCallback(surface, &SurfaceHandle::input_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<InputPayload>();
  payload->data.assign(reinterpret_cast<const char *>(data),
                       static_cast<size_t>(length));
  if (napi_call_threadsafe_function(tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnResize(void *context, int columns, int rows) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  RecordPtySlotSize(surface, kPtyRolePrimary, columns, rows);
  napi_threadsafe_function tsfn =
      AcquireSurfaceCallback(surface, &SurfaceHandle::resize_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<ResizePayload>();
  payload->columns = columns;
  payload->rows = rows;
  if (napi_call_threadsafe_function(tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnSecondaryInput(void *context, const unsigned char *data, int length) {
  if (context == nullptr || data == nullptr || length <= 0) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSecondaryCallback(surface, &SurfaceHandle::secondary_input_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<InputPayload>();
  payload->data.assign(reinterpret_cast<const char *>(data),
                       static_cast<size_t>(length));
  if (napi_call_threadsafe_function(tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnSecondaryResize(void *context, int columns, int rows) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  RecordPtySlotSize(surface, kPtyRoleSecondary, columns, rows);
  napi_threadsafe_function tsfn =
      AcquireSecondaryCallback(surface, &SurfaceHandle::secondary_resize_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<ResizePayload>();
  payload->columns = columns;
  payload->rows = rows;
  if (napi_call_threadsafe_function(tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnSecondaryFocus(void *context) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSecondaryCallback(surface, &SurfaceHandle::secondary_focus_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnFocus(void *context) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSurfaceCallback(surface, &SurfaceHandle::focus_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnShortcut(void *context, const char *key, const char *code, bool control,
                bool meta, bool alt, bool shift, bool repeat,
                bool from_secondary) {
  if (context == nullptr || key == nullptr || code == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSurfaceCallback(surface, &SurfaceHandle::shortcut_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<ShortcutPayload>();
  payload->key = key;
  payload->code = code;
  payload->control = control;
  payload->meta = meta;
  payload->alt = alt;
  payload->shift = shift;
  payload->repeat = repeat;
  payload->from_secondary = from_secondary;
  if (napi_call_threadsafe_function(tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

void OnRenamePane(void *context) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  napi_threadsafe_function tsfn =
      AcquireSurfaceCallback(surface, &SurfaceHandle::rename_pane_tsfn);
  if (tsfn == nullptr) {
    return;
  }

  napi_call_threadsafe_function(tsfn, nullptr, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(tsfn, napi_tsfn_release);
}

// ---------------------------------------------------------------------------
// Winsize-ownership protocol (VIM-399 Phase 2)
//
// Wire peer: crates/backend/src/terminal/fd_broker.rs (protocol authority).
// One JSON object per datagram. Inbound: fd (carries a descriptor),
// activate-ack, release-ack, detach. Outbound: native-ready, release
// (retried until acked), request-fd.
//
// ponytail: hand-rolled JSON field extraction — the peer is serde_json with
// fixed flat shapes (UUID session ids, integers); swap in a JSON library if
// the protocol ever grows nesting or escaping.
// ---------------------------------------------------------------------------

struct PendingPtyFd {
  int fd = -1;
  uint64_t generation = 0;
  uint64_t lease_id = 0;
};

struct PtyBindIntent {
  SurfaceHandle *surface = nullptr;
  int role = kPtyRolePrimary;
};

// Where a release-ack lands: a live slot (flush + close) or an orphan fd
// from a destroyed surface (close only). Keyed by lease id.
struct UnackedRelease {
  SurfaceHandle *surface = nullptr; // nullptr → orphan
  int role = kPtyRolePrimary;
  int orphan_fd = -1;
  std::string json;
  std::chrono::steady_clock::time_point last_sent;
};

// Lock ordering (deadlock-free by construction): g_pty_protocol_mutex may
// nest slot.mtx or callback_mutex inside it; never the reverse. The
// transport thread only dereferences a SurfaceHandle under the protocol
// mutex, and surface teardown detaches from every protocol structure under
// that same mutex BEFORE the handle is freed — so the thread can never race
// a finalizer into a dangling pointer.
std::mutex g_pty_protocol_mutex;
std::map<std::string, PendingPtyFd> g_pending_pty_fds;
std::map<std::string, PtyBindIntent> g_pty_bind_intents;
std::map<uint64_t, UnackedRelease> g_unacked_releases;
// lease id → live binding, for routing activate-ack / release-ack / detach.
std::map<uint64_t, std::pair<SurfaceHandle *, int>> g_pty_lease_slots;

bool ExtractJsonString(const std::string &json, const char *key,
                       std::string *out) {
  const std::string needle = std::string("\"") + key + "\":\"";
  const size_t start = json.find(needle);
  if (start == std::string::npos) {
    return false;
  }
  const size_t value_start = start + needle.size();
  const size_t end = json.find('"', value_start);
  if (end == std::string::npos) {
    return false;
  }
  *out = json.substr(value_start, end - value_start);
  return true;
}

bool ExtractJsonU64(const std::string &json, const char *key, uint64_t *out) {
  const std::string needle = std::string("\"") + key + "\":";
  const size_t start = json.find(needle);
  if (start == std::string::npos) {
    return false;
  }
  *out = strtoull(json.c_str() + start + needle.size(), nullptr, 10);
  return true;
}

void SendPtyTransportDatagram(const std::string &json) {
  if (g_pty_fd_transport_parent < 0) {
    return;
  }
  send(g_pty_fd_transport_parent, json.data(), json.size(), 0);
}

void RecordPtySlotSize(SurfaceHandle *surface, int role, int columns,
                       int rows) {
  PtyFdSlot &slot = surface->pty_slots[role];
  std::lock_guard<std::mutex> lock(slot.mtx);
  if (slot.state == PtyFdSlot::State::Empty) {
    return;
  }
  slot.last_columns = columns;
  slot.last_rows = rows;
}

std::string PtyMessageJson(const char *type, const std::string &session_id,
                           uint64_t generation, uint64_t lease_id,
                           const char *role) {
  char buf[512];
  if (role != nullptr) {
    snprintf(buf, sizeof(buf),
             "{\"t\":\"%s\",\"sessionId\":\"%s\",\"generation\":%" PRIu64
             ",\"leaseId\":%" PRIu64 ",\"role\":\"%s\"}",
             type, session_id.c_str(), generation, lease_id, role);
  } else {
    snprintf(buf, sizeof(buf),
             "{\"t\":\"%s\",\"sessionId\":\"%s\",\"generation\":%" PRIu64
             ",\"leaseId\":%" PRIu64 "}",
             type, session_id.c_str(), generation, lease_id);
  }
  return buf;
}

// Enqueues a size through the ordinary JS resize path — the RELEASING flush.
void EnqueuePtyResizeFlush(SurfaceHandle *surface, int role, int columns,
                           int rows) {
  if (columns <= 0 || rows <= 0) {
    return;
  }
  if (role == kPtyRolePrimary) {
    OnResize(surface, columns, rows);
  } else {
    OnSecondaryResize(surface, columns, rows);
  }
}

// Binds a delivered fd to a surface slot and announces native-ready. Caller
// holds g_pty_protocol_mutex.
void CompletePtyBindLocked(SurfaceHandle *surface, int role,
                           const std::string &session_id,
                           const PendingPtyFd &pending) {
  PtyFdSlot &slot = surface->pty_slots[role];
  {
    std::lock_guard<std::mutex> lock(slot.mtx);
    if (slot.fd >= 0) {
      close(slot.fd);
    }
    slot.fd = pending.fd;
    slot.state = PtyFdSlot::State::Bound;
    slot.session_id = session_id;
    slot.generation = pending.generation;
    slot.lease_id = pending.lease_id;
    slot.last_columns = 0;
    slot.last_rows = 0;
  }
  g_pty_lease_slots[pending.lease_id] = {surface, role};
  SendPtyTransportDatagram(PtyMessageJson(
      "native-ready", session_id, pending.generation, pending.lease_id,
      role == kPtyRolePrimary ? "primary" : "secondary"));
}

// Detaches one role slot from the protocol because its surface is going
// away (Destroy, RemoveSecondary, finalizer). Caller holds
// g_pty_protocol_mutex. The fd is orphaned into the unacked record so ack
// routing never dereferences a freed SurfaceHandle; the release itself is
// still sent + retried so Rust reacquires ownership cleanly.
void OrphanReleasePtySlotLocked(SurfaceHandle *surface, int role,
                                std::vector<std::string> *out_sends) {
  PtyFdSlot &slot = surface->pty_slots[role];
  std::lock_guard<std::mutex> lock(slot.mtx);
  if (slot.state == PtyFdSlot::State::Empty) {
    return;
  }
  const uint64_t lease_id = slot.lease_id;
  g_pty_lease_slots.erase(lease_id);

  if (slot.state == PtyFdSlot::State::Releasing) {
    // A release is already in flight with a surface-routed record: convert
    // it to an orphan so completion only closes the fd.
    auto it = g_unacked_releases.find(lease_id);
    if (it != g_unacked_releases.end()) {
      it->second.surface = nullptr;
      it->second.orphan_fd = slot.fd;
    } else if (slot.fd >= 0) {
      close(slot.fd);
    }
  } else {
    char buf[512];
    snprintf(buf, sizeof(buf),
             "{\"t\":\"release\",\"sessionId\":\"%s\",\"generation\":%" PRIu64
             ",\"leaseId\":%" PRIu64 ",\"rows\":%d,\"cols\":%d}",
             slot.session_id.c_str(), slot.generation, lease_id,
             slot.last_rows, slot.last_columns);
    UnackedRelease record;
    record.surface = nullptr;
    record.role = role;
    record.orphan_fd = slot.fd;
    record.json = buf;
    record.last_sent = std::chrono::steady_clock::now();
    g_unacked_releases[lease_id] = record;
    out_sends->push_back(record.json);
  }
  slot.fd = -1;
  slot.state = PtyFdSlot::State::Empty;
  slot.session_id.clear();
}

// Full surface teardown: intents, both role slots, lease routes. MUST run
// before the SurfaceHandle is freed.
void DetachSurfaceFromPtyProtocol(SurfaceHandle *surface) {
  std::vector<std::string> sends;
  {
    std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
    for (auto it = g_pty_bind_intents.begin();
         it != g_pty_bind_intents.end();) {
      it = it->second.surface == surface ? g_pty_bind_intents.erase(it)
                                         : std::next(it);
    }
    OrphanReleasePtySlotLocked(surface, kPtyRolePrimary, &sends);
    OrphanReleasePtySlotLocked(surface, kPtyRoleSecondary, &sends);
  }
  for (const auto &json : sends) {
    SendPtyTransportDatagram(json);
  }
}

void DetachSecondaryFromPtyProtocol(SurfaceHandle *surface) {
  std::vector<std::string> sends;
  {
    std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
    OrphanReleasePtySlotLocked(surface, kPtyRoleSecondary, &sends);
  }
  for (const auto &json : sends) {
    SendPtyTransportDatagram(json);
  }
}

void HandlePtyActivateAck(uint64_t lease_id) {
  std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
  auto it = g_pty_lease_slots.find(lease_id);
  if (it == g_pty_lease_slots.end()) {
    return;
  }
  PtyFdSlot &slot = it->second.first->pty_slots[it->second.second];
  std::lock_guard<std::mutex> slot_lock(slot.mtx);
  if (slot.state == PtyFdSlot::State::Bound && slot.lease_id == lease_id) {
    slot.state = PtyFdSlot::State::NativeActive;
  }
}

void HandlePtyReleaseAck(uint64_t lease_id) {
  std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
  auto it = g_unacked_releases.find(lease_id);
  if (it == g_unacked_releases.end()) {
    return;
  }
  const UnackedRelease record = it->second;
  g_unacked_releases.erase(it);
  if (record.surface == nullptr) {
    if (record.orphan_fd >= 0) {
      close(record.orphan_fd);
    }
    return;
  }
  g_pty_lease_slots.erase(lease_id);
  PtyFdSlot &slot = record.surface->pty_slots[record.role];
  int flush_columns = 0;
  int flush_rows = 0;
  {
    std::lock_guard<std::mutex> slot_lock(slot.mtx);
    if (slot.state != PtyFdSlot::State::Releasing ||
        slot.lease_id != lease_id) {
      return;
    }
    if (slot.fd >= 0) {
      close(slot.fd);
      slot.fd = -1;
    }
    slot.state = PtyFdSlot::State::Empty;
    flush_columns = slot.last_columns;
    flush_rows = slot.last_rows;
    slot.session_id.clear();
  }
  // Rust owns the winsize again: flush the newest size recorded during
  // RELEASING through the ordinary JS path so it is applied, not skipped.
  // Runs under the protocol mutex on purpose: teardown detaches under this
  // same mutex before the handle is freed, so the pointer cannot dangle
  // here. Ordering stays protocol → slot / protocol → callback_mutex.
  EnqueuePtyResizeFlush(record.surface, record.role, flush_columns,
                        flush_rows);
}

void HandlePtyInboundMessage(const std::string &json, int received_fd) {
  std::string type;
  if (!ExtractJsonString(json, "t", &type)) {
    if (received_fd >= 0) {
      close(received_fd);
    }
    return;
  }

  if (type == "fd") {
    std::string session_id;
    uint64_t generation = 0;
    uint64_t lease_id = 0;
    if (received_fd < 0 || !ExtractJsonString(json, "sessionId", &session_id) ||
        !ExtractJsonU64(json, "generation", &generation) ||
        !ExtractJsonU64(json, "leaseId", &lease_id)) {
      if (received_fd >= 0) {
        close(received_fd);
      }
      return;
    }
    PtyBindIntent intent;
    bool has_intent = false;
    PendingPtyFd pending{received_fd, generation, lease_id};
    {
      std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
      auto existing = g_pending_pty_fds.find(session_id);
      if (existing != g_pending_pty_fds.end()) {
        // Superseded delivery: the old descriptor is stale — close it.
        close(existing->second.fd);
        g_pending_pty_fds.erase(existing);
      }
      auto intent_it = g_pty_bind_intents.find(session_id);
      if (intent_it != g_pty_bind_intents.end()) {
        intent = intent_it->second;
        has_intent = true;
        g_pty_bind_intents.erase(intent_it);
      } else {
        g_pending_pty_fds[session_id] = pending;
      }
      if (has_intent) {
        CompletePtyBindLocked(intent.surface, intent.role, session_id,
                              pending);
      }
    }
    return;
  }

  if (received_fd >= 0) {
    close(received_fd);
  }

  if (type == "activate-ack") {
    uint64_t lease_id = 0;
    if (ExtractJsonU64(json, "leaseId", &lease_id)) {
      HandlePtyActivateAck(lease_id);
    }
    return;
  }

  if (type == "release-ack") {
    uint64_t lease_id = 0;
    if (ExtractJsonU64(json, "leaseId", &lease_id)) {
      HandlePtyReleaseAck(lease_id);
    }
    return;
  }

  if (type == "detach") {
    std::string session_id;
    uint64_t lease_id = 0;
    if (!ExtractJsonString(json, "sessionId", &session_id) ||
        !ExtractJsonU64(json, "leaseId", &lease_id)) {
      return;
    }
    std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
    auto pending = g_pending_pty_fds.find(session_id);
    if (pending != g_pending_pty_fds.end() &&
        pending->second.lease_id == lease_id) {
      close(pending->second.fd);
      g_pending_pty_fds.erase(pending);
    }
    g_pty_bind_intents.erase(session_id);
    // A bound slot for this lease: Rust already retired it (the session is
    // gone), so close directly — no release handshake.
    auto route = g_pty_lease_slots.find(lease_id);
    if (route != g_pty_lease_slots.end()) {
      PtyFdSlot &slot = route->second.first->pty_slots[route->second.second];
      std::lock_guard<std::mutex> slot_lock(slot.mtx);
      if (slot.lease_id == lease_id && slot.fd >= 0) {
        close(slot.fd);
        slot.fd = -1;
        slot.state = PtyFdSlot::State::Empty;
        slot.session_id.clear();
      }
      g_pty_lease_slots.erase(route);
    }
    return;
  }
}

// Retries unacked releases (idempotent by lease) so a dropped ack on a
// healthy channel can only delay, never strand.
void RetryUnackedPtyReleases() {
  const auto now = std::chrono::steady_clock::now();
  std::vector<std::string> to_send;
  {
    std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
    for (auto &entry : g_unacked_releases) {
      if (now - entry.second.last_sent > std::chrono::milliseconds(500)) {
        entry.second.last_sent = now;
        to_send.push_back(entry.second.json);
      }
    }
  }
  for (const auto &json : to_send) {
    SendPtyTransportDatagram(json);
  }
}

// Transport death: close everything unilaterally — Rust reclaims all leases
// on its side, so no acks are coming and none are needed.
void ShutdownPtyProtocol() {
  std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
  for (auto &entry : g_pending_pty_fds) {
    close(entry.second.fd);
  }
  g_pending_pty_fds.clear();
  g_pty_bind_intents.clear();
  for (auto &entry : g_unacked_releases) {
    if (entry.second.orphan_fd >= 0) {
      close(entry.second.orphan_fd);
    }
  }
  g_unacked_releases.clear();
  for (auto &entry : g_pty_lease_slots) {
    PtyFdSlot &slot = entry.second.first->pty_slots[entry.second.second];
    std::lock_guard<std::mutex> slot_lock(slot.mtx);
    if (slot.fd >= 0) {
      close(slot.fd);
      slot.fd = -1;
    }
    slot.state = PtyFdSlot::State::Empty;
    slot.session_id.clear();
  }
  g_pty_lease_slots.clear();
}

void PtyFdTransportThreadMain() {
  std::vector<char> buf(4096);
  while (true) {
    struct pollfd pfd = {g_pty_fd_transport_parent, POLLIN, 0};
    const int ready = poll(&pfd, 1, 200);
    if (ready < 0 && errno != EINTR) {
      ShutdownPtyProtocol();
      return;
    }
    RetryUnackedPtyReleases();
    if (ready <= 0) {
      continue;
    }

    struct iovec iov = {buf.data(), buf.size()};
    char cmsg_buf[64];
    struct msghdr msg = {};
    msg.msg_iov = &iov;
    msg.msg_iovlen = 1;
    msg.msg_control = cmsg_buf;
    msg.msg_controllen = sizeof(cmsg_buf);

    const ssize_t len = recvmsg(g_pty_fd_transport_parent, &msg, 0);
    if (len < 0) {
      if (errno == EINTR) {
        continue;
      }
      // Peer closed (ECONNRESET on macOS) or hard error either way.
      ShutdownPtyProtocol();
      return;
    }
    if (len == 0) {
      ShutdownPtyProtocol();
      return;
    }

    int received_fd = -1;
    for (struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msg); cmsg != nullptr;
         cmsg = CMSG_NXTHDR(&msg, cmsg)) {
      if (cmsg->cmsg_level == SOL_SOCKET && cmsg->cmsg_type == SCM_RIGHTS) {
        memcpy(&received_fd, CMSG_DATA(cmsg), sizeof(received_fd));
        if (received_fd >= 0) {
          // Sender-side close-on-exec does not transfer.
          const int flags = fcntl(received_fd, F_GETFD);
          if (flags >= 0) {
            fcntl(received_fd, F_SETFD, flags | FD_CLOEXEC);
          }
        }
      }
    }

    HandlePtyInboundMessage(std::string(buf.data(), (size_t)len),
                            received_fd);
  }
}

void StartPtyFdTransportThread() {
  std::thread(PtyFdTransportThreadMain).detach();
}

void CallJsInput(napi_env env, napi_value callback, void *, void *data) {
  std::unique_ptr<InputPayload> payload(static_cast<InputPayload *>(data));
  if (env == nullptr || callback == nullptr || payload == nullptr) {
    return;
  }

  napi_value global;
  napi_value argv[1];
  if (napi_get_global(env, &global) == napi_ok &&
      napi_create_string_utf8(env, payload->data.data(), payload->data.size(),
                              &argv[0]) == napi_ok) {
    napi_value ignored;
    napi_call_function(env, global, callback, 1, argv, &ignored);
  }
}

void CallJsResize(napi_env env, napi_value callback, void *, void *data) {
  std::unique_ptr<ResizePayload> payload(static_cast<ResizePayload *>(data));
  if (env == nullptr || callback == nullptr || payload == nullptr) {
    return;
  }

  napi_value global;
  napi_value argv[2];
  if (napi_get_global(env, &global) == napi_ok &&
      napi_create_int32(env, payload->columns, &argv[0]) == napi_ok &&
      napi_create_int32(env, payload->rows, &argv[1]) == napi_ok) {
    napi_value ignored;
    napi_call_function(env, global, callback, 2, argv, &ignored);
  }
}

void CallJsFocus(napi_env env, napi_value callback, void *, void *) {
  if (env == nullptr || callback == nullptr) {
    return;
  }

  napi_value global;
  if (napi_get_global(env, &global) == napi_ok) {
    napi_value ignored;
    napi_call_function(env, global, callback, 0, nullptr, &ignored);
  }
}

void CallJsShortcut(napi_env env, napi_value callback, void *, void *data) {
  std::unique_ptr<ShortcutPayload> payload(static_cast<ShortcutPayload *>(data));
  if (env == nullptr || callback == nullptr || payload == nullptr) {
    return;
  }

  napi_value global;
  napi_value argv[8];
  if (napi_get_global(env, &global) == napi_ok &&
      napi_create_string_utf8(env, payload->key.data(), payload->key.size(),
                              &argv[0]) == napi_ok &&
      napi_create_string_utf8(env, payload->code.data(), payload->code.size(),
                              &argv[1]) == napi_ok &&
      napi_get_boolean(env, payload->control, &argv[2]) == napi_ok &&
      napi_get_boolean(env, payload->meta, &argv[3]) == napi_ok &&
      napi_get_boolean(env, payload->alt, &argv[4]) == napi_ok &&
      napi_get_boolean(env, payload->shift, &argv[5]) == napi_ok &&
      napi_get_boolean(env, payload->repeat, &argv[6]) == napi_ok &&
      napi_get_boolean(env, payload->from_secondary, &argv[7]) == napi_ok) {
    napi_value ignored;
    napi_call_function(env, global, callback, 8, argv, &ignored);
  }
}

bool CreateThreadsafeFunction(napi_env env, napi_value callback,
                              const char *name,
                              napi_threadsafe_function_call_js call_js,
                              napi_threadsafe_function *result) {
  napi_value resource_name;
  if (napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource_name) !=
      napi_ok) {
    return false;
  }

  return napi_create_threadsafe_function(
             env, callback, nullptr, resource_name, 0, 1, nullptr, nullptr,
             nullptr, call_js, result) == napi_ok;
}

void ReleaseSecondaryCallbacks(SurfaceHandle *surface);
void ReleaseSurfaceCallbacks(SurfaceHandle *surface);

void FinalizeSurface(napi_env env, void *data, void *) {
  auto *surface = static_cast<SurfaceHandle *>(data);
  if (surface == nullptr) {
    return;
  }

  // Scrub every winsize-protocol structure BEFORE the delete below — the
  // transport thread only touches surfaces it can still find there.
  DetachSurfaceFromPtyProtocol(surface);

  if (surface->swift_surface != nullptr && bridge.destroy != nullptr) {
    bridge.destroy(surface->swift_surface);
    surface->swift_surface = nullptr;
  }
  ReleaseSecondaryCallbacks(surface);
  ReleaseSurfaceCallbacks(surface);

  delete surface;
}

void ReleaseSecondaryCallbacks(SurfaceHandle *surface) {
  bool expected = false;
  if (!surface->secondary_callbacks_released.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }

  napi_threadsafe_function secondary_input_tsfn = nullptr;
  napi_threadsafe_function secondary_resize_tsfn = nullptr;
  napi_threadsafe_function secondary_focus_tsfn = nullptr;
  {
    std::lock_guard<std::mutex> lock(surface->callback_mutex);
    secondary_input_tsfn = surface->secondary_input_tsfn;
    secondary_resize_tsfn = surface->secondary_resize_tsfn;
    secondary_focus_tsfn = surface->secondary_focus_tsfn;
    surface->secondary_input_tsfn = nullptr;
    surface->secondary_resize_tsfn = nullptr;
    surface->secondary_focus_tsfn = nullptr;
  }

  if (secondary_input_tsfn != nullptr) {
    napi_release_threadsafe_function(secondary_input_tsfn, napi_tsfn_abort);
  }
  if (secondary_resize_tsfn != nullptr) {
    napi_release_threadsafe_function(secondary_resize_tsfn, napi_tsfn_abort);
  }
  if (secondary_focus_tsfn != nullptr) {
    napi_release_threadsafe_function(secondary_focus_tsfn, napi_tsfn_abort);
  }
}

void ReleaseSurfaceCallbacks(SurfaceHandle *surface) {
  bool expected = false;
  if (!surface->callbacks_released.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }

  napi_threadsafe_function input_tsfn = nullptr;
  napi_threadsafe_function resize_tsfn = nullptr;
  napi_threadsafe_function focus_tsfn = nullptr;
  napi_threadsafe_function shortcut_tsfn = nullptr;
  napi_threadsafe_function rename_pane_tsfn = nullptr;
  {
    std::lock_guard<std::mutex> lock(surface->callback_mutex);
    input_tsfn = surface->input_tsfn;
    resize_tsfn = surface->resize_tsfn;
    focus_tsfn = surface->focus_tsfn;
    shortcut_tsfn = surface->shortcut_tsfn;
    rename_pane_tsfn = surface->rename_pane_tsfn;
    surface->input_tsfn = nullptr;
    surface->resize_tsfn = nullptr;
    surface->focus_tsfn = nullptr;
    surface->shortcut_tsfn = nullptr;
    surface->rename_pane_tsfn = nullptr;
  }

  if (input_tsfn != nullptr) {
    napi_release_threadsafe_function(input_tsfn, napi_tsfn_abort);
  }
  if (resize_tsfn != nullptr) {
    napi_release_threadsafe_function(resize_tsfn, napi_tsfn_abort);
  }
  if (focus_tsfn != nullptr) {
    napi_release_threadsafe_function(focus_tsfn, napi_tsfn_abort);
  }
  if (shortcut_tsfn != nullptr) {
    napi_release_threadsafe_function(shortcut_tsfn, napi_tsfn_abort);
  }
  if (rename_pane_tsfn != nullptr) {
    napi_release_threadsafe_function(rename_pane_tsfn, napi_tsfn_abort);
  }
}

bool HasSecondaryCallbacks(SurfaceHandle *surface) {
  if (surface->secondary_callbacks_released.load(std::memory_order_acquire)) {
    return false;
  }

  std::lock_guard<std::mutex> lock(surface->callback_mutex);
  return !surface->secondary_callbacks_released.load(std::memory_order_relaxed) &&
         surface->secondary_input_tsfn != nullptr &&
         surface->secondary_resize_tsfn != nullptr &&
         surface->secondary_focus_tsfn != nullptr;
}

napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value args[7];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 7) {
    return Throw(
        env,
        "create(path, nativeHandle, onInput, onResize, onFocus, onShortcut, onRenamePane) expected");
  }

  std::string bridge_path;
  if (!GetString(env, args[0], &bridge_path)) {
    return nullptr;
  }

  if (!EnsureBridge(env, bridge_path)) {
    return nullptr;
  }

  void *buffer = nullptr;
  size_t buffer_length = 0;
  if (napi_get_buffer_info(env, args[1], &buffer, &buffer_length) != napi_ok ||
      buffer_length < sizeof(void *)) {
    return Throw(env, "native window handle must be a Buffer");
  }

  void *parent_view = nullptr;
  std::memcpy(&parent_view, buffer, sizeof(parent_view));
  if (parent_view == nullptr) {
    return Throw(env, "native window handle was null");
  }

  auto *surface = new SurfaceHandle();
  surface->env = env;
  if (!CreateThreadsafeFunction(env, args[2], "vimeflow-ghostty-input",
                                CallJsInput, &surface->input_tsfn) ||
      !CreateThreadsafeFunction(env, args[3], "vimeflow-ghostty-resize",
                                CallJsResize, &surface->resize_tsfn) ||
      !CreateThreadsafeFunction(env, args[4], "vimeflow-ghostty-focus",
                                CallJsFocus, &surface->focus_tsfn) ||
      !CreateThreadsafeFunction(env, args[5], "vimeflow-ghostty-shortcut",
                                CallJsShortcut, &surface->shortcut_tsfn) ||
      !CreateThreadsafeFunction(env, args[6], "vimeflow-ghostty-rename-pane",
                                CallJsFocus, &surface->rename_pane_tsfn)) {
    FinalizeSurface(env, surface, nullptr);
    return Throw(env, "failed to create Ghostty native callbacks");
  }
  surface->swift_surface =
      bridge.create(parent_view, OnInput, OnResize, OnFocus, OnShortcut,
                    OnRenamePane, surface);
  if (surface->swift_surface == nullptr) {
    FinalizeSurface(env, surface, nullptr);
    return Throw(env, "failed to create Ghostty native surface");
  }

  napi_value external;
  if (napi_create_external(env, surface, FinalizeSurface, nullptr, &external) !=
      napi_ok) {
    FinalizeSurface(env, surface, nullptr);
    return Throw(env, "failed to create external");
  }

  return external;
}

napi_value SetFrame(napi_env env, napi_callback_info info) {
  size_t argc = 7;
  napi_value args[7];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 5) {
    return Throw(env,
                 "setFrame(surface, x, y, width, height[, "
                 "bottomCornerRadius, parentHeight]) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double bottom_corner_radius = 0;
  double parent_height = 0;
  napi_get_value_double(env, args[1], &x);
  napi_get_value_double(env, args[2], &y);
  napi_get_value_double(env, args[3], &width);
  napi_get_value_double(env, args[4], &height);
  if (argc >= 6) {
    napi_get_value_double(env, args[5], &bottom_corner_radius);
  }
  if (argc >= 7) {
    napi_get_value_double(env, args[6], &parent_height);
  }
  bridge.set_frame(surface->swift_surface, x, y, width, height,
                   bottom_corner_radius, parent_height);

  return nullptr;
}

napi_value SetKeybindings(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setKeybindings(surface, bindings) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string bindings;
  if (!GetString(env, args[1], &bindings)) {
    return nullptr;
  }

  bridge.set_keybindings(surface->swift_surface, bindings.c_str());

  return nullptr;
}

napi_value SetBackgroundColor(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setBackgroundColor(surface, color) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string color;
  if (!GetString(env, args[1], &color)) {
    return nullptr;
  }

  bridge.set_background_color(surface->swift_surface, color.c_str());

  return nullptr;
}

napi_value SetForegroundColor(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setForegroundColor(surface, color) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string color;
  if (!GetString(env, args[1], &color)) {
    return nullptr;
  }

  bridge.set_foreground_color(surface->swift_surface, color.c_str());

  return nullptr;
}

napi_value SetFontFamily(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setFontFamily(surface, fontFamily) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string font_family;
  if (!GetString(env, args[1], &font_family)) {
    return nullptr;
  }

  bridge.set_font_family(surface->swift_surface, font_family.c_str());

  return nullptr;
}

napi_value SetResizeThrottleMs(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setResizeThrottleMs(surface, milliseconds) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  double milliseconds = 0;
  napi_get_value_double(env, args[1], &milliseconds);

  bridge.set_resize_throttle_ms(surface->swift_surface, milliseconds);

  return nullptr;
}

napi_value Write(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "write(surface, data) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string data;
  if (!GetString(env, args[1], &data)) {
    return nullptr;
  }

  if (data.size() > static_cast<size_t>(INT_MAX)) {
    return Throw(env, "write data too large");
  }

  bridge.write(surface->swift_surface,
               reinterpret_cast<const unsigned char *>(data.data()),
               static_cast<int>(data.size()));

  return nullptr;
}

// Test-only reader: the native surface paints through Metal into an NSView,
// so its contents are invisible to the DOM and to WebDriver screenshots.
// Returns the visible grid as one string, rows separated by '\n', or null.
napi_value ReadGrid(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "readGrid(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  char *text = bridge.read_grid(surface->swift_surface);
  if (text == nullptr) {
    return nullptr;
  }

  napi_value result;
  napi_status status =
      napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result);
  bridge.free_string(text);
  if (status != napi_ok) {
    return nullptr;
  }

  return result;
}

// Diagnostics twin of ReadGrid: what Core Animation is presenting right now.
napi_value ReadPresentationProbe(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "readPresentationProbe(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  char *text = bridge.presentation_probe(surface->swift_surface);
  if (text == nullptr) {
    return nullptr;
  }

  napi_value result;
  napi_status status =
      napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &result);
  bridge.free_string(text);
  if (status != napi_ok) {
    return nullptr;
  }

  return result;
}

napi_value AddSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 5) {
    return Throw(
        env,
        "addSecondary(surface, onInput, onResize, onFocus, placement) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string placement;
  if (!GetString(env, args[4], &placement)) {
    return nullptr;
  }

  if (HasSecondaryCallbacks(surface)) {
    bridge.set_secondary_visible(surface->swift_surface, true,
                                 placement.c_str());
    return nullptr;
  }

  napi_threadsafe_function input_tsfn = nullptr;
  napi_threadsafe_function resize_tsfn = nullptr;
  napi_threadsafe_function focus_tsfn = nullptr;
  if (!CreateThreadsafeFunction(env, args[1], "vimeflow-ghostty-secondary-input",
                                CallJsInput, &input_tsfn) ||
      !CreateThreadsafeFunction(env, args[2], "vimeflow-ghostty-secondary-resize",
                                CallJsResize, &resize_tsfn) ||
      !CreateThreadsafeFunction(env, args[3], "vimeflow-ghostty-secondary-focus",
                                CallJsFocus, &focus_tsfn)) {
    if (input_tsfn != nullptr) {
      napi_release_threadsafe_function(input_tsfn, napi_tsfn_abort);
    }
    if (resize_tsfn != nullptr) {
      napi_release_threadsafe_function(resize_tsfn, napi_tsfn_abort);
    }
    if (focus_tsfn != nullptr) {
      napi_release_threadsafe_function(focus_tsfn, napi_tsfn_abort);
    }
    return Throw(env, "failed to create Ghostty secondary callbacks");
  }

  {
    std::lock_guard<std::mutex> lock(surface->callback_mutex);
    surface->secondary_input_tsfn = input_tsfn;
    surface->secondary_resize_tsfn = resize_tsfn;
    surface->secondary_focus_tsfn = focus_tsfn;
    surface->secondary_callbacks_released.store(false,
                                                std::memory_order_release);
  }

  bridge.add_secondary(surface->swift_surface, OnSecondaryInput,
                       OnSecondaryResize, OnSecondaryFocus, surface,
                       placement.c_str());

  return nullptr;
}

napi_value SetSecondaryVisible(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    return Throw(env,
                 "setSecondaryVisible(surface, visible, placement) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  bool visible = false;
  napi_get_value_bool(env, args[1], &visible);
  std::string placement;
  if (!GetString(env, args[2], &placement)) {
    return nullptr;
  }
  bridge.set_secondary_visible(surface->swift_surface, visible,
                               placement.c_str());

  return nullptr;
}

napi_value RemoveSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "removeSecondary(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
    DetachSecondaryFromPtyProtocol(surface);
    bridge.remove_secondary(surface->swift_surface);
    ReleaseSecondaryCallbacks(surface);
  }

  return nullptr;
}

napi_value WriteSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "writeSecondary(surface, data) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  std::string data;
  if (!GetString(env, args[1], &data)) {
    return nullptr;
  }

  if (data.size() > static_cast<size_t>(INT_MAX)) {
    return Throw(env, "writeSecondary data too large");
  }

  bridge.write_secondary(surface->swift_surface,
                         reinterpret_cast<const unsigned char *>(data.data()),
                         static_cast<int>(data.size()));

  return nullptr;
}

napi_value FocusSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "focusSecondary(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
    bridge.focus_secondary(surface->swift_surface);
  }

  return nullptr;
}

napi_value Focus(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "focus(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
    bridge.focus(surface->swift_surface);
  }

  return nullptr;
}

napi_value Destroy(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) {
    return Throw(env, "destroy(surface) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
    DetachSurfaceFromPtyProtocol(surface);
    bridge.destroy(surface->swift_surface);
    surface->swift_surface = nullptr;
    ReleaseSecondaryCallbacks(surface);
    ReleaseSurfaceCallbacks(surface);
  }

  return nullptr;
}

// bindPty(surface, role, sessionId): joins session-owned transport state
// (the pending fd from Rust) to handle-owned native state (the role slot).
// With no pending fd — surface recreation after a release — it records a
// bind intent and asks Rust for a fresh transfer; Rust answers once the
// previous lease retires. Generation and lease live purely between Rust and
// this addon: Electron main only knows the sessionId.
napi_value BindPty(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 3) {
    return Throw(env, "bindPty(surface, role, sessionId) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr) {
    return nullptr;
  }

  char role_buf[16] = {0};
  size_t role_len = 0;
  if (napi_get_value_string_utf8(env, args[1], role_buf, sizeof(role_buf),
                                 &role_len) != napi_ok) {
    return Throw(env, "bindPty role must be a string");
  }
  const int role =
      strcmp(role_buf, "secondary") == 0 ? kPtyRoleSecondary : kPtyRolePrimary;

  char session_buf[128] = {0};
  size_t session_len = 0;
  if (napi_get_value_string_utf8(env, args[2], session_buf,
                                 sizeof(session_buf),
                                 &session_len) != napi_ok ||
      session_len == 0) {
    return Throw(env, "bindPty sessionId must be a non-empty string");
  }
  const std::string session_id(session_buf, session_len);

  if (g_pty_fd_transport_parent < 0) {
    return nullptr; // Transport never established: async path only.
  }

  {
    std::lock_guard<std::mutex> lock(g_pty_protocol_mutex);
    auto pending = g_pending_pty_fds.find(session_id);
    if (pending != g_pending_pty_fds.end()) {
      const PendingPtyFd fd_entry = pending->second;
      g_pending_pty_fds.erase(pending);
      CompletePtyBindLocked(surface, role, session_id, fd_entry);
      return nullptr;
    }
    g_pty_bind_intents[session_id] = PtyBindIntent{surface, role};
  }
  char buf[256];
  snprintf(buf, sizeof(buf), "{\"t\":\"request-fd\",\"sessionId\":\"%s\"}",
           session_id.c_str());
  SendPtyTransportDatagram(buf);

  return nullptr;
}

napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor descriptors[] = {
      {"create", nullptr, Create, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setFrame", nullptr, SetFrame, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setKeybindings", nullptr, SetKeybindings, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setBackgroundColor", nullptr, SetBackgroundColor, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setForegroundColor", nullptr, SetForegroundColor, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setFontFamily", nullptr, SetFontFamily, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setResizeThrottleMs", nullptr, SetResizeThrottleMs, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"focus", nullptr, Focus, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"readGrid", nullptr, ReadGrid, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"readPresentationProbe", nullptr, ReadPresentationProbe, nullptr,
       nullptr, nullptr, napi_default, nullptr},
      {"addSecondary", nullptr, AddSecondary, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setSecondaryVisible", nullptr, SetSecondaryVisible, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"writeSecondary", nullptr, WriteSecondary, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"focusSecondary", nullptr, FocusSecondary, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"removeSecondary", nullptr, RemoveSecondary, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"destroy", nullptr, Destroy, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"createPtyFdTransport", nullptr, CreatePtyFdTransport, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"notifyPtyFdTransportSpawned", nullptr, NotifyPtyFdTransportSpawned,
       nullptr, nullptr, nullptr, napi_default, nullptr},
      {"bindPty", nullptr, BindPty, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(descriptors) / sizeof(descriptors[0]),
                         descriptors);

  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
