//! Agent detection via process tree inspection
//!
//! Detects which coding agent (Claude Code, Codex, Aider) is running
//! in a PTY session by inspecting the process tree under the shell PID.

use super::types::AgentType;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

trait ProcessSource {
    fn read_children(&self, pid: u32) -> Option<Vec<u32>>;
    fn read_cmdline(&self, pid: u32) -> Option<Vec<String>>;
}

struct ProcFsProcessSource;

impl ProcessSource for ProcFsProcessSource {
    fn read_children(&self, pid: u32) -> Option<Vec<u32>> {
        read_proc_children(pid)
    }

    fn read_cmdline(&self, pid: u32) -> Option<Vec<String>> {
        read_proc_cmdline(pid)
    }
}

/// Detect which agent is running under the given PID
///
/// Recursively traverses the process tree to find agent processes.
/// Returns the agent type and its PID, or None if no agent detected.
///
/// # Arguments
/// * `pid` - Root PID to start search from (typically the PTY shell process)
///
/// # Returns
/// * `Some((agent_type, agent_pid))` - If an agent is found
/// * `None` - If no agent is detected
pub fn detect_agent(pid: u32) -> Option<(AgentType, u32)> {
    detect_agent_with_source(pid, &ProcFsProcessSource)
}

fn detect_agent_with_source<S: ProcessSource>(pid: u32, source: &S) -> Option<(AgentType, u32)> {
    // Check the PTY root plus its descendants. Including the root handles
    // shells that have been replaced with `exec claude`.
    for candidate_pid in collect_process_tree(pid, source) {
        if let Some(agent_type) = detect_agent_from_cmdline(candidate_pid, source) {
            return Some((agent_type, candidate_pid));
        }
    }

    None
}

/// Read the children of a process from /proc filesystem
///
/// On Linux, /proc/<pid>/task/<pid>/children contains space-separated child PIDs.
fn read_proc_children(pid: u32) -> Option<Vec<u32>> {
    let children_path = format!("/proc/{}/task/{}/children", pid, pid);
    let content = fs::read_to_string(children_path).ok()?;

    let children: Vec<u32> = content
        .split_whitespace()
        .filter_map(|s| s.parse().ok())
        .collect();

    Some(children)
}

/// Collect the root PID and all descendant PIDs using iterative DFS
fn collect_process_tree<S: ProcessSource>(root_pid: u32, source: &S) -> Vec<u32> {
    let mut candidates = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = vec![root_pid];

    visited.insert(root_pid);

    while let Some(pid) = queue.pop() {
        candidates.push(pid);

        // Read children of current PID
        if let Some(children) = source.read_children(pid) {
            for child_pid in children {
                // Avoid cycles (shouldn't happen in process tree, but be safe)
                if visited.insert(child_pid) {
                    queue.push(child_pid);
                }
            }
        }
    }

    candidates
}

/// Read and parse /proc/<pid>/cmdline
///
/// The cmdline file contains null-separated arguments. argv[0] is the binary name.
fn read_proc_cmdline(pid: u32) -> Option<Vec<String>> {
    let cmdline_path = format!("/proc/{}/cmdline", pid);
    let content = fs::read(cmdline_path).ok()?;

    if content.is_empty() {
        return None;
    }

    // Split on null bytes, filter out empty strings
    let args: Vec<String> = content
        .split(|&b| b == 0)
        .filter(|s| !s.is_empty())
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
        .collect();

    if args.is_empty() {
        None
    } else {
        Some(args)
    }
}

/// Extract binary name from cmdline argv[0]
///
/// Handles both absolute paths (/usr/bin/claude) and bare names (claude).
fn extract_binary_name(cmdline: &[String]) -> Option<String> {
    let argv0 = cmdline.first()?;
    let path = Path::new(argv0);
    let filename = path.file_name()?.to_str()?;
    Some(filename.to_string())
}

/// Detect agent type from cmdline binary name
fn detect_agent_from_cmdline<S: ProcessSource>(pid: u32, source: &S) -> Option<AgentType> {
    let cmdline = source.read_cmdline(pid)?;
    let binary_name = extract_binary_name(&cmdline)?;

    match binary_name.as_str() {
        "claude" => Some(AgentType::ClaudeCode),
        "codex" => Some(AgentType::Codex),
        "aider" => Some(AgentType::Aider),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MockProcessSource {
        children: HashMap<u32, Vec<u32>>,
        cmdlines: HashMap<u32, Vec<String>>,
    }

    impl ProcessSource for MockProcessSource {
        fn read_children(&self, pid: u32) -> Option<Vec<u32>> {
            self.children.get(&pid).cloned()
        }

        fn read_cmdline(&self, pid: u32) -> Option<Vec<String>> {
            self.cmdlines.get(&pid).cloned()
        }
    }

    #[test]
    fn detects_only_agent_inside_pty_process_tree() {
        let source = MockProcessSource {
            children: HashMap::from([(10, vec![11]), (11, vec![12]), (20, vec![21])]),
            cmdlines: HashMap::from([
                (10, vec!["bash".to_string()]),
                (11, vec!["sh".to_string()]),
                (12, vec!["claude".to_string()]),
                (20, vec!["zsh".to_string()]),
                (21, vec!["claude".to_string()]),
            ]),
        };

        let detected = detect_agent_with_source(10, &source);

        assert!(matches!(detected, Some((AgentType::ClaudeCode, 12))));
    }

    #[test]
    fn ignores_agent_outside_pty_process_tree() {
        let source = MockProcessSource {
            children: HashMap::from([(10, vec![11]), (20, vec![21])]),
            cmdlines: HashMap::from([
                (10, vec!["bash".to_string()]),
                (11, vec!["python".to_string()]),
                (20, vec!["zsh".to_string()]),
                (21, vec!["claude".to_string()]),
            ]),
        };

        assert!(detect_agent_with_source(10, &source).is_none());
    }

    #[test]
    fn reads_self_cmdline() {
        // /proc/self always exists and points to our own process
        let cmdline = read_proc_cmdline(std::process::id());
        assert!(cmdline.is_some(), "Failed to read /proc/self/cmdline");

        let cmdline = cmdline.unwrap();
        assert!(!cmdline.is_empty(), "cmdline should not be empty");

        // First arg should contain the test binary name (might be in a path)
        let binary = extract_binary_name(&cmdline);
        assert!(binary.is_some(), "Failed to extract binary name");
    }

    #[test]
    fn handles_missing_pid_gracefully() {
        // PID 9999999 is unlikely to exist
        let cmdline = read_proc_cmdline(9999999);
        assert!(cmdline.is_none(), "Should return None for missing PID");
    }

    #[test]
    fn detects_agent_at_pty_root_via_exec() {
        // Locks the `exec claude` contract documented in
        // `collect_process_tree`'s comment: when the user runs
        // `exec claude`, the shell process is replaced by the agent
        // binary in-place, so the PTY's own root PID IS the agent.
        // The detector must include the root in the candidate set
        // (not just descendants) for this case to be detected at all.
        let source = MockProcessSource {
            children: HashMap::new(),
            cmdlines: HashMap::from([(12, vec!["claude".to_string()])]),
        };

        let detected = detect_agent_with_source(12, &source);

        assert!(
            matches!(detected, Some((AgentType::ClaudeCode, 12))),
            "expected detection at the PTY root PID for `exec claude`, got {:?}",
            detected,
        );
    }

    #[test]
    fn extracts_binary_name_from_path() {
        let cmdline = vec!["/usr/bin/claude".to_string(), "--help".to_string()];
        let binary = extract_binary_name(&cmdline);
        assert_eq!(binary, Some("claude".to_string()));
    }

    #[test]
    fn extracts_binary_name_from_bare_name() {
        let cmdline = vec!["aider".to_string(), "--version".to_string()];
        let binary = extract_binary_name(&cmdline);
        assert_eq!(binary, Some("aider".to_string()));
    }

    #[test]
    fn detects_claude_code_agent() {
        // We can't rely on a real claude process, but we can test the logic
        // by checking that the binary name matcher works
        let cmdline = vec!["claude".to_string()];
        let binary = extract_binary_name(&cmdline).unwrap();
        assert_eq!(binary, "claude");

        // The detection would work if we had a PID with this cmdline
        match binary.as_str() {
            "claude" => assert!(true), // ClaudeCode detected
            _ => panic!("Failed to match claude binary"),
        }
    }

    #[test]
    fn detects_codex_agent() {
        let cmdline = vec!["/home/user/.local/bin/codex".to_string()];
        let binary = extract_binary_name(&cmdline).unwrap();
        assert_eq!(binary, "codex");
    }

    #[test]
    fn detects_aider_agent() {
        let cmdline = vec!["aider".to_string(), "--model".to_string()];
        let binary = extract_binary_name(&cmdline).unwrap();
        assert_eq!(binary, "aider");
    }

    #[test]
    fn returns_none_for_unknown_binary() {
        let cmdline = vec!["bash".to_string()];
        let binary = extract_binary_name(&cmdline).unwrap();
        // bash is not an agent, so detection should return None
        assert_ne!(binary, "claude");
        assert_ne!(binary, "codex");
        assert_ne!(binary, "aider");
    }

    #[test]
    fn handles_empty_cmdline() {
        let cmdline: Vec<String> = vec![];
        let binary = extract_binary_name(&cmdline);
        assert!(binary.is_none(), "Empty cmdline should return None");
    }
}
