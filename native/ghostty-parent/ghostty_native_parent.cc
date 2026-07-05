#include <dlfcn.h>
#include <node_api.h>

#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {

using InputCallback = void (*)(void *, const unsigned char *, int);
using ResizeCallback = void (*)(void *, int, int);
using FocusCallback = void (*)(void *);
using ShortcutCallback = void (*)(void *, const char *, const char *, bool,
                                  bool, bool, bool, bool);
using RenamePaneCallback = void (*)(void *);
using CreateFn = void *(*)(void *, InputCallback, ResizeCallback,
                           FocusCallback, ShortcutCallback,
                           RenamePaneCallback, void *);
// JS calls setFrame(surface, x, y, width, height, bottomCornerRadius,
// parentHeight). The six numeric args map the renderer's top-left native frame
// plus styling and same-snapshot parent height for Swift's AppKit y-flip.
using SetFrameFn = void (*)(
    void *, double, double, double, double, double, double);
using SetShortcutDigitsFn = void (*)(void *, const char *);
using SetBackgroundColorFn = void (*)(void *, const char *);
using SetForegroundColorFn = void (*)(void *, const char *);
using WriteFn = void (*)(void *, const unsigned char *, int);
using FocusFn = void (*)(void *);
using AddSecondaryFn = void (*)(void *, InputCallback, ResizeCallback,
                                FocusCallback, void *);
using SetSecondaryVisibleFn = void (*)(void *, bool);
using RemoveSecondaryFn = void (*)(void *);
using WriteSecondaryFn = void (*)(void *, const unsigned char *, int);
using FocusSecondaryFn = void (*)(void *);
using DestroyFn = void (*)(void *);

struct BridgeApi {
  void *library = nullptr;
  std::string loaded_path;
  CreateFn create = nullptr;
  SetFrameFn set_frame = nullptr;
  SetShortcutDigitsFn set_shortcut_digits = nullptr;
  SetBackgroundColorFn set_background_color = nullptr;
  SetForegroundColorFn set_foreground_color = nullptr;
  WriteFn write = nullptr;
  FocusFn focus = nullptr;
  AddSecondaryFn add_secondary = nullptr;
  SetSecondaryVisibleFn set_secondary_visible = nullptr;
  RemoveSecondaryFn remove_secondary = nullptr;
  WriteSecondaryFn write_secondary = nullptr;
  FocusSecondaryFn focus_secondary = nullptr;
  DestroyFn destroy = nullptr;
};

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
};

BridgeApi bridge;

napi_value Throw(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
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

bool EnsureBridge(napi_env env, const std::string &path) {
  if (bridge.library != nullptr) {
    if (bridge.loaded_path != path) {
      napi_throw_error(env, nullptr,
                       "ghostty native bridge already loaded from another path");
      return false;
    }

    return true;
  }

  bridge.library = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (bridge.library == nullptr) {
    napi_throw_error(env, nullptr, dlerror());
    return false;
  }

  if (LoadSymbol(env, "vimeflow_ghostty_create",
                 reinterpret_cast<void **>(&bridge.create)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_frame",
                 reinterpret_cast<void **>(&bridge.set_frame)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_shortcut_digits",
                 reinterpret_cast<void **>(&bridge.set_shortcut_digits)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_background_color",
                 reinterpret_cast<void **>(&bridge.set_background_color)) &&
      LoadSymbol(env, "vimeflow_ghostty_set_foreground_color",
                 reinterpret_cast<void **>(&bridge.set_foreground_color)) &&
      LoadSymbol(env, "vimeflow_ghostty_write",
                 reinterpret_cast<void **>(&bridge.write)) &&
      LoadSymbol(env, "vimeflow_ghostty_focus",
                 reinterpret_cast<void **>(&bridge.focus)) &&
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
    bridge.loaded_path = path;
    return true;
  }

  ResetBridge();
  return false;
}

std::string GetString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::vector<char> buffer(length + 1);
  napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length);

  return std::string(buffer.data(), length);
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
                bool meta, bool alt, bool shift, bool repeat) {
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
  napi_value argv[7];
  if (napi_get_global(env, &global) == napi_ok &&
      napi_create_string_utf8(env, payload->key.data(), payload->key.size(),
                              &argv[0]) == napi_ok &&
      napi_create_string_utf8(env, payload->code.data(), payload->code.size(),
                              &argv[1]) == napi_ok &&
      napi_get_boolean(env, payload->control, &argv[2]) == napi_ok &&
      napi_get_boolean(env, payload->meta, &argv[3]) == napi_ok &&
      napi_get_boolean(env, payload->alt, &argv[4]) == napi_ok &&
      napi_get_boolean(env, payload->shift, &argv[5]) == napi_ok &&
      napi_get_boolean(env, payload->repeat, &argv[6]) == napi_ok) {
    napi_value ignored;
    napi_call_function(env, global, callback, 7, argv, &ignored);
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

  const std::string bridge_path = GetString(env, args[0]);
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

napi_value SetShortcutDigits(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setShortcutDigits(surface, digits) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  const std::string digits = GetString(env, args[1]);
  bridge.set_shortcut_digits(surface->swift_surface, digits.c_str());

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

  const std::string color = GetString(env, args[1]);
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

  const std::string color = GetString(env, args[1]);
  bridge.set_foreground_color(surface->swift_surface, color.c_str());

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

  const std::string data = GetString(env, args[1]);
  bridge.write(surface->swift_surface,
               reinterpret_cast<const unsigned char *>(data.data()),
               static_cast<int>(data.size()));

  return nullptr;
}

napi_value AddSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 4) {
    return Throw(
        env,
        "addSecondary(surface, onInput, onResize, onFocus) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  if (HasSecondaryCallbacks(surface)) {
    bridge.set_secondary_visible(surface->swift_surface, true);
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
                       OnSecondaryResize, OnSecondaryFocus, surface);

  return nullptr;
}

napi_value SetSecondaryVisible(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    return Throw(env, "setSecondaryVisible(surface, visible) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  bool visible = false;
  napi_get_value_bool(env, args[1], &visible);
  bridge.set_secondary_visible(surface->swift_surface, visible);

  return nullptr;
}

napi_value RemoveSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
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

  const std::string data = GetString(env, args[1]);
  bridge.write_secondary(surface->swift_surface,
                         reinterpret_cast<const unsigned char *>(data.data()),
                         static_cast<int>(data.size()));

  return nullptr;
}

napi_value FocusSecondary(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
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
  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface != nullptr && surface->swift_surface != nullptr) {
    bridge.destroy(surface->swift_surface);
    surface->swift_surface = nullptr;
    ReleaseSecondaryCallbacks(surface);
    ReleaseSurfaceCallbacks(surface);
  }

  return nullptr;
}

napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor descriptors[] = {
      {"create", nullptr, Create, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setFrame", nullptr, SetFrame, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setShortcutDigits", nullptr, SetShortcutDigits, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setBackgroundColor", nullptr, SetBackgroundColor, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"setForegroundColor", nullptr, SetForegroundColor, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"focus", nullptr, Focus, nullptr, nullptr, nullptr, napi_default,
       nullptr},
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
  };
  napi_define_properties(env, exports,
                         sizeof(descriptors) / sizeof(descriptors[0]),
                         descriptors);

  return exports;
}

} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
