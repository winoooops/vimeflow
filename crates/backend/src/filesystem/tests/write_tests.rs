use super::*;
use std::fs;

#[test]
fn write_file_creates_file() {
    let dir = home_test_dir("write_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let file_path = dir.join("new_file.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "test content".to_string(),
    });

    assert!(result.is_ok());
    assert!(file_path.exists());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "test content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_creates_parent_dirs() {
    let dir = home_test_dir("write_file_nested");
    let _ = fs::remove_dir_all(&dir);

    let file_path = dir.join("subdir").join("nested").join("file.txt");
    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "nested content".to_string(),
    });

    assert!(result.is_ok());
    assert!(file_path.exists());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "nested content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_rejects_path_outside_home() {
    let result = write_file(WriteFileRequest {
        path: "/etc/test_forbidden.txt".to_string(),
        content: "forbidden".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[test]
fn write_file_rejects_traversal_into_sibling_of_home() {
    // A path like `~/../etc/evil.txt` must be rejected WITHOUT creating
    // any directories on disk (the P1 fix) — the previous implementation
    // ran `create_dir_all` before canonicalizing, which could mutate the
    // filesystem outside the home scope.
    let home = dirs::home_dir().expect("HOME must be set for tests");
    let home_parent = home
        .parent()
        .expect("home dir should have a parent in tests");

    // Forge a path that escapes home via `..`
    let evil = home
        .join("..")
        .join(".vimeflow_traversal_test")
        .join("evil.txt");
    let marker = home_parent.join(".vimeflow_traversal_test");
    let _ = fs::remove_dir_all(&marker);

    let result = write_file(WriteFileRequest {
        path: evil.to_string_lossy().to_string(),
        content: "should be rejected".to_string(),
    });

    assert!(result.is_err(), "traversal path must be rejected");
    assert!(result.unwrap_err().contains("access denied"));

    // Crucial: verify that NO directory was created outside home.
    assert!(
        !marker.exists(),
        "traversal fix must not create directories outside home: {}",
        marker.display()
    );
}

#[cfg(unix)]
#[test]
fn write_file_refuses_to_follow_symlink_escaping_home() {
    // A symlink inside home pointing outside home must not let `fs::write`
    // escape the sandbox. The previous implementation only canonicalized
    // the parent directory, so `fs::write` would follow the target
    // symlink and mutate files anywhere on disk the process could reach.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_symlink_escape");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // The symlink target is a path outside home. We never want to touch it.
    let outside_target =
        std::env::temp_dir().join(".vimeflow_write_file_symlink_escape_target.txt");
    let _ = fs::remove_file(&outside_target);

    let link = dir.join("evil_link");
    // evil_link -> /tmp/.vimeflow_write_file_symlink_escape_target.txt
    symlink(&outside_target, &link).unwrap();

    let result = write_file(WriteFileRequest {
        path: link.to_string_lossy().to_string(),
        content: "should not escape".to_string(),
    });

    assert!(result.is_err(), "symlink write must be rejected");
    assert!(result.unwrap_err().contains("access denied"));

    // Crucial: verify nothing was written outside home.
    assert!(
        !outside_target.exists(),
        "symlink guard must not write outside home: {}",
        outside_target.display()
    );

    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn write_file_refuses_intermediate_symlink_escape() {
    // Cover the TOCTOU class where an INTERMEDIATE path component is
    // swapped for a symlink pointing outside home. O_NOFOLLOW on the
    // final open() only guards the last segment, so this must be
    // caught by re-canonicalizing the parent after create_dir_all.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_intermediate_symlink");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // Pre-plant a symlink at an "intermediate" directory that points
    // outside home. The target path uses this link as a parent.
    let outside = std::env::temp_dir().join(".vimeflow_intermediate_escape");
    let _ = fs::remove_dir_all(&outside);
    fs::create_dir_all(&outside).unwrap();

    let link = dir.join("escape_link");
    symlink(&outside, &link).unwrap();

    // raw path: dir/escape_link/file.txt
    //   - walk-up check: dir/escape_link exists → canonicalize resolves
    //     it to the outside path → starts_with(home) fails → rejected.
    let evil = link.join("file.txt");

    let result = write_file(WriteFileRequest {
        path: evil.to_string_lossy().to_string(),
        content: "should not escape".to_string(),
    });

    assert!(
        result.is_err(),
        "intermediate symlink write must be rejected"
    );
    assert!(result.unwrap_err().contains("access denied"));

    // Confirm the attacker target is untouched.
    assert!(
        !outside.join("file.txt").exists(),
        "intermediate symlink guard must not write outside home"
    );

    let _ = fs::remove_dir_all(&outside);
    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn write_file_refuses_symlink_even_to_in_home_target() {
    // Stricter: reject *any* symlink at the target position, even ones
    // pointing inside home. This closes the TOCTOU window where a symlink
    // could be swapped between our check and the write.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("write_file_symlink_inner");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let real_target = dir.join("real.txt");
    fs::write(&real_target, "original").unwrap();

    let link = dir.join("link.txt");
    symlink(&real_target, &link).unwrap();

    let result = write_file(WriteFileRequest {
        path: link.to_string_lossy().to_string(),
        content: "nope".to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("symlink"));

    // Real target should be untouched.
    assert_eq!(fs::read_to_string(&real_target).unwrap(), "original");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn write_file_overwrites_existing() {
    let dir = home_test_dir("write_file_overwrite");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let file_path = dir.join("overwrite.txt");
    fs::write(&file_path, "original").unwrap();

    let result = write_file(WriteFileRequest {
        path: file_path.to_string_lossy().to_string(),
        content: "updated".to_string(),
    });

    assert!(result.is_ok());
    let content = fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "updated");

    let _ = fs::remove_dir_all(&dir);
}
