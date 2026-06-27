#include <dlfcn.h>
#include <node_api.h>

#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

using InputCallback = void (*)(void *, const unsigned char *, int);
using ResizeCallback = void (*)(void *, int, int);
using CreateFn = void *(*)(void *, InputCallback, ResizeCallback, void *);
using SetFrameFn = void (*)(void *, double, double, double, double);
using WriteFn = void (*)(void *, const unsigned char *, int);
using FocusFn = void (*)(void *);
using DestroyFn = void (*)(void *);

struct BridgeApi {
  void *library = nullptr;
  CreateFn create = nullptr;
  SetFrameFn set_frame = nullptr;
  WriteFn write = nullptr;
  FocusFn focus = nullptr;
  DestroyFn destroy = nullptr;
};

struct SurfaceHandle {
  napi_env env = nullptr;
  napi_threadsafe_function input_tsfn = nullptr;
  napi_threadsafe_function resize_tsfn = nullptr;
  void *swift_surface = nullptr;
};

struct InputPayload {
  std::string data;
};

struct ResizePayload {
  int columns = 0;
  int rows = 0;
};

BridgeApi bridge;

napi_value Throw(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
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
    return true;
  }

  bridge.library = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (bridge.library == nullptr) {
    napi_throw_error(env, nullptr, dlerror());
    return false;
  }

  return LoadSymbol(env, "vimeflow_ghostty_create",
                    reinterpret_cast<void **>(&bridge.create)) &&
         LoadSymbol(env, "vimeflow_ghostty_set_frame",
                    reinterpret_cast<void **>(&bridge.set_frame)) &&
         LoadSymbol(env, "vimeflow_ghostty_write",
                    reinterpret_cast<void **>(&bridge.write)) &&
         LoadSymbol(env, "vimeflow_ghostty_focus",
                    reinterpret_cast<void **>(&bridge.focus)) &&
         LoadSymbol(env, "vimeflow_ghostty_destroy",
                    reinterpret_cast<void **>(&bridge.destroy));
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

void OnInput(void *context, const unsigned char *data, int length) {
  if (context == nullptr || data == nullptr || length <= 0) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  if (surface->input_tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<InputPayload>();
  payload->data.assign(reinterpret_cast<const char *>(data),
                       static_cast<size_t>(length));
  if (napi_call_threadsafe_function(surface->input_tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
}

void OnResize(void *context, int columns, int rows) {
  if (context == nullptr) {
    return;
  }

  auto *surface = static_cast<SurfaceHandle *>(context);
  if (surface->resize_tsfn == nullptr) {
    return;
  }

  auto payload = std::make_unique<ResizePayload>();
  payload->columns = columns;
  payload->rows = rows;
  if (napi_call_threadsafe_function(surface->resize_tsfn, payload.get(),
                                    napi_tsfn_nonblocking) == napi_ok) {
    payload.release();
  }
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

void FinalizeSurface(napi_env env, void *data, void *) {
  auto *surface = static_cast<SurfaceHandle *>(data);
  if (surface == nullptr) {
    return;
  }

  if (surface->swift_surface != nullptr && bridge.destroy != nullptr) {
    bridge.destroy(surface->swift_surface);
    surface->swift_surface = nullptr;
  }
  if (surface->input_tsfn != nullptr) {
    napi_release_threadsafe_function(surface->input_tsfn, napi_tsfn_abort);
    surface->input_tsfn = nullptr;
  }
  if (surface->resize_tsfn != nullptr) {
    napi_release_threadsafe_function(surface->resize_tsfn, napi_tsfn_abort);
    surface->resize_tsfn = nullptr;
  }

  delete surface;
}

napi_value Create(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 4) {
    return Throw(env, "create(path, nativeHandle, onInput, onResize) expected");
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
                                CallJsResize, &surface->resize_tsfn)) {
    FinalizeSurface(env, surface, nullptr);
    return Throw(env, "failed to create Ghostty native callbacks");
  }
  surface->swift_surface =
      bridge.create(parent_view, OnInput, OnResize, surface);
  if (surface->swift_surface == nullptr) {
    FinalizeSurface(env, surface, nullptr);
    return Throw(env, "failed to create Ghostty native surface");
  }

  napi_value external;
  napi_create_external(env, surface, FinalizeSurface, nullptr, &external);

  return external;
}

napi_value SetFrame(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 5) {
    return Throw(env, "setFrame(surface, x, y, width, height) expected");
  }

  SurfaceHandle *surface = GetSurface(env, args[0]);
  if (surface == nullptr || surface->swift_surface == nullptr) {
    return nullptr;
  }

  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  napi_get_value_double(env, args[1], &x);
  napi_get_value_double(env, args[2], &y);
  napi_get_value_double(env, args[3], &width);
  napi_get_value_double(env, args[4], &height);
  bridge.set_frame(surface->swift_surface, x, y, width, height);

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
  }

  return nullptr;
}

napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor descriptors[] = {
      {"create", nullptr, Create, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"setFrame", nullptr, SetFrame, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"focus", nullptr, Focus, nullptr, nullptr, nullptr, napi_default,
       nullptr},
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
