//! Runtime-neutral backend layer. Production builds use `ipc::StdoutEventSink`;
//! tests use `FakeEventSink`.

pub mod event_sink;
pub mod ipc;
pub mod state;

pub(crate) use event_sink::serialize_event;
pub use event_sink::EventSink;
pub use state::BackendState;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
