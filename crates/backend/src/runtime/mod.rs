//! Runtime-neutral backend layer. Production builds use `ipc::StdoutEventSink`;
//! tests use `FakeEventSink`.

pub mod event_sink;
pub mod ipc;
pub mod state;

pub(crate) use event_sink::serialize_event;
pub use event_sink::EventSink;
pub use state::BackendState;

// Re-export request types that appear in BackendState's public method signatures.
// These live in the private `git` module but are part of the public API surface
// because integration callers (IPC layer, integration tests) must construct them.
pub use crate::git::{DiscardFileRequest, DiscardScope, StageFileRequest};

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
