pub mod cargo;
pub mod test_file_patterns;
pub mod types;
pub mod vitest;

use types::TestRunner;

pub static RUNNERS: &[&TestRunner] = &[&vitest::VITEST, &cargo::CARGO_TEST];
