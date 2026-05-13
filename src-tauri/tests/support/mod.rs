use vimeflow_lib::runtime::EventSink;

#[path = "../../src/runtime/test_event_sink.rs"]
mod test_event_sink;

pub use test_event_sink::RecordingEventSink;
